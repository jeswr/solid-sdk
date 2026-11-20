// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// Bundles data/model.json, data/scenarios.json, data/roadmap.json (if present), traces/*.json,
// tours/*.json and the spec documents in ../../docs/specs/agent/*.md (if present) into
// data/bundle.js (metadata and summaries), plus one fetchable JSON file per trace.
// Usage: node scripts/bundle-data.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import traceData from '../js/trace-data.js';
import { printSizeReport } from './site-files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readDir = (dir) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir))
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => ({ file: f, data: readJson(join(root, dir, f)) }))
    : [];

const model = readJson(join(root, 'data/model.json'));
const scenariosPath = join(root, 'data/scenarios.json');
const scenarios = existsSync(scenariosPath) ? readJson(scenariosPath) : {};

// Only these recorded metadata fields are needed before a trace is opened. The full
// document (including agents, parties and stand-ins) lives in its per-trace file.
const INDEX_FIELDS = ['schema', 'scenario', 'configuration', 'generated', 'expected', 'useCase', 'path'];
const baselineLayers = Object.fromEntries([...model.layers, ...(model.settlement ? [model.settlement] : [])]
  .map((l) => [l.id, (l.suites.find((s) => s.baseline) || l.suites[0]).id]));
const traces = [];
const traceFiles = [];
const outlines = new Map();
const seen = new Set();
const outPath = process.env.AX_BUNDLE_OUT ?? join(root, 'data/bundle.js');
const traceDir = join(dirname(outPath), 'traces');
const MAX_TRACE_BYTES = 12_000_000;
function outline(events) {
  return events.filter((e) => /^(check|decision|message-in|message-out|ask-principal)$/.test(e.kind))
    .map((e) => [e.agent, e.part, e.kind, e.check || '', e.verdict || '', e.reason || ''].join('|')).join('\n');
}
function target(e) { return e ? { step: e.step, seq: e.seq } : null; }
for (const file of readdirSync(join(root, 'traces')).filter((f) => f.endsWith('.json')).sort()) {
  const packed = readJson(join(root, 'traces', file));
  if (packed.schema !== 'agent-trace/0.1') {
    console.warn(`skip ${file}: schema is ${packed.schema}, expected agent-trace/0.1`);
    continue;
  }
  if (!packed.scenario?.id || !packed.configuration?.id || !Array.isArray(packed.events)) {
    throw new Error(`${file}: missing scenario.id, configuration.id or events`);
  }
  const key = packed.scenario.id + '--' + packed.configuration.id;
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error(`${file}: unsafe trace key`);
  if (seen.has(key)) throw new Error(`${file}: duplicate trace key ${key}`);
  seen.add(key);
  const text = JSON.stringify(packed) + '\n';
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_TRACE_BYTES) throw new Error(`${key}: trace file is ${bytes} bytes; limit is ${MAX_TRACE_BYTES} bytes`);
  traceFiles.push({ name: key + '.json', text });
  const t = traceData.restore(packed);
  const summary = { eventCount: t.events.length, checkCounts: {}, parts: {}, checks: {}, segments: {}, requirements: {} };
  const grouped = {};
  t.events.forEach((e, i) => {
    (grouped[e.step] ??= []).push(e);
    if (e.kind === 'check') {
      summary.checkCounts[e.verdict] = (summary.checkCounts[e.verdict] || 0) + 1;
      if (e.verdict !== 'not-applicable') summary.checks[e.check] ??= target(e);
    }
    summary.parts[e.part] ??= target(e);
    if (e.segment) summary.segments[e.segment] ??= { range: [i, t.events.length - 1], ...target(e) };
    if (e.segmentEnd && summary.segments[e.segmentEnd]) summary.segments[e.segmentEnd].range[1] = i;
  });
  for (const risk of model.requirements?.owaspAgentic || []) {
    if (risk.trace !== key) continue;
    const where = risk.where || [];
    const named = (e) => e.kind === 'check' && where.includes(e.check);
    const e = t.events.find((e) => named(e) && e.verdict !== 'pass' && e.verdict !== 'not-applicable') ||
      t.events.find((e) => named(e) && e.verdict === 'pass') ||
      t.events.find((e) => where.includes(e.part)) || t.events[0];
    summary.requirements[risk.id] = target(e);
  }
  outlines.set(key, Object.fromEntries(Object.entries(grouped).map(([step, events]) => [step, outline(events)])));
  const index = Object.fromEntries(INDEX_FIELDS.filter((k) => k in t).map((k) => [k, t[k]]));
  index.file = file;
  index.key = key;
  index.traceUrl = 'data/traces/' + key + '.json';
  index.summary = summary;
  traces.push(index);
}
// Preserve the browser's baseline preference and outline comparison without fetching a
// second trace when a configuration is opened (or any traces when the matrix is opened).
function isBaseline(t) {
  const layers = { ...baselineLayers, ...t.configuration.layers };
  return Object.keys(baselineLayers).every((k) => layers[k] === baselineLayers[k]);
}
for (const t of traces) {
  const list = traces.filter((x) => x.scenario.id === t.scenario.id);
  const base = list.find((x) => isBaseline(x) && x.generated?.core !== 'fixture') || list.find(isBaseline) || list[0];
  const bs = outlines.get(base.key), ts = outlines.get(t.key);
  t.summary.diffSteps = Object.fromEntries(Object.keys(ts).filter((k) => bs[k] !== ts[k]).map((k) => [k, true]));
}
const tours = readDir('tours').map(({ data }) => data);

