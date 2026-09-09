"""Sandboxed visual editing; exported edits preserve the original script/source."""
import json
import re
from pathlib import Path


def editor_document(source):
    script = (Path(__file__).parent / 'web' / 'direct-editor.js').read_text()
    runtime = (Path(__file__).parent / 'web' / 'direct-runtime.js').read_text().replace('__PATCH_DATA__', '[]')
    return source + '\n<script>' + runtime + '</script><script>' + script + '</script>'


def edited_document(source, patches):
    if not isinstance(patches, list) or not 0 < len(patches) <= 200:
        raise ValueError('请选择并修改页面内容后再保存')
    for p in patches:
        if not isinstance(p, dict) or p.get('kind') not in ('text', 'hide', 'object', 'attrs', 'style'):
            raise ValueError('编辑操作无效')
        if not re.fullmatch(r'[a-zA-Z0-9_# >:()\-\[\]="]{1,2000}', p.get('selector', '')):
            raise ValueError('内容定位无效')
        if p['kind'] == 'text' and (not isinstance(p.get('before'), str) or not isinstance(p.get('after'), str) or len(p['after']) > 20000):
            raise ValueError('文字修改无效')
        if p['kind'] in ('attrs', 'style'):
            allowed = {'d', 'points', 'x1', 'y1', 'x2', 'y2', 'transform', 'x', 'y', 'width', 'height'} if p['kind'] == 'attrs' else {'translate', 'width', 'height'}
            values = p.get('values')
            if not isinstance(values, dict) or not values or not set(values) <= allowed or any(not isinstance(v,str) or len(v)>10000 or not re.fullmatch(r'[0-9a-zA-Z.,() +%\-]*',v) for v in values.values()):
                raise ValueError('图形调整无效')
        if p['kind'] == 'object':
            if not re.fullmatch(r'#qf-object-[a-z0-9-]+', p['selector']) or p.get('shape') not in ('box','line'):
                raise ValueError('新增对象无效')
            for key in ('x','y','w','h') if p['shape']=='box' else ('x','y','x2','y2'):
                value=p.get(key)
                if type(value) not in (int,float) or not -10000 <= value <= 10000:
                    raise ValueError('图形坐标无效')
            if p['shape']=='box' and (p['w']<20 or p['h']<20 or not isinstance(p.get('text'),str) or len(p['text'])>20000):
                raise ValueError('文本框无效')
            if p['shape']=='line' and p.get('route') not in ('straight','horizontal','vertical'):
                raise ValueError('连线走向无效')
    prior = []
    pattern = r'<script data-qinfang-edit="1">(.*?)</script>'
    for script in re.findall(pattern, source, re.S):
        match = re.search(r'const patches=(.*?);function apply', script, re.S)
        if match:
            prior.extend(json.loads(match.group(1)))
    source = re.sub(pattern, '', source, flags=re.S)
    source = re.sub(r'<style data-qinfang-edit-style="1">.*?</style>', '', source, flags=re.S)
    merged = {}
    for item in prior + patches:
        key = (item['selector'], item['kind'])
        if key in merged and item['kind'] == 'text':
            merged[key]['after'] = item['after']
        elif key in merged and item['kind'] in ('attrs','style'):
            merged[key]['values'].update(item['values'])
        else:
            merged[key] = dict(item)
    patches = [p for p in merged.values() if p['kind'] != 'text' or p['before'] != p['after']]
    data = json.dumps(patches, ensure_ascii=False).replace('<', '\\u003c')
    # A source-based patch avoids serializing a partly played animation or losing its scripts.
    script = (Path(__file__).parent / 'web' / 'direct-runtime.js').read_text().replace('__PATCH_DATA__', data)
    hidden = ''.join(p['selector'] + '{display:none!important}' for p in patches if p['kind'] == 'hide')
    return source + '\n<style data-qinfang-edit-style="1">' + hidden + '</style><script data-qinfang-edit="1">' + script + '</script>'
