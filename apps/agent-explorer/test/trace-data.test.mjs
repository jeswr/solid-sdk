// AUTHORED-BY Codex GPT-6
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';
import test from 'node:test';
import traceData from '../js/trace-data.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const util = readFileSync(new URL('../js/util.js', import.meta.url), 'utf8');
const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url), 'utf8'));

async function fixture() {
  const { stdout } = await promisify(execFile)('python3', ['-c', `
import copy, importlib.util, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('importer', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
def attachment(n): return dict(digest='sha-256:test-' + str(n), mediaType='text/plain', byteLength=n, bytes='A'*n)
shared = {'literal': 'signed “text” with unicode ’ ' * 30, '$ref': 'recorded, not a reference'}
packet = {'jsonld': {'@context': shared, 'constructor': shared, '__proto__': shared}, 'rdf': 'original RDF\\n' * 100, 'attachments': [attachment(2048), attachment(2049)]}
t = dict(schema='agent-trace/0.1', scenario=dict(id='fixture'), configuration=dict(id='baseline'), agents=[],
         events=[dict(seq=1, step=1, kind='message-out', packet=copy.deepcopy(packet), settlement=dict(objects=[shared], facts=shared)),
                 dict(seq=2, step=1, kind='message-in', packet=copy.deepcopy(packet), settlement=dict(objects=[shared], facts=shared))])
original = copy.deepcopy(t)
m.omit_attachment_bytes(t)
omitted = copy.deepcopy(t)
m.intern_event_values(t)
print(json.dumps(dict(original=original, omitted=omitted, packed=t)))
`, root + 'scripts/import-engine-runs.py'], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

function browser(fetch) {
  const index = { key: 'fixture--baseline', schema: 'agent-trace/0.1', scenario: { id: 'fixture' }, configuration: { id: 'baseline' }, generated: {}, traceUrl: 'data/traces/fixture--baseline.json', summary: {} };
  const window = { AGENT_EXPLORER_DATA: { model, traces: [index] }, AXTraceData: traceData };
  window.self = window.top = window;
  const context = vm.createContext({ window, fetch, location: { hash: '#/start' }, history: {}, Map });
  vm.runInContext(util, context);
  return { AX: window.AX, index, context, window };
}

const copy = await fixture();

test('importer omits only attachment bytes over 2 KB, preserving boundary and metadata', () => {
  for (const e of copy.omitted.events) {
    const [small, large] = e.packet.attachments;
    assert.deepEqual(small, copy.original.events[0].packet.attachments[0]);
    assert.deepEqual(large, { ...copy.original.events[0].packet.attachments[1], bytes: null, bytesOmitted: true });
    assert.deepEqual(e.packet.jsonld, copy.original.events[0].packet.jsonld);
    assert.equal(e.packet.rdf, copy.original.events[0].packet.rdf);
  }
});

test('Python interning and shared JS decoder round-trip nested values without sentinel collisions', () => {
  assert.ok(copy.packed.explorerCopy.refs.length > 2);
  const decoded = traceData.restore(structuredClone(copy.packed));
  assert.deepEqual(decoded, copy.omitted);
  decoded.events[0].settlement.facts.literal = 'edited for display';
  assert.equal(decoded.events[1].settlement.facts.literal, copy.omitted.events[1].settlement.facts.literal);
  assert.equal(Object.prototype.literal, undefined);
});

test('decoder rejects unsupported encodings and references outside the event/pool data', () => {
  assert.throws(() => traceData.restore({ explorerCopy: { encoding: 'future' } }), /encoding/);
  const packed = structuredClone(copy.packed);
  packed.explorerCopy.refs[0][0] = ['scenario', 'id'];
  assert.throws(() => traceData.restore(packed), /reference/);
});

test('async accessor shares in-flight and resolved requests and keeps the index event-free', async () => {
  let count = 0, finish;
  const { AX, index } = browser((url) => {
    assert.equal(url, 'data/traces/fixture--baseline.json');
    count++;
    return new Promise((resolve) => { finish = resolve; });
  });
  const first = AX.loadTrace(index), second = AX.loadTrace(index.key);
  assert.equal(first, second);
  assert.equal(count, 1);
  assert.equal(index.events, undefined);
  finish({ ok: true, json: async () => structuredClone(copy.packed) });
  const full = await first;
  assert.deepEqual(full.events[0].packet, copy.omitted.events[0].packet);
  assert.equal(full.events[1]._i, 1);
  assert.equal(await AX.loadTrace(index.key), full);
  assert.equal(count, 1);
  assert.equal(index.events, undefined);
});

test('failed requests can be retried and mismatched trace documents are rejected', async () => {
  let count = 0;
  const { AX, index } = browser(async () => {
    count++;
    if (count === 1) return { ok: false, status: 404 };
    return { ok: true, json: async () => structuredClone(copy.packed) };
  });
  await assert.rejects(AX.loadTrace(index), /HTTP 404/);
  assert.ok((await AX.loadTrace(index)).events.length);
  assert.equal(count, 2);
  const bad = browser(async () => ({ ok: true, json: async () => ({ ...structuredClone(copy.packed), scenario: { id: 'wrong' } }) }));
  await assert.rejects(bad.AX.loadTrace(bad.index), /does not match/);
});

test('overview views render from the index without fetching event data', () => {
  const index = {
    key: 'mortgage-main--baseline', schema: 'agent-trace/0.1', scenario: { id: 'mortgage-main', title: 'Mortgage' },
    configuration: { id: 'baseline' }, generated: {},
    summary: { eventCount: 7, checkCounts: { pass: 3 }, parts: { core: { step: 1, seq: 1 } }, checks: { integrity: { step: 1, seq: 2 } }, segments: { payment: { range: [3, 6], step: 2, seq: 4 } }, requirements: {}, diffSteps: {} },
  };
  const window = { AGENT_EXPLORER_DATA: {
    model, traces: [index], useCases: JSON.parse(readFileSync(new URL('../data/use-cases.json', import.meta.url), 'utf8')),
    specs: [{ id: '01-core', title: 'Core', markdown: '# Core\n\nContent.' }],
  } };
  window.self = window.top = window;
  const context = vm.createContext({ window, fetch: () => { throw new Error('overview fetched a trace'); }, location: { hash: '#/start' }, history: {} });
  for (const file of ['util', 'markdown', 'diagram', 'views', 'requirements', 'specs', 'start']) {
    vm.runInContext(readFileSync(root + 'js/' + file + '.js', 'utf8'), context);
  }
  const AX = window.AX;
  const output = {};
  for (const [view, params] of [['architecture', { select: 'integrity' }], ['message', {}], ['layers', {}], ['tests', {}], ['requirements', {}], ['specs', {}], ['start', {}]]) {
    const container = { innerHTML: '', querySelectorAll: () => [] };
    AX.render[view](container, params);
    assert.ok(container.innerHTML.length > 100, view);
    output[view] = container.innerHTML;
  }
  assert.match(output.architecture, /seq=2/);
  assert.match(output.tests, /7<small>events, 3 checks/);
  vm.runInContext(readFileSync(root + 'js/usecases.js', 'utf8'), context);
  for (const tab of ['catalogue', 'struggles', 'coverage']) {
    const container = { innerHTML: '' };
    AX.render.usecases(container, { tab });
    assert.ok(container.innerHTML.includes('situations, one design'));
  }
  assert.equal(index.events, undefined);
});

test('bundler rejects oversized traces, unsafe keys and duplicate keys before replacing output', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'explorer-bundle-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['scripts', 'js', 'data', 'traces']) mkdirSync(join(dir, name));
  for (const name of ['scripts/bundle-data.mjs', 'scripts/site-files.mjs', 'js/trace-data.js', 'data/model.json']) {
    copyFileSync(root + name, join(dir, name));
  }
  const trace = { schema: 'agent-trace/0.1', scenario: { id: 'test' }, configuration: { id: 'baseline' }, events: [{ seq: 1, step: 1, kind: 'record' }] };
  const input = join(dir, 'traces/a.json');
  const output = join(dir, 'data/bundle.js');
  writeFileSync(output, 'previous valid bundle');
  async function fails(pattern) {
    await assert.rejects(promisify(execFile)(process.execPath, [join(dir, 'scripts/bundle-data.mjs')]), (e) => {
      assert.match(e.stderr, pattern);
      return true;
    });
    assert.equal(readFileSync(output, 'utf8'), 'previous valid bundle');
  }
  writeFileSync(input, JSON.stringify({ ...trace, events: [{ caption: 'x'.repeat(12_000_000) }] }));
  await fails(/trace file is .*limit is 12000000 bytes/);
  writeFileSync(input, JSON.stringify({ ...trace, scenario: { id: '../../escape' } }));
  await fails(/unsafe trace key/);
  writeFileSync(input, JSON.stringify(trace));
  writeFileSync(join(dir, 'traces/b.json'), JSON.stringify(trace));
  await fails(/duplicate trace key/);
});

// A small DOM seam for asynchronous state tests; browser layout is checked separately.
function exploreDOM(setup) {
  const nodes = new Map();
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, {
      innerHTML: '', style: { setProperty() {} }, classList: { toggle() {} },
      addEventListener() {}, closest() { return node('parent'); },
    });
    return nodes.get(key);
  }
  const buttons = [node('back'), node('next'), node('play')];
  const container = {
    innerHTML: '', querySelector: node,
    querySelectorAll: (selector) => selector === '.timeline button' ? buttons : [],
  };
  Object.assign(setup.window, { innerWidth: 1200, addEventListener() {} });
  Object.assign(setup.context, {
    document: { dispatchEvent() {} },
    CustomEvent: function () {},
    cancelAnimationFrame() {},
  });
  vm.runInContext(readFileSync(root + 'js/explore.js', 'utf8'), setup.context);
  return { container, node, buttons, E: setup.AX.explore };
}

