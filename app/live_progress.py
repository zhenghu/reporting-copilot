"""Read public CLI activity incrementally; never expose reasoning or tool output."""
from collections import OrderedDict
import json
import threading
import time


def public_event(event):
    kind = event.get("type", "")
    item = event.get("item") or {}
    itype = item.get("type")
    if kind == "item.completed" and itype == "agent_message":
        message = item.get("text", "").strip()
        if message.startswith("{"):
            try:
                # Structured submission is shown in the final conversation instead.
                if "html" in json.loads(message):
                    return None
            except (ValueError, TypeError):
                pass
        if message:
            return {"kind": "message", "text": message[:6000]}
    if kind in ("item.started", "item.completed"):
        labels = {"command_execution": "正在执行文件处理或检查", "web_search": "正在检索资料",
                  "mcp_tool_call": "正在使用工具核对资料", "file_change": "正在更新页面文件"}
        if itype in labels:
            label = labels[itype]
            if kind == "item.completed":
                label = {"command_execution": "完成一次文件处理或检查", "web_search": "完成一次资料检索",
                         "mcp_tool_call": "完成一次工具调用", "file_change": "页面文件已更新"}[itype]
                if item.get("exit_code") not in (None, 0) or item.get("status") == "failed":
                    label = "一次工具检查未通过，等待作者处理"
            return {"kind": "activity", "text": label}
    if kind == "turn.started":
        return {"kind": "activity", "text": "Codex 已开始处理本次要求"}
    return None


def connection_notice(path, event_time, status):
    if status != 'running':
        return ''
    try:
        stat = path.stat()
        if stat.st_mtime <= (event_time or 0) or time.time() - stat.st_mtime > 300:
            return ''
        with path.open('rb') as stream:
            stream.seek(max(0, stat.st_size - 16000))
            tail = stream.read().decode('utf-8', errors='replace').lower()
        if any(marker in tail for marker in ('stream disconnected', 'tls handshake eof', 'retrying sampling request')):
            return '模型连接中断，正在重试；已写入的页面文件保留。'
    except OSError:
        pass
    return ''


class ProgressReader:
    def __init__(self):
        self.cache = OrderedDict()
        self.lock = threading.Lock()

    def read(self, path):
        with self.lock:
            try:
                stat = path.stat()
            except FileNotFoundError:
                return {"events": [], "last_activity_at": None}
            key = str(path)
            entry = self.cache.get(key)
            if entry is None or entry["inode"] != stat.st_ino or stat.st_size < entry["offset"]:
                entry = {"inode": stat.st_ino, "offset": 0, "events": [], "sequence": 0}
            with path.open("rb") as stream:
                stream.seek(entry["offset"])
                # Budget each request; subsequent polls continue from this offset.
                budget = 8_000_000
                while budget > 0:
                    start = stream.tell()
                    line = stream.readline(6_000_001)
                    if len(line) == 6_000_001 and not line.endswith(b"\n"):
                        # Oversized tool output is not public progress. Skip in chunks.
                        while line and not line.endswith(b"\n"):
                            line = stream.readline(1_000_000)
                        if line.endswith(b"\n"):
                            entry["offset"] = stream.tell()
                            budget = 0
                            continue
                        stream.seek(start)
                        break
                    if not line or not line.endswith(b"\n"):
                        stream.seek(start)
                        break
                    budget -= len(line)
                    entry["offset"] = stream.tell()
                    entry["sequence"] += 1
                    try:
                        event = public_event(json.loads(line))
                    except (ValueError, TypeError, AttributeError):
                        continue
                    if event:
                        event["sequence"] = entry["sequence"]
                        if event["kind"] == "activity":
                            entry["activity"] = event["text"]
                        else:
                            entry["events"].append(event)
                            entry["events"] = entry["events"][-40:]
            self.cache[key] = entry
            self.cache.move_to_end(key)
            while len(self.cache) > 128:
                self.cache.popitem(last=False)
            return {"events": list(entry["events"]), "activity": entry.get("activity", ""),
                    "last_activity_at": stat.st_mtime, "catching_up": entry["offset"] < stat.st_size}

    def report(self, store, report_id):
        report = store.read(report_id)
        latest = {}
        for job in report["jobs"]:
            latest[job["page_id"]] = job
        jobs = []
        for job in latest.values():
            path = store.directory(report_id) / "work" / job["page_id"] / (job["id"] + ".events.jsonl")
            progress = self.read(path)
            notice = connection_notice(path.with_name(job['id'] + '.stderr.log'), progress.get('last_activity_at'), job['status'])
            progress['connection_notice'] = notice
            if notice:
                progress['activity'] = notice
            elif job['status'] == 'running' and progress.get('last_activity_at') and time.time() - progress['last_activity_at'] > 180:
                progress['activity'] = '超过 3 分钟没有新的公开进展；任务尚未结束。'
            jobs.append({k: job.get(k) for k in ("id", "page_id", "status", "started_at", "created_at", "completed_at", "error")} |
                        progress)
        return {"report_id": report_id, "jobs": jobs}
