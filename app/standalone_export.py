from store import Conflict, now

def finalize_report(store, report_id, expected_release):
    with store.locked():
        r = store.read(report_id)
        if r['release'] != int(expected_release):
            raise Conflict('总稿已更新，请重新检查')
        if not r['pages'] or any(not p.get('approved_revision') or p.get('needs_review') or p['draft_revision'] != p['approved_revision'] for p in r['pages']):
            raise Conflict('请先确认所有页面的最新版本')
        if any(j['status'] in ('queued','running') for j in r['jobs']):
            raise Conflict('仍有写作任务正在处理')
        r.update(status='published', published_release=r['release'], published_at=now())
        store.save(r)
        return r
