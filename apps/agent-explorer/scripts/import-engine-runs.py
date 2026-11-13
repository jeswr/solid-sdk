# AUTHORED-BY Claude Fable 5.2
# Copies the reference runtime's data-driven runs into the explorer.
# Usage: python3 scripts/import-engine-runs.py <traces dir> <scenario-runs.json>
# 1. copies the run manifest to data/scenario-runs.json and regenerates data/use-cases.json;
# 2. copies each trace into traces/, giving it the catalogue's title for its use case and
#    path, a readable name for any agent whose name is only its id, and spaces in step titles. Nothing else in a
#    trace is changed: events, checks, verdicts and reasons are the runtime's own.
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
src, manifest = sys.argv[1], sys.argv[2]

m = json.load(open(manifest))
json.dump(dict(note='Copied from packages/agent-reference/scenario-runs.json by scripts/import-engine-runs.py.',
               paths=m['paths']), open(os.path.join(ROOT, 'data', 'scenario-runs.json'), 'w'), indent=1)
subprocess.check_call([sys.executable, os.path.join(HERE, 'use-cases.src.py')])
U = {u['id']: u for u in json.load(open(os.path.join(ROOT, 'data', 'use-cases.json')))['useCases']}

def readable(agent_id):
    words = agent_id.replace('-', ' ').split()
    if words and words[-1] == 'agent' and len(words) > 1:
        return 'The ' + ' '.join(words[:-1]) + "'s agent"
    return 'The ' + ' '.join(words)

n = 0
for p in m['paths']:
    if p['status'] != 'runs': continue
    t = json.load(open(os.path.join(src, p['trace'])))
    u = U.get(p['scenario'])
    if u:
        run = [r for r in u.get('runs', []) if r['path'] == p['path']][0]
        t['scenario']['title'] = u['title'] if p['path'] == 'main' else u['title'] + ': ' + run['label'][0].lower() + run['label'][1:]
        t['useCase'] = u['id']
        for a in t['agents']:
            if a.get('name') == a['id']: a['name'] = readable(a['id'])
        for k, v in t['scenario'].get('steps', {}).items():
            if re.fullmatch(r'[a-z0-9-]+', v): t['scenario']['steps'][k] = v.replace('-', ' ').capitalize()
    json.dump(t, open(os.path.join(ROOT, 'traces', p['trace']), 'w'), indent=1, ensure_ascii=False)
    n += 1
print(n, 'traces imported')
subprocess.check_call(['node', os.path.join(HERE, 'bundle-data.mjs')])