test('Explore shows loading, ignores controls until ready and cannot repaint after unmount', async () => {
  let complete, calls = 0;
  const setup = browser(() => { calls++; return new Promise(resolve => { complete = resolve; }); });
  const { E, container, node, buttons } = exploreDOM(setup);
  const ready = E.mount(container, { scenario: 'fixture' });
  assert.match(node('#stage-figure').innerHTML, /role="status">Loading trace/);
  assert.ok(buttons.every(b => b.disabled));
  assert.doesNotThrow(() => { E.home(); E.end(); E.move(1); E.toggle(); });
  E.unmount();
  container.innerHTML = 'another view';
  complete({ ok: true, json: async () => structuredClone(copy.packed) });
  await ready;
  assert.equal(container.innerHTML, 'another view');
  assert.equal(E.state.trace, null);
  assert.equal(calls, 1);
});

test('Explore reports a plain loading error and permits an explicit retry', async () => {
  let calls = 0;
  const setup = browser(async () => { calls++; return { ok: false, status: 503 }; });
  const { E, container, node } = exploreDOM(setup);
  await E.mount(container, { scenario: 'fixture' });
  assert.match(node('#stage-figure').innerHTML, /role="alert"/);
  assert.match(node('#stage-figure').innerHTML, /Could not load this trace.*HTTP 503/);
  assert.match(node('#stage-figure').innerHTML, /Try again/);
  await E.apply({ scenario: 'fixture' });
  assert.equal(calls, 2);
  E.unmount();
});
