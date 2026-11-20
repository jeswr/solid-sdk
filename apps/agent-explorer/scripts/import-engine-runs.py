# AUTHORED-BY Claude Fable 5.2
# AUTHORED-BY Codex GPT-6
# Copies the reference runtime's data-driven runs into the explorer.
# Usage: python3 scripts/import-engine-runs.py <traces dir> <scenario-runs.json> [commit]
# Pass the commit only when the traces were generated from exactly that commit's tree before
# it was committed (the runtime stamps the HEAD it sees, which is then the parent).
# 1. copies the run manifest to data/scenario-runs.json and regenerates data/use-cases.json;
# 2. copies each trace into traces/, giving it the catalogue's title for its use case and
#    path, readable agent names and readable step titles. Recorded event text is never rewritten.
# Explorer copy policy: attachment base64 `bytes` longer than 2048 bytes become null,
# with bytesOmitted: true. digest, mediaType and byteLength stay unchanged. Smaller
# attachments, packet jsonld/rdf, checks, decisions, reasons, captions, settlement
# objects and facts are copied exactly. The engine repository keeps the full record.
# Repeated objects, lists and long strings within a trace are stored once in
# explorerCopy.values; explorerCopy.refs holds [path, value index] in dependency order.
# The bundle reader and browser's async trace accessor restore independent copies
# before using any events. This is lossless, including packet JSON-LD and RDF strings.
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')

def readable(agent_id):
    words = agent_id.replace('-', ' ').split()
    if words and words[-1] == 'agent' and len(words) > 1:
        return 'The ' + ' '.join(words[:-1]) + "'s agent"
    return 'The ' + ' '.join(words)

def omit_attachment_bytes(value):
    if isinstance(value, dict):
        if (all(k in value for k in ('digest', 'mediaType', 'byteLength'))
                and isinstance(value.get('bytes'), str)
                and len(value['bytes'].encode('utf-8')) > 2048):
            value['bytes'] = None
            value['bytesOmitted'] = True
        for child in value.values(): omit_attachment_bytes(child)
    elif isinstance(value, list):
        for child in value: omit_attachment_bytes(child)

def intern_event_values(trace):
    # Paths, rather than sentinel keys in recorded objects, prevent collisions with
    # arbitrary JSON-LD/protocol data. References to nested pool values come first.
    if 'explorerCopy' in trace: raise ValueError('trace already has explorerCopy metadata')
    counts = {}
    def key(value):
        if not isinstance(value, (dict, list, str)): return None
        text = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        return text if len(text) >= 256 else None
    def scan(value):
        text = key(value)
        if text is not None: counts[text] = counts.get(text, 0) + 1
        if isinstance(value, dict):
            for child in value.values(): scan(child)
        elif isinstance(value, list):
            for child in value: scan(child)
    scan(trace['events'])
    values, refs, indices = [], [], {}
    def children(value, path):
        if isinstance(value, dict):
            return {field: encode(child, path + [field]) for field, child in value.items()}
        elif isinstance(value, list):
            return [encode(child, path + [i]) for i, child in enumerate(value)]
        return value
    def encode(value, path):
        text = key(value)
        if text is not None and counts[text] > 1:
            if text not in indices:
                index = len(values)
                indices[text] = index
                values.append(None)
                values[index] = children(value, ['explorerCopy', 'values', index])
            refs.append([path, indices[text]])
            return None
        return children(value, path)
    trace['events'] = children(trace['events'], ['events'])
    if refs: trace['explorerCopy'] = dict(encoding='event-values/1', values=values, refs=refs)

def main():
    src, manifest = sys.argv[1], sys.argv[2]

    m = json.load(open(manifest))
    json.dump(dict(note='Copied from packages/agent-reference/scenario-runs.json by scripts/import-engine-runs.py.',
                   paths=m['paths']), open(os.path.join(ROOT, 'data', 'scenario-runs.json'), 'w'), indent=1)
    subprocess.check_call([sys.executable, os.path.join(HERE, 'use-cases.src.py')])
    U = {u['id']: u for u in json.load(open(os.path.join(ROOT, 'data', 'use-cases.json')))['useCases']}

    commit = sys.argv[3] if len(sys.argv) > 3 else None
    n = 0
    for p in m['paths']:
        if p['status'] == 'blocked': continue
        t = json.load(open(os.path.join(src, p['trace'])))
        u = U.get(p.get('useCase') or p['scenario'])
        if u and not t.get('useCase'):
            run = [r for r in u.get('runs', []) if r['path'] == p['path']][0]
            t['scenario']['title'] = u['title'] if p['path'] == 'main' else u['title'] + ': ' + run['label'][0].lower() + run['label'][1:]
            t['useCase'] = u['id']
        for a in t['agents']:
            if a.get('name') == a['id']: a['name'] = readable(a['id'])
        for k, v in t['scenario'].get('steps', {}).items():
            if re.fullmatch(r'[a-z0-9-]+', v): t['scenario']['steps'][k] = v.replace('-', ' ').capitalize()
        if commit: t['generated']['commit'] = commit
        omit_attachment_bytes(t)
        intern_event_values(t)
        text = json.dumps(t, ensure_ascii=False, separators=(',', ':'))
        open(os.path.join(ROOT, 'traces', p['trace']), 'w').write(text + '\n')
        n += 1
    print(n, 'traces imported')
    subprocess.check_call(['node', os.path.join(HERE, 'bundle-data.mjs')])

if __name__ == '__main__':
    main()
