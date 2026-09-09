#!/usr/bin/env python3
"""Qinfang report studio. A local-only companion; does not change Codex config."""
import argparse
import json
import os
from pathlib import Path
import secrets
import sys
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from coordinator import Coordinator, find_codex
from standalone_export import finalize_report
from store import Conflict, Store
from direct_edit import editor_document, edited_document
from live_progress import ProgressReader
from codex_project import CodexProjects

ROOT = Path(__file__).resolve().parent
DEFAULT_DATA = Path.home() / "Library" / "Application Support" / "ReportStudio"
PORT = 18776
UI_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
PAGE_CSP = "sandbox allow-scripts allow-popups; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src about:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if args and str(args[1:2]).startswith("('5"):
            super().log_message(fmt, *args)

    def local(self):
        return self.headers.get("Host") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def respond(self, body, code=200, mime="application/json; charset=utf-8", csp=UI_CSP, download=False):
        if not isinstance(body, (str, bytes)):
            body = json.dumps(body, ensure_ascii=False)
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", csp)
        if download:
            self.send_header("Content-Disposition", 'attachment; filename="report.html"')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self.local():
            return self.respond({"error": "仅允许本机访问"}, 403)
        parts = urlsplit(self.path)
        path, query = parts.path, parse_qs(parts.query)
        try:
            if path == "/api/health":
                return self.respond({"service": "report-studio-standalone", "version": 2,
                                     "codex_available": bool(find_codex())})
            if path == "/api/state":
                # Token is accessible only to the studio origin, never to page iframes.
                if self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none") or self.headers.get("Origin") == "null":
                    return self.respond({"error": "来源不被允许"}, 403)
                reports = self.server.store.all()
                self.server.projects.sync(reports)
                return self.respond({"reports": reports, "csrf": self.server.csrf,
                                     "desktop_ready": self.server.projects.enabled, "direct_edit_ready": True, "direct_edit_version": 2,
                                     "writing_config": {"max_parallel": self.server.coordinator.pool._max_workers, "model": "gpt-6-astra", "reasoning_effort": "medium"},
                                     "codex_available": bool(find_codex())})
            if path == "/api/progress":
                if self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none") or self.headers.get("Origin") == "null":
                    return self.respond({"error": "来源不被允许"}, 403)
                return self.respond(self.server.progress.report(self.server.store, query["report"][0]))
            if path == "/api/revision":
                r = self.server.store.revision(query["report"][0], query["page"][0], query["revision"][0])
                return self.respond(r)
            if path == "/preview":
                revision = self.server.store.revision(query["report"][0], query["page"][0], query["revision"][0])
                return self.respond(editor_document(revision["html"]) if query.get("edit") == ["1"] else revision["html"], mime="text/html; charset=utf-8", csp=PAGE_CSP)
            if path == "/report":
                body = self.server.store.release_html(query["report"][0], query.get("release", [None])[0])
                return self.respond(body, mime="text/html; charset=utf-8", csp=PAGE_CSP, download="download" in query)
            static = {"/": ("index.html", "text/html"), "/index.html": ("index.html", "text/html"),
                      "/typefaces/catalog.js": ("typefaces/catalog.js", "application/javascript"),
                      "/typefaces/fonts.css": ("typefaces/fonts.css", "text/css"),
                      "/typefaces/ZhiMangXing-Regular.ttf": ("typefaces/ZhiMangXing-Regular.ttf", "font/ttf"),
                      "/typefaces/OFL.txt": ("typefaces/OFL.txt", "text/plain"),
                      "/appearance.js": ("appearance.js", "application/javascript"),
                      "/app.js": ("app.js", "application/javascript"), "/style.css": ("style.css", "text/css")}
            if path in static:
                filename, mime = static[path]
                return self.respond((ROOT / "web" / filename).read_bytes(), mime=mime + "; charset=utf-8")
            return self.respond({"error": "页面不存在"}, 404)
        except (ValueError, KeyError, FileNotFoundError) as exc:
            return self.respond({"error": str(exc)[:300]}, 400)

    def do_POST(self):
        origin = self.headers.get("Origin")
        allowed = {f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"}
        if not self.local() or (origin is not None and origin not in allowed) or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
            return self.respond({"error": "需要从本机工作台提交"}, 403)
        if not secrets.compare_digest(self.headers.get("X-Studio-CSRF", ""), self.server.csrf):
            return self.respond({"error": "请刷新工作台后重试"}, 403)
        if self.headers.get_content_type() != "application/json":
            return self.respond({"error": "需要 JSON 请求"}, 415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 6_000_000:
                raise ValueError("提交内容过大或为空")
            req = json.loads(self.rfile.read(length))
            if not isinstance(req, dict):
                raise ValueError("请求格式错误")
            store = self.server.store
            rid, pid = req.get("report_id"), req.get("page_id")
            if self.path == "/api/create":
                result = store.create(req)
                try:
                    self.server.projects.ensure(result["id"])
                except (ValueError, OSError, subprocess.SubprocessError) as exc:
                    # Creation must remain successful even if desktop opening fails.
                    result["codex_notice"] = str(exc)[:300]
            elif self.path == "/api/codex-open":
                result = self.server.projects.ensure(rid, open_app=True)
            elif self.path == "/api/message":
                result = self.server.coordinator.enqueue(rid, pid, req.get("prompt", ""))
            elif self.path == "/api/start-all":
                report = store.read(rid)
                result = []
                for page in report["pages"]:
                    if not page["revisions"] and not any(j["page_id"] == page["id"] and j["status"] in ("queued", "running") for j in report["jobs"]):
                        result.append(self.server.coordinator.enqueue(rid, page["id"], "根据汇报总纲和本页任务，开展必要研究并制作第一版页面。证据不足处明确标注，不自行补造事实。"))
            elif self.path == "/api/direct-edit":
                base = store.revision(rid, pid, req["base_revision"])
                result = store.submit(rid, pid, {"html": edited_document(base["html"], req.get("patches")), "origin": "直接编辑", "summary": base["summary"], "evidence": base.get("evidence", ""), "direct_edit": True, "expected_revision": base["id"]})
            elif self.path == "/api/submit":
                result = store.submit(rid, pid, req)
            elif self.path == "/api/approve":
                result = store.approve(rid, pid, req["revision_id"], req["sha256"], req.get("outline_version"))
            elif self.path == "/api/restore":
                result = store.restore(rid, pid, req["revision_id"], req.get("outline_version"))
            elif self.path == "/api/amend":
                result = store.amend(rid, pid, req.get("brief", ""), req.get("title"), req.get("outline_version"))
            elif self.path == "/api/outline":
                result = store.update_outline(rid, req["pages"], req.get("outline_version"))
            elif self.path == "/api/finalize":
                result = finalize_report(store, rid, req["release"])
            else:
                return self.respond({"error": "接口不存在"}, 404)
            return self.respond({"ok": True, "result": result})
        except Conflict as exc:
            return self.respond({"error": str(exc)}, 409)
        except (ValueError, KeyError, FileNotFoundError) as exc:
            return self.respond({"error": str(exc)[:500]}, 400)
        except Exception as exc:
            print(f"Studio request failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            return self.respond({"error": "操作未完成，已有定稿保留。请重试或查看工作台日志"}, 500)


def make_server(data=DEFAULT_DATA, port=PORT, runner=None, desktop=False):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.store = Store(data)
    server.csrf = secrets.token_urlsafe(32)
    server.coordinator = Coordinator(server.store, runner=runner)
    server.progress = ProgressReader()
    server.projects = CodexProjects(server.store, server.server_port, enabled=desktop)
    return server


if __name__ == "__main__":
    import signal
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    args = parser.parse_args()
    server = make_server(args.data, args.port, desktop=True)
    print(f"本地汇报 · 汇报工作台 http://127.0.0.1:{server.server_port}", flush=True)
    def stop(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.coordinator.close()
