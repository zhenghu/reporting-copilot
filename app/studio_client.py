"""Report-scoped client. Authentication stays in memory; approval stays in the UI."""
import argparse
import json
from pathlib import Path
import urllib.request
import urllib.error


def main():
    config = json.loads(Path(__file__).with_name('.studio.json').read_text())
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(path, body=None, csrf=None):
        headers = {'Content-Type': 'application/json'}
        if csrf:
            headers['X-Studio-CSRF'] = csrf
        req = urllib.request.Request(config['url'] + path, data=json.dumps(body).encode() if body else None, headers=headers)
        with opener.open(req, timeout=30) as response:
            return json.load(response)
    parser = argparse.ArgumentParser(description='汇报总工：查看进展、派工、收稿和调整大纲')
    sub = parser.add_subparsers(dest='action', required=True)
    status = sub.add_parser('state'); status.add_argument('--page')
    sub.add_parser('progress')
    message = sub.add_parser('message'); message.add_argument('page'); message.add_argument('--file', required=True)
    submit = sub.add_parser('submit'); submit.add_argument('page'); submit.add_argument('file'); submit.add_argument('--summary', required=True)
    outline = sub.add_parser('outline'); outline.add_argument('file')
    args = parser.parse_args()
    state = request('/api/state')
    report = next(r for r in state['reports'] if r['id'] == config['report_id'])
    body = {'report_id': report['id']}
    if args.action == 'state':
        if args.page:
            result = next(p for p in report['pages'] if p['id'] == args.page)
        else:
            result = {k: report.get(k) for k in ('id', 'title', 'audience', 'brief', 'outline_version', 'release', 'codex_project')}
            result['pages'] = [{k: p.get(k) for k in ('id', 'title', 'brief', 'session_id', 'draft_revision', 'approved_revision', 'needs_review')}
                               for p in report['pages']]
            latest = {j['page_id']: j for j in report['jobs']}
            result['jobs'] = [{k: j.get(k) for k in ('id', 'page_id', 'status', 'started_at', 'completed_at', 'error')}
                              for j in latest.values()]
    elif args.action == 'progress':
        try:
            result = request('/api/progress?report=' + report['id'])
        except urllib.error.HTTPError as exc:
            if exc.code != 404 or not report.get('live_progress'):
                raise
            result = report['live_progress']
    else:
        if args.action == 'message':
            body.update(page_id=args.page, prompt=Path(args.file).read_text())
        elif args.action == 'submit':
            body.update(page_id=args.page, html=Path(args.file).read_text(), summary=args.summary, origin='Codex 总工收稿')
        elif args.action == 'outline':
            body.update(pages=json.loads(Path(args.file).read_text()), outline_version=report.get('outline_version', 1))
        result = request('/api/' + args.action, body, state['csrf'])
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
