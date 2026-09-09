"""Small task context, versioned deltas, and file-based delivery. No model calls."""
import hashlib
import json

from store import atomic, write_json


def prepare_context(store, report, job, work, session):
    parts = {
        "版式约定": {"version": "qinfang-v2", "guide": "AUTHORING.md", "read": "按需只读所需页型，不重复载入全部模板"},
        "共同要求": {"汇报": report["title"], "受众": report["audience"], "背景": report["brief"]},
        "标题链": [{"id": p["id"], "title": p["title"]} for p in report["pages"]],
    }
    if job["page_id"] == "editor":
        summaries = []
        for page in report["pages"]:
            item = {"id": page["id"], "title": page["title"], "revision": page.get("approved_revision")}
            if page.get("approved_revision"):
                rev = store.revision(report["id"], page["id"], page["approved_revision"])
                item.update(summary=rev["summary"][:1200], evidence=rev.get("evidence", "")[:1200])
                # Full content is available on demand, never bundled into the review index.
                path = work / "review-pages" / (page["id"] + ".json")
                write_json(path, {"summary": rev["summary"], "evidence": rev.get("evidence", ""), "html": rev["html"]})
                item["详情文件"] = str(path.relative_to(work))
            else:
                item["status"] = "未定稿"
            summaries.append(item)
        write_json(work / "approved-pages.json", summaries)
        parts["本次角色"] = "总工审稿：先读 approved-pages.json 的摘要，核对主线、跨页重复和缺口；只在具体疑点需要原文时读取相应详情文件。不要批量读取全部 HTML。只返回审查意见，html 和 artifact_file 均留空。"
        parts["定稿变化"] = [{"id": p["id"], "revision": p.get("approved_revision"), "needs_review": p.get("needs_review", False)} for p in report["pages"]]
    else:
        page = store.page(report, job["page_id"])
        parts["本页任务"] = {"id": page["id"], "title": page["title"], "brief": page["brief"]}
        parts["当前稿"] = {"revision": page.get("draft_revision"), "file": "delivery.html" if page.get("draft_revision") else None}
        if page.get("draft_revision"):
            rev = store.revision(report["id"], page["id"], page["draft_revision"])
            atomic(work / "delivery.html", rev["html"])
    hashes = {key: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest() for key, value in parts.items()}
    previous = next((j for j in reversed(report["jobs"]) if session and j["page_id"] == job["page_id"]
                     and j["status"] == "completed" and j.get("context_session_id") == session and j.get("context_hashes")), None)
    changed = {k: v for k, v in parts.items() if not previous or previous["context_hashes"].get(k) != hashes[k]}
    write_json(work / "task-context.json", parts)
    context = json.dumps(changed, ensure_ascii=False, separators=(",", ":")) if changed else "共同要求、标题链、本页任务与稿件版本均未变化。"
    prompt = ("遵守本目录 AGENTS.md。以下任务数据覆盖历史中的对应旧版本。\n" +
              ("本次仅补充变化：\n" if previous else "必要任务上下文：\n") + context +
              "\n历史信息不足时可按需读取 task-context.json。局部调整优先定点读取并编辑 delivery.html，不回显整份 HTML。"
              "完成制作时 artifact_file 填 delivery.html，html 留空；仅讨论时二者均留空。\n用户本次要求：\n" + job["prompt"])
    return prompt, hashes, {"mode": "delta" if previous else "initial", "prompt_chars": len(prompt),
                            "changed_sections": list(changed), "full_context_chars": len(json.dumps(parts, ensure_ascii=False))}


def read_delivery(result, work):
    name = result.get("artifact_file", "")
    if not name:
        return result
    path = work / "delivery.html"
    if name != "delivery.html" or path.is_symlink() or not path.is_file() or path.stat().st_size > 4_000_000:
        raise ValueError("页面成果文件无效：请在本页目录提交 delivery.html（最大 4 MB）")
    if result.get("html", "").strip():
        raise ValueError("请只使用文件交稿或 HTML 交稿中的一种")
    result["html"] = path.read_text(encoding="utf-8")
    return result
