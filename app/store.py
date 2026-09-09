"""Local report state, immutable page revisions, and serialized assembly."""
import contextlib
import copy
import datetime as dt
import fcntl
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import secrets
import threading


class Conflict(ValueError):
    pass


def now():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + secrets.token_hex(6) + ".tmp")
    with temp.open("w", encoding="utf-8") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, path)


def write_json(path, value):
    atomic(path, json.dumps(value, ensure_ascii=False, indent=2))


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def ident(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{1,70}", value):
        raise ValueError("无效的记录标识")
    return value


def text(value, limit=50000):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError("内容格式错误或过长")
    return value.strip()


def check_html(source):
    source = text(source, 4_000_000)
    if not re.search(r"<html[\s>]", source, re.I) or not re.search(r"</html\s*>", source, re.I):
        raise ValueError("请提交完整的自包含 HTML 页面")
    if re.search(r"<(?:base|object|embed|iframe)\b", source, re.I):
        raise ValueError("单页请使用内嵌图形，不包含外部嵌套页面")
    # Keep link citations; all automatically loaded resources must travel with the revision.
    class Resources(HTMLParser):
        def handle_starttag(self, tag, attrs):
            for name, value in attrs:
                value = (value or "").strip().lower()
                if name == "srcset":
                    raise ValueError("请将 srcset 改为内嵌图片 src，保证离线呈现一致")
                automatic = name in ("src", "poster", "background", "data") or (name in ("href", "xlink:href") and tag != "a")
                if automatic and not value.startswith(("data:", "#")):
                    raise ValueError("图片、脚本、样式等资源需要内嵌，避免定稿后依赖丢失")
                if tag == "meta" and name == "http-equiv" and value == "refresh":
                    raise ValueError("页面不能自动跳转")
    Resources().feed(source)
    if re.search(r"@import\b", source, re.I):
        raise ValueError("不支持外部样式导入")
    for match in re.finditer(r"url\(\s*['\"]?([^)'\"]+)", source, re.I):
        if not match.group(1).strip().startswith(("data:", "#")):
            raise ValueError("CSS 资源需要内嵌")
    return source


def render_report(report, revisions, release):
    esc = html.escape
    cards, links = [], []
    for n, page in enumerate(report["pages"], 1):
        rev = revisions.get(page["id"])
        title = esc(page["title"])
        links.append(f'<a href="#{page["id"]}">{n:02d} {title}</a>')
        if rev:
            source = rev["html"]
            policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; object-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\'">'
            source = policy + source
            # Opaque sandbox keeps every page's CSS, scripts and origin independent.
            panel = f'<div class="viewport"><iframe title="{title}" sandbox="allow-scripts allow-popups" srcdoc="{esc(source, quote=True)}"></iframe></div>'
        else:
            panel = '<div class="missing">本页待定稿</div>'
        state = "任务已更新 · 待复核" if page.get("needs_review") else ("已收稿" if rev else "待定稿")
        cards.append(f'<section id="{page["id"]}" class="sheet"><header><span>{n:02d}</span><h2>{title}</h2><small>{state}</small></header>{panel}</section>')
    complete = len(revisions) == len(report["pages"]) and not any(p.get("needs_review") for p in report["pages"])
    return '''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>''' + esc(report["title"]) + '''</title><style>
*{box-sizing:border-box}body{margin:0;background:#eceeea;color:#232b29;font-family:"Microsoft YaHei","PingFang SC",sans-serif}nav{position:sticky;top:0;z-index:10;background:#f8f9f5ee;border-bottom:1px solid #d5d9d2;padding:12px 24px;display:flex;align-items:center;gap:18px;backdrop-filter:blur(12px)}nav strong{margin-right:auto}button{font:inherit;border:1px solid #b9c2bb;background:#fff;padding:8px 12px;border-radius:6px;cursor:pointer}details{position:relative}summary{cursor:pointer}details div{position:absolute;right:0;width:320px;max-height:70vh;overflow:auto;background:white;border:1px solid #ccd3cc;padding:12px}details a{display:block;padding:8px;color:inherit;text-decoration:none}main{max-width:1340px;margin:auto;padding:28px 24px}.sheet{scroll-margin-top:75px;margin:0 0 30px;border:1px solid #cdd4cc;background:#fff;box-shadow:0 8px 30px #2737290a}.sheet header{display:flex;align-items:center;gap:16px;padding:12px 18px;background:#f8f9f7}.sheet h2{font-size:16px;margin:0;font-weight:500}.sheet small{margin-left:auto;color:#657566}.sheet header span{font:14px monospace;color:#6b796c}.viewport{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden}iframe{display:block;border:0;width:1280px;height:720px;transform-origin:top left}.missing{aspect-ratio:16/9;display:grid;place-items:center;color:#788476;background:#f2f3f0}.present nav{position:fixed;width:100%}.present main{padding:0;max-width:none}.present .sheet{display:none;position:fixed;inset:56px 0 0;margin:0;background:#242825;border:0}.present .sheet.active{display:flex;align-items:center;justify-content:center}.present .sheet header{display:none}.present .viewport{max-width:calc((100vh - 56px)*16/9)}@media(max-width:700px){nav{padding:10px;gap:8px}nav strong{font-size:13px}main{padding:12px 8px}.sheet h2{font-size:14px}nav small{display:none}}@media print{nav,.sheet header{display:none}main{padding:0}.sheet{break-after:page;box-shadow:none;border:0;margin:0}}
</style></head><body><nav><strong>''' + esc(report["title"]) + '''</strong><small>''' + ("各页已收齐" if complete else "工作总稿 · 含待定稿页") + f' · 合稿 {release}</small><details><summary>目录</summary><div>' + "".join(links) + '''</div></details><button id="prev" aria-label="上一页">上一页</button><button id="next" aria-label="下一页">下一页</button><button id="present">演示</button></nav><main>''' + "".join(cards) + '''</main><script>
const sheets=[...document.querySelectorAll('.sheet')];let active=0;function resize(){document.querySelectorAll('.viewport').forEach(v=>{v.firstElementChild.style.transform='scale('+v.clientWidth/1280+')'})}function show(i){active=Math.max(0,Math.min(sheets.length-1,i));sheets.forEach((s,n)=>s.classList.toggle('active',n===active));if(!document.body.classList.contains('present'))sheets[active].scrollIntoView({behavior:'smooth',block:'start'});resize()}document.querySelector('#prev').onclick=()=>show(active-1);document.querySelector('#next').onclick=()=>show(active+1);document.querySelector('#present').onclick=()=>{document.body.classList.toggle('present');show(active);if(document.body.classList.contains('present'))document.documentElement.requestFullscreen?.().catch(()=>{});else if(document.fullscreenElement)document.exitFullscreen?.()};document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.body.classList.remove('present');resize()}if(['ArrowRight','PageDown'].includes(e.key)){e.preventDefault();show(active+1)}if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(active-1)}});document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)document.body.classList.remove('present');resize()});window.addEventListener('resize',resize);new ResizeObserver(resize).observe(document.body);resize();
</script></body></html>'''


class Store:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.mutex = threading.RLock()

    @contextlib.contextmanager
    def locked(self):
        with self.mutex:
            with (self.root / ".lock").open("a+") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock, fcntl.LOCK_UN)

    def directory(self, report_id):
        return self.root / "reports" / ident(report_id)

    def read(self, report_id):
        return load_json(self.directory(report_id) / "report.json")

    def save(self, report):
        report["updated_at"] = now()
        write_json(self.directory(report["id"]) / "report.json", report)

    def all(self):
        with self.locked():
            return sorted([load_json(p) for p in (self.root / "reports").glob("*/report.json")],
                          key=lambda x: x["updated_at"], reverse=True)

    def create(self, req):
        title = text(req.get("title", ""), 180)
        if not title:
            raise ValueError("请填写汇报名称")
        outline = text(req.get("outline", ""), 30000)
        lines = [re.sub(r"^\s*(?:[-*]|\d+[.、)）])\s*", "", s).strip() for s in outline.splitlines() if s.strip()]
        if not 1 <= len(lines) <= 60:
            raise ValueError("大纲每行一页，请填写 1 至 60 页")
        report = {"id": "r_" + secrets.token_hex(6), "title": title,
                  "audience": text(req.get("audience", "高层技术领导"), 1000),
                  "brief": text(req.get("brief", "")), "outline": outline,
                  "status": "draft", "release": 0, "published_release": None, "outline_version": 1, "removed_pages": [],
                  "created_at": now(), "updated_at": now(), "pages": [], "editor_messages": [], "jobs": []}
        for line in lines:
            parts = re.split(r"[|｜]", line, maxsplit=1)
            if not parts[0].strip():
                raise ValueError("每页需要标题")
            report["pages"].append({"id": "p_" + secrets.token_hex(5), "title": parts[0].strip()[:180],
                "brief": parts[1].strip() if len(parts) > 1 else "", "revisions": [],
                "draft_revision": None, "approved_revision": None, "messages": [], "session_id": None})
        with self.locked():
            self._save_outline(report)
            self.save(report)
        return report

    def page(self, report, page_id, include_removed=False):
        ident(page_id)
        pages = report["pages"] + (report.get("removed_pages", []) if include_removed else [])
        result = next((p for p in pages if p["id"] == page_id), None)
        if result is None:
            raise ValueError("页面不存在")
        return result

    def revision(self, report_id, page_id, revision_id):
        return load_json(self.directory(report_id) / "pages" / ident(page_id) / "revisions" / (ident(revision_id) + ".json"))

    def submit(self, report_id, page_id, req, include_removed=False, context_outline_version=None):
        source = check_html(req.get("html", ""))
        sha = hashlib.sha256(source.encode()).hexdigest()
        with self.locked():
            report = self.read(report_id)
            page = self.page(report, page_id, include_removed=include_removed)
            if req.get("direct_edit"):
                if page["draft_revision"] != req.get("expected_revision"):
                    raise Conflict("已有新稿返回，请重新打开最新稿后编辑；本次修改仍保留在编辑窗口")
                if any(j["page_id"] == page_id and j["status"] in ("running", "queued") for j in report["jobs"]):
                    raise Conflict("Codex 正在修改这一页，请等待完成后再保存直接编辑")
            if context_outline_version is not None and context_outline_version != report.get("outline_version", 1):
                page["needs_review"] = True
                page["review_reason"] = "任务执行期间大纲有更新，请按最新大纲核对本稿"
            if page["draft_revision"]:
                old = self.revision(report_id, page_id, page["draft_revision"])
                if old["sha256"] == sha:
                    self.save(report)
                    return old
            revision = {"id": "v_" + secrets.token_hex(6), "html": source, "sha256": sha,
                        "summary": text(req.get("summary", ""), 10000),
                        "evidence": text(req.get("evidence", ""), 50000),
                        "origin": text(req.get("origin", "提交"), 100), "created_at": now(),
                        "outline_version": context_outline_version or report.get("outline_version", 1)}
            path = self.directory(report_id) / "pages" / page_id / "revisions" / (revision["id"] + ".json")
            write_json(path, revision)
            page["revisions"].append({k: v for k, v in revision.items() if k != "html"})
            page["draft_revision"] = revision["id"]
            if any(p["id"] == page_id for p in report["pages"]):
                report["status"] = "draft"
            self.save(report)
            return revision

    def approve(self, report_id, page_id, revision_id, expected_sha, expected_outline_version=None):
        with self.locked():
            report = self.read(report_id)
            page = self.page(report, page_id)
            self._check_outline(report, expected_outline_version, require=page.get("needs_review", False))
            if revision_id != page["draft_revision"]:
                raise Conflict("页面已有新稿，请查看后再定稿；旧定稿仍保留")
            rev = self.revision(report_id, page_id, revision_id)
            if rev["sha256"] != expected_sha:
                raise Conflict("页面版本已变化，请重新预览")
            if page["approved_revision"] == revision_id and not page.get("needs_review"):
                return report
            page["approved_revision"] = revision_id
            page["needs_review"] = False
            page["review_reason"] = ""
            page["approved_at"] = now()
            self._assemble(report)
            self.save(report)
            return report

    def restore(self, report_id, page_id, revision_id, expected_outline_version=None):
        with self.locked():
            report = self.read(report_id)
            page = self.page(report, page_id)
            self._check_outline(report, expected_outline_version, require=page.get("needs_review", False))
            rev = self.revision(report_id, page_id, revision_id)
            if page["approved_revision"] == rev["id"] and page["draft_revision"] == rev["id"] and not page.get("needs_review"):
                return report
            page["approved_revision"] = rev["id"]
            page["draft_revision"] = rev["id"]
            page["needs_review"] = False
            page["review_reason"] = ""
            page["approved_at"] = now()
            self._assemble(report)
            self.save(report)
            return report

    def _assemble(self, report):
        report["release"] += 1
        revisions = {p["id"]: self.revision(report["id"], p["id"], p["approved_revision"])
                     for p in report["pages"] if p["approved_revision"]}
        release_dir = self.directory(report["id"]) / "releases" / f'v{report["release"]}'
        manifest = {"report_id": report["id"], "release": report["release"], "created_at": now(),
                    "outline_version": report.get("outline_version", 1),
                    "pages": [{"id": p["id"], "title": p["title"], "revision": p["approved_revision"],
                               "needs_review": p.get("needs_review", False),
                               "sha256": revisions.get(p["id"], {}).get("sha256")} for p in report["pages"]]}
        assembled = render_report(report, revisions, report["release"])
        atomic(release_dir / "report.html", assembled)
        write_json(release_dir / "manifest.json", manifest)
        report["status"] = "ready" if len(revisions) == len(report["pages"]) and not any(p.get("needs_review") for p in report["pages"]) else "draft"

    def release_html(self, report_id, release=None):
        with self.locked():
            report = self.read(report_id)
            version = int(release or report["release"])
            if version < 1 or version > report["release"]:
                raise ValueError("还没有已定稿页面")
            return (self.directory(report_id) / "releases" / f"v{version}" / "report.html").read_text()

    def _check_outline(self, report, version, require=False):
        if version is None and not require:
            return
        if version != report.get("outline_version", 1):
            raise Conflict("大纲已有更新，请查看最新大纲后再保存或确认；当前输入仍保留")

    def _save_outline(self, report, replace=False):
        path = self.directory(report["id"]) / "outlines" / f'v{report.get("outline_version", 1)}.json'
        if path.exists() and not replace:
            return
        write_json(path,
            {"version": report.get("outline_version", 1), "created_at": now(),
             "pages": [{k: p[k] for k in ("id", "title", "brief")} for p in report["pages"]]})

    def _apply_outline(self, report, items):
        if not isinstance(items, list) or not 1 <= len(items) <= 60:
            raise ValueError("大纲需要保留 1 至 60 页")
        known = {p["id"]: p for p in report["pages"] + report.get("removed_pages", [])}
        pages, seen = [], set()
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("页面格式错误")
            title, brief = text(item.get("title", ""), 180), text(item.get("brief", ""))
            if not title:
                raise ValueError("每页需要标题")
            pid = item.get("id")
            if pid:
                ident(pid)
                if pid not in known or pid in seen:
                    raise ValueError("页面编号不存在或重复，请重新加载大纲")
                page = copy.deepcopy(known[pid])
                if (page["title"], page["brief"]) != (title, brief) and page["draft_revision"]:
                    page.update(needs_review=True, review_reason="本页标题或任务已调整，请按新要求核对已有内容")
            else:
                page = {"id": "p_" + secrets.token_hex(5), "revisions": [], "draft_revision": None,
                        "approved_revision": None, "messages": [], "session_id": None}
            seen.add(page["id"])
            page.update(title=title, brief=brief)
            pages.append(page)
        signature = lambda ps: [(p["id"], p["title"], p["brief"]) for p in ps]
        if signature(pages) == signature(report["pages"]):
            return report
        self._save_outline(report)
        report["removed_pages"] = [p for pid, p in known.items() if pid not in seen]
        report["pages"] = pages
        report["outline"] = "\n".join(p["title"] + " | " + p["brief"] for p in pages)
        report["outline_version"] = report.get("outline_version", 1) + 1
        self._save_outline(report, replace=True)
        self._assemble(report)
        self.save(report)
        return report

    def update_outline(self, report_id, items, expected_outline_version):
        with self.locked():
            report = self.read(report_id)
            self._check_outline(report, expected_outline_version, require=True)
            return self._apply_outline(report, items)

    def amend(self, report_id, page_id, brief, title=None, expected_outline_version=None):
        with self.locked():
            report = self.read(report_id)
            self._check_outline(report, expected_outline_version)
            self.page(report, page_id)
            items = [{k: p[k] for k in ("id", "title", "brief")} for p in report["pages"]]
            page = next(p for p in items if p["id"] == page_id)
            page.update(brief=brief, title=title if title is not None else page["title"])
            return self._apply_outline(report, items)