const roadmapPath = join(root, 'data/roadmap.json');
// The roadmap is a working plan for the project's own team. A public build (AX_PUBLIC=1)
// leaves it out, and the Roadmap tab then does not appear.
const isPublic = process.env.AX_PUBLIC === '1';
const roadmap = !isPublic && existsSync(roadmapPath) ? readJson(roadmapPath) : null;

const specsDir = join(root, '../../docs/specs/agent');
const specs = existsSync(specsDir)
  ? readdirSync(specsDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => {
        const markdown = readFileSync(join(specsDir, f), 'utf8');
        const h = markdown.match(/^#\s+(.+?)\s*#*\s*$/m);
        return { id: f.replace(/\.md$/, ''), title: h ? h[1] : f.replace(/\.md$/, ''), markdown };
      })
  : [];

const payload = { model, scenarios, traces, tours, specs };
if (roadmap) payload.roadmap = roadmap;
const useCasesPath = join(root, 'data/use-cases.json');
if (existsSync(useCasesPath)) payload.useCases = readJson(useCasesPath);
const evalPath = join(root, 'data/eval-agentdojo.json');
if (existsSync(evalPath)) payload.evalAgentDojo = readJson(evalPath);
const evalE2Path = join(root, 'data/eval-agentdojo-e2.json');
if (existsSync(evalE2Path)) payload.evalAgentDojoE2 = readJson(evalE2Path);
const header = '// Generated by scripts/bundle-data.mjs. Do not edit by hand.\n';
const out = `${header}window.AGENT_EXPLORER_DATA = ${JSON.stringify(payload)};\n`;
// Validate all trace sizes and keys before replacing generated output. Remove stale
// per-trace files and the old eager chunks, so uploads cannot accidentally include both.
mkdirSync(dirname(outPath), { recursive: true });
rmSync(traceDir, { recursive: true, force: true });
mkdirSync(traceDir, { recursive: true });
for (const { name, text } of traceFiles) writeFileSync(join(traceDir, name), text);
for (const f of readdirSync(dirname(outPath))) {
  if (/^traces-\d+\.js$/.test(f)) rmSync(join(dirname(outPath), f));
}
writeFileSync(outPath, out);
console.log(`wrote ${outPath}: ${traces.length} trace index entries, ${tours.length} tours, ${specs.length} specs, roadmap ${roadmap ? 'yes' : 'no'}`);
printSizeReport(dirname(outPath));
