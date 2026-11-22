# AUTHORED-BY Claude Fable 5.2
# AUTHORED-BY Codex GPT-6
# Copies the reference runtime's data-driven runs into the explorer.
# Usage: python3 scripts/import-engine-runs.py <traces dir> <scenario-runs.json> [commit]
# Pass the commit only when the traces were generated from exactly that commit's tree before
# it was committed (the runtime stamps the HEAD it sees, which is then the parent).
# 1. copies the run manifest to data/scenario-runs.json and regenerates data/use-cases.json;
# 2. copies each trace into traces/, giving it the catalogue's title for its use case and
#    path, readable agent names and readable step titles. Recorded event text is never rewritten.
# 3. removes explorer traces and linked tables no longer referenced by imported runs.
# Explorer copy policy: attachment base64 `bytes` longer than 2048 bytes become null,
# with bytesOmitted: true. digest, mediaType and byteLength stay unchanged. Smaller
# attachments, packet jsonld/rdf, checks, decisions, reasons, captions, settlement
# objects and facts are copied exactly. The engine repository keeps the full record.
# Repeated objects, lists and long strings within a trace are stored once in
# explorerCopy.values; explorerCopy.refs holds [path, value index] in dependency order.
# The bundle reader and browser's async trace accessor restore independent copies
# before using any events. This is lossless, including packet JSON-LD and RDF strings.
# Shared linked tables keep their original keys and view text.
import json, os, re, stat, subprocess, sys
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
MAX_LINKED_TABLE_BYTES = 12_000_000

def traces_directory(directory):
    root = Path(directory)
    if not stat.S_ISDIR(root.lstat().st_mode):
        raise ValueError(f'{root}: traces must be a regular directory')
    return root.resolve(strict=True)

def linked_directory(root, *, create=False):
    linked = root / 'linked'
    if create:
        try:
            linked.mkdir()
        except FileExistsError:
            pass
    if not stat.S_ISDIR(linked.lstat().st_mode) or linked.resolve(strict=True) != linked:
        raise ValueError(f'{linked}: linked must be a regular directory inside traces')
    return linked

def linked_table_path(directory, reference, *, create=False):
    root = traces_directory(directory)
    linked = linked_directory(root, create=create)
    path = root / reference
    if path.parent != linked:
        raise ValueError(f'{path}: linked table must be directly inside traces/linked')
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        if create:
            return path
        raise
    if not stat.S_ISREG(mode) or path.resolve(strict=True) != path:
        raise ValueError(f'{path}: linked table must be a regular file inside traces/linked')
    return path

def existing_trace_files(root):
    directories = [root]
    try:
        directories.append(linked_directory(root))
    except FileNotFoundError:
        pass
    files = set()
    for directory in directories:
        for path in directory.glob('*.json'):
            if not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError(f'{path}: expected a regular file inside traces')
            files.add(path)
    return files

def validate_linked_reference(row, reference):
    scenario, configuration = row['scenario'], row.get('configuration', 'baseline')
    if (not isinstance(reference, str)
            or not re.fullmatch(r'linked/[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*\.json', reference)
            or reference != f'linked/{scenario}--{configuration}.json'):
        raise ValueError(f'{scenario}/{configuration}: invalid linked table reference')

def copy_linked_table(src, dest, reference):
    with linked_table_path(src, reference).open(encoding='utf-8') as source:
        table = json.load(source)
    text = json.dumps(table, ensure_ascii=False, separators=(',', ':')) + '\n'
    data = text.encode('utf-8')
    if len(data) > MAX_LINKED_TABLE_BYTES:
        raise ValueError(f'{reference}: linked table is {len(data)} bytes; limit is {MAX_LINKED_TABLE_BYTES} bytes')
    linked_table_path(dest, reference, create=True).write_bytes(data)

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
    src = traces_directory(src)
    dest = traces_directory(os.path.join(ROOT, 'traces'))
    stale = existing_trace_files(dest)

    m = json.load(open(manifest))
    # Check every source trace before replacing the manifest, so a bad source leaves the
    # previous import (manifest and traces) in place rather than a half-written one.
    sources = {}
    for p in m['paths']:
        if p['status'] == 'blocked': continue
        file = p['trace']
        if not isinstance(file, str) or not re.fullmatch(r'[a-zA-Z0-9_-]+\.json', file):
            raise ValueError(f'{file}: invalid trace filename')
        source = src / file
        if not stat.S_ISREG(source.lstat().st_mode):
            raise ValueError(f'{source}: expected a regular trace file')
        sources[file] = source
    json.dump(dict(note='Copied from packages/agent-reference/scenario-runs.json by scripts/import-engine-runs.py.',
                   paths=m['paths']), open(os.path.join(ROOT, 'data', 'scenario-runs.json'), 'w'), indent=1)
    subprocess.check_call([sys.executable, os.path.join(HERE, 'use-cases.src.py')])
    U = {u['id']: u for u in json.load(open(os.path.join(ROOT, 'data', 'use-cases.json')))['useCases']}

    commit = sys.argv[3] if len(sys.argv) > 3 else None
    n = 0
    tables = set()
    for p in m['paths']:
        if p['status'] == 'blocked': continue
        file = p['trace']
        source = sources[file]
        t = json.loads(source.read_text(encoding='utf-8'))
        if 'linkedTable' in t:
            reference = t['linkedTable']
            validate_linked_reference(p, reference)
            if reference not in tables:
                copy_linked_table(src, dest, reference)
                tables.add(reference)
                stale.discard(dest / reference)
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
        (dest / file).write_text(text + '\n', encoding='utf-8')
        stale.discard(dest / file)
        n += 1
    for path in sorted(stale):
        path.unlink()
    print(n, 'traces imported')
    subprocess.check_call(['node', os.path.join(HERE, 'bundle-data.mjs')])

if __name__ == '__main__':
    main()
