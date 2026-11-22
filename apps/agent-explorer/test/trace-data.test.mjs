// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.2 Sol
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";
import traceData from "../js/trace-data.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const util = readFileSync(new URL("../js/util.js", import.meta.url), "utf8");
const highlighter = readFileSync(new URL("../js/highlight.js", import.meta.url), "utf8");
const model = JSON.parse(readFileSync(new URL("../data/model.json", import.meta.url), "utf8"));

async function fixture() {
  const { stdout } = await promisify(execFile)(
    "python3",
    [
      "-c",
      `
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
`,
      root + "scripts/import-engine-runs.py",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(stdout);
}

function browser(fetch, data) {
  const index = {
    key: "fixture--baseline",
    schema: "agent-trace/0.1",
    scenario: { id: "fixture" },
    configuration: { id: "baseline" },
    generated: {},
    traceUrl: "data/traces/fixture--baseline.json",
    summary: {},
  };
  const window = {
    AGENT_EXPLORER_DATA: data || { model, traces: [index] },
    AXTraceData: traceData,
  };
  window.self = window.top = window;
  const context = vm.createContext({
    window,
    fetch,
    location: { hash: "#/start" },
    history: {},
    Map,
  });
  vm.runInContext(util, context);
  vm.runInContext(highlighter, context);
  vm.runInContext(readFileSync(root + "js/linked.js", "utf8"), context);
  return { AX: window.AX, index, context, window };
}

const copy = await fixture();

test("importer omits only attachment bytes over 2 KB, preserving boundary and metadata", () => {
  for (const e of copy.omitted.events) {
    const [small, large] = e.packet.attachments;
    assert.deepEqual(small, copy.original.events[0].packet.attachments[0]);
    assert.deepEqual(large, {
      ...copy.original.events[0].packet.attachments[1],
      bytes: null,
      bytesOmitted: true,
    });
    assert.deepEqual(e.packet.jsonld, copy.original.events[0].packet.jsonld);
    assert.equal(e.packet.rdf, copy.original.events[0].packet.rdf);
  }
});

test("Python interning and shared JS decoder round-trip nested values without sentinel collisions", () => {
  assert.ok(copy.packed.explorerCopy.refs.length > 2);
  const decoded = traceData.restore(structuredClone(copy.packed));
  assert.deepEqual(decoded, copy.omitted);
  decoded.events[0].settlement.facts.literal = "edited for display";
  assert.equal(
    decoded.events[1].settlement.facts.literal,
    copy.omitted.events[1].settlement.facts.literal,
  );
  assert.equal(Object.prototype.literal, undefined);
});

test("decoder rejects unsupported encodings and references outside the event/pool data", () => {
  assert.throws(() => traceData.restore({ explorerCopy: { encoding: "future" } }), /encoding/);
  const packed = structuredClone(copy.packed);
  packed.explorerCopy.refs[0][0] = ["scenario", "id"];
  assert.throws(() => traceData.restore(packed), /reference/);
});

test("async accessor shares in-flight and resolved requests and keeps the index event-free", async () => {
  let count = 0,
    finish;
  const { AX, index } = browser((url) => {
    assert.equal(url, "data/traces/fixture--baseline.json");
    count++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = AX.loadTrace(index),
    second = AX.loadTrace(index.key);
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

test("failed requests can be retried and mismatched trace documents are rejected", async () => {
  let count = 0;
  const { AX, index } = browser(async () => {
    count++;
    if (count === 1) return { ok: false, status: 404 };
    return { ok: true, json: async () => structuredClone(copy.packed) };
  });
  await assert.rejects(AX.loadTrace(index), /HTTP 404/);
  assert.ok((await AX.loadTrace(index)).events.length);
  assert.equal(count, 2);
  const bad = browser(async () => ({
    ok: true,
    json: async () => ({ ...structuredClone(copy.packed), scenario: { id: "wrong" } }),
  }));
  await assert.rejects(bad.AX.loadTrace(bad.index), /does not match/);
});

test("overview views render from the index without fetching event data", () => {
  const index = {
    key: "mortgage-main--baseline",
    schema: "agent-trace/0.1",
    scenario: { id: "mortgage-main", title: "Mortgage" },
    configuration: { id: "baseline" },
    generated: {},
    summary: {
      eventCount: 7,
      checkCounts: { pass: 3 },
      parts: { core: { step: 1, seq: 1 } },
      checks: { integrity: { step: 1, seq: 2 } },
      segments: { payment: { range: [3, 6], step: 2, seq: 4 } },
      requirements: {},
      diffSteps: {},
    },
  };
  const window = {
    AGENT_EXPLORER_DATA: {
      model,
      traces: [index],
      useCases: JSON.parse(
        readFileSync(new URL("../data/use-cases.json", import.meta.url), "utf8"),
      ),
      specs: [{ id: "01-core", title: "Core", markdown: "# Core\n\nContent." }],
    },
  };
  window.self = window.top = window;
  const context = vm.createContext({
    window,
    fetch: () => {
      throw new Error("overview fetched a trace");
    },
    location: { hash: "#/start" },
    history: {},
  });
  for (const file of [
    "util",
    "highlight",
    "markdown",
    "diagram",
    "views",
    "requirements",
    "specs",
    "start",
  ]) {
    vm.runInContext(readFileSync(root + "js/" + file + ".js", "utf8"), context);
  }
  const Ax = window.AX;
  const output = {};
  for (const [view, params] of [
    ["architecture", { select: "integrity" }],
    ["message", {}],
    ["layers", {}],
    ["tests", {}],
    ["requirements", {}],
    ["specs", {}],
    ["start", {}],
  ]) {
    const container = { innerHTML: "", querySelectorAll: () => [] };
    Ax.render[view](container, params);
    assert.ok(container.innerHTML.length > 100, view);
    output[view] = container.innerHTML;
  }
  assert.match(output.architecture, /seq=2/);
  assert.match(output.tests, /7<small>events, 3 checks/);
  assert.match(
    output.layers,
    new RegExp("<h1>" + model.layers.length + " layers, one suite each</h1>"),
  );
  assert.match(
    output.layers,
    /id="layer-settlement".*?Part of commitments, chosen at the point of payment/s,
  );
  vm.runInContext(readFileSync(root + "js/usecases.js", "utf8"), context);
  for (const tab of ["catalogue", "struggles", "coverage"]) {
    const container = { innerHTML: "" };
    Ax.render.usecases(container, { tab });
    assert.ok(container.innerHTML.includes("situations, one design"));
  }
  assert.equal(index.events, undefined);
});

function bundleFixture(t) {
  const repo = mkdtempSync(join(tmpdir(), "explorer-bundle-test-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const dir = join(repo, "apps/agent-explorer");
  for (const name of ["scripts", "js", "data", "traces"]) {
    mkdirSync(join(dir, name), { recursive: true });
  }
  for (const name of [
    "scripts/bundle-data.mjs",
    "scripts/site-files.mjs",
    "js/linked.js",
    "js/trace-data.js",
    "data/model.json",
  ]) {
    copyFileSync(root + name, join(dir, name));
  }
  const contextPath = "packages/agent-reference/vocab/context";
  mkdirSync(join(repo, contextPath), { recursive: true });
  for (const file of ["v1.jsonld", "store-v1.jsonld", "odrl-v1.jsonld", "scenario-v1.jsonld"]) {
    copyFileSync(join(root, "../..", contextPath, file), join(repo, contextPath, file));
  }
  return dir;
}

function buildPublicBundle(dir) {
  const log = join(dir, "warnings.log");
  const stderr = openSync(log, "w");
  try {
    const child = spawnSync(process.execPath, [join(dir, "scripts/bundle-data.mjs")], {
      env: { ...process.env, AX_PUBLIC: "1" },
      stdio: ["ignore", "ignore", stderr],
    });
    assert.ifError(child.error);
    const warnings = readFileSync(log, "utf8");
    assert.equal(child.status, 0, warnings);
    const output = readFileSync(join(dir, "data/bundle.js"), "utf8");
    return { output, warnings };
  } finally {
    closeSync(stderr);
  }
}

test("the public bundle reads regular spec Markdown and skips spec symlinks", (t) => {
  const dir = bundleFixture(t);
  const specsDir = join(dir, "../../docs/specs/agent");
  mkdirSync(specsDir, { recursive: true });
  const markdown = "# Public spec\n\nPublic content.\n";
  writeFileSync(join(specsDir, "public.md"), markdown);
  const roadmap = join(dir, "data/roadmap.json");
  writeFileSync(roadmap, JSON.stringify({ text: "private roadmap fixture" }));
  symlinkSync(roadmap, join(specsDir, "external.md"));
  symlinkSync("public.md", join(specsDir, "internal.md"));

  const { output, warnings } = buildPublicBundle(dir);
  assert.equal(
    output.includes("private roadmap fixture"),
    false,
    "the roadmap leaked into the bundle",
  );
  const bundle = { window: {} };
  vm.runInNewContext(output, bundle);
  assert.deepEqual(structuredClone(bundle.window.AGENT_EXPLORER_DATA.specs), [
    { id: "public", title: "Public spec", markdown },
  ]);
  assert.match(warnings, /external\.md.*symlink/);
  assert.match(warnings, /internal\.md.*symlink/);
});

test("the public bundle skips dangling spec symlinks and non-file entries", (t) => {
  const dir = bundleFixture(t);
  const specsDir = join(dir, "../../docs/specs/agent");
  mkdirSync(specsDir, { recursive: true });
  symlinkSync("missing.md", join(specsDir, "dangling.md"));
  mkdirSync(join(specsDir, "directory.md"));

  const { output, warnings } = buildPublicBundle(dir);
  assert.match(output, /"specs":\[\]/);
  assert.match(warnings, /dangling\.md.*symlink/);
  assert.match(warnings, /directory\.md.*regular file/);
});

test("the public bundle skips a specs directory reached through an outside ancestor", (t) => {
  const dir = bundleFixture(t);
  const docs = join(dir, "../../docs");
  const outside = join(dir, "outside");
  mkdirSync(docs);
  mkdirSync(join(outside, "agent"), { recursive: true });
  writeFileSync(join(outside, "agent/outside.md"), "# Private spec");
  symlinkSync(outside, join(docs, "specs"), "dir");

  const { output, warnings } = buildPublicBundle(dir);
  assert.equal(output.includes("Private spec"), false, "the outside spec leaked into the bundle");
  assert.match(output, /"specs":\[\]/);
  assert.match(warnings, /docs\/specs\/agent.*outside/);
});

test("bundler rejects oversized traces, unsafe keys and duplicate keys before replacing output", async (t) => {
  const dir = bundleFixture(t);
  const trace = {
    schema: "agent-trace/0.1",
    scenario: { id: "test" },
    configuration: { id: "baseline" },
    events: [{ seq: 1, step: 1, kind: "record" }],
  };
  const input = join(dir, "traces/a.json");
  const output = join(dir, "data/bundle.js");
  writeFileSync(output, "previous valid bundle");
  async function fails(pattern) {
    await assert.rejects(
      promisify(execFile)(process.execPath, [join(dir, "scripts/bundle-data.mjs")]),
      (e) => {
        assert.match(e.stderr, pattern);
        return true;
      },
    );
    assert.equal(readFileSync(output, "utf8"), "previous valid bundle");
  }
  writeFileSync(input, JSON.stringify({ ...trace, events: [{ caption: "x".repeat(12_000_000) }] }));
  await fails(/trace file is .*limit is 12000000 bytes/);
  writeFileSync(input, JSON.stringify({ ...trace, scenario: { id: "../../escape" } }));
  await fails(/unsafe trace key/);
  writeFileSync(input, JSON.stringify(trace));
  writeFileSync(join(dir, "traces/b.json"), JSON.stringify(trace));
  await fails(/duplicate trace key/);
});

test("the bundle copies only referenced tables and validates their size and event keys", async (t) => {
  const dir = bundleFixture(t);
  const reference = "linked/test--baseline.json";
  const key = `sha-256:${"a".repeat(64)}`;
  const trace = {
    schema: "agent-trace/0.1",
    scenario: { id: "test" },
    configuration: { id: "baseline" },
    linkedTable: reference,
    events: [{ step: 1, kind: "record", linked: [key] }],
  };
  const table =
    JSON.stringify({
      [key]: {
        what: "record-entry",
        context: "urn:context",
        jsonld: "{}",
        turtle: "<urn:s> a <urn:t> .",
      },
    }) + "\n";
  const input = join(dir, "traces/a.json");
  const source = join(dir, "traces", reference);
  const output = join(dir, "data/traces", reference);
  mkdirSync(join(dir, "traces/linked"));
  writeFileSync(input, JSON.stringify(trace));
  writeFileSync(source, table);
  writeFileSync(join(dir, "traces/linked/unused.json"), "{}");
  const bundle = buildPublicBundle(dir);
  assert.doesNotMatch(bundle.output, /linkedTable|linked\/test--baseline\.json/);
  assert.deepEqual(readdirSync(join(dir, "data/traces/linked")), ["test--baseline.json"]);
  assert.equal(readFileSync(output, "utf8"), table);
  const deployed = JSON.parse(readFileSync(join(dir, "data/traces/test--baseline.json"), "utf8"));
  assert.equal(deployed.linkedTable, reference);
  assert.deepEqual(deployed.events[0].linked, [key]);

  async function fails(pattern) {
    await assert.rejects(
      promisify(execFile)(process.execPath, [join(dir, "scripts/bundle-data.mjs")]),
      (e) => {
        assert.match(e.stderr, pattern);
        return true;
      },
    );
    assert.equal(readFileSync(output, "utf8"), table);
  }
  writeFileSync(source, " ".repeat(12_000_001));
  await fails(/linked table is .*limit is 12000000 bytes/);
  writeFileSync(source, "{}");
  await fails(/linked view is missing/);
  rmSync(source);
  const outside = join(dir, "outside.json");
  writeFileSync(outside, table);
  symlinkSync(outside, source);
  await fails(/linked table must be a regular file/);
  rmSync(join(dir, "traces/linked"), { recursive: true });
  symlinkSync(dir, join(dir, "traces/linked"), "dir");
  await fails(/linked tables require a regular directory/);
  writeFileSync(input, JSON.stringify({ ...trace, linkedTable: "../roadmap.json" }));
  await fails(/Invalid linked table reference/);
});

// A small DOM seam for asynchronous state tests; browser layout is checked separately.
function exploreDOM(setup) {
  const nodes = new Map();
  function node(key) {
    if (!nodes.has(key))
      nodes.set(key, {
        innerHTML: "",
        style: { setProperty() {} },
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {},
        querySelector: (selector) =>
          [".phone", ".rdf-dialog-content", "[data-rdf-close]"].includes(selector)
            ? node(selector)
            : null,
        querySelectorAll: () => [],
        addEventListener(type, listener) {
          this[type] = listener;
        },
        closest() {
          return node("parent");
        },
      });
    return nodes.get(key);
  }
  const buttons = [node("back"), node("next"), node("play")];
  const container = {
    innerHTML: "",
    querySelector: (selector) => {
      if (
        selector === ".tick.cur" ||
        selector.startsWith(".tick[data-i=") ||
        selector.startsWith(".scrub-step[data-run=")
      )
        return null;
      if (selector === ".scrub-track") return node("#scrub").innerHTML ? node(selector) : null;
      return node(selector);
    },
    querySelectorAll: (selector) => (selector === ".timeline button" ? buttons : []),
  };
  Object.assign(setup.window, { innerWidth: 1200, addEventListener() {} });
  Object.assign(setup.context, {
    document: { body: node("body"), dispatchEvent() {} },
    CustomEvent: class {},
    cancelAnimationFrame() {},
  });
  vm.runInContext(readFileSync(root + "js/explore.js", "utf8"), setup.context);
  return { container, node, buttons, E: setup.AX.explore };
}

test("Explore shows loading, ignores controls until ready and cannot repaint after unmount", async () => {
  let complete,
    calls = 0;
  const setup = browser(() => {
    calls++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const { E, container, node, buttons } = exploreDOM(setup);
  const ready = E.mount(container, { scenario: "fixture" });
  assert.match(node("#stage-figure").innerHTML, /role="status">Loading trace/);
  assert.ok(buttons.every((b) => b.disabled));
  assert.doesNotThrow(() => {
    E.home();
    E.end();
    E.move(1);
    E.toggle();
  });
  E.unmount();
  container.innerHTML = "another view";
  complete({ ok: true, json: async () => structuredClone(copy.packed) });
  await ready;
  assert.equal(container.innerHTML, "another view");
  assert.equal(E.state.trace, null);
  assert.equal(calls, 1);
});

test("Explore reports a plain loading error and permits an explicit retry", async () => {
  let calls = 0;
  const setup = browser(async () => {
    calls++;
    return { ok: false, status: 503 };
  });
  const { E, container, node } = exploreDOM(setup);
  await E.mount(container, { scenario: "fixture" });
  assert.match(node("#stage-figure").innerHTML, /role="alert"/);
  assert.match(node("#stage-figure").innerHTML, /Could not load this trace.*HTTP 503/);
  assert.match(node("#stage-figure").innerHTML, /Try again/);
  await E.apply({ scenario: "fixture" });
  assert.equal(calls, 2);
  E.unmount();
});

test("Explore keeps the inspector open when a shared table is unavailable", async (t) => {
  const file = "age-check--baseline.json";
  const trace = JSON.parse(readFileSync(join(root, "traces", file), "utf8"));
  delete trace.linked;
  delete trace.linkedTable;
  const dir = bundleFixture(t);
  writeFileSync(join(dir, "traces", file), JSON.stringify(trace));
  const bundle = { window: {} };
  vm.runInNewContext(buildPublicBundle(dir).output, bundle);
  trace.linkedTable = "linked/age-check--baseline.json";
  const traceUrl = `data/traces/${file}`;
  const requests = [];
  const setup = browser(async (url) => {
    requests.push(url);
    return url === traceUrl ? { ok: true, json: async () => trace } : { ok: false, status: 404 };
  }, bundle.window.AGENT_EXPLORER_DATA);
  for (const name of ["diagram", "phone"])
    vm.runInContext(readFileSync(root + "js/" + name + ".js", "utf8"), setup.context);
  const { E, container, node } = exploreDOM(setup);
  await E.mount(container, { scenario: "age-check" });
  assert.deepEqual(requests, [traceUrl, "data/traces/linked/age-check--baseline.json"]);
  assert.match(node("#inspector").innerHTML, /The linked RDF views could not be loaded\./);
  assert.match(node("#inspector").innerHTML, /Step 1 of /);
  E.unmount();
});

test("Home shows the model layer count and seeks the current walkthrough chapters", () => {
  const setup = browser(() => {
    throw new Error("unexpected fetch");
  });
  setup.AX.views = [{ id: "layers" }];
  vm.runInContext(readFileSync(root + "js/home.js", "utf8"), setup.context);
  const video = {
    play() {
      this.played = true;
    },
  };
  const chapter = {
    dataset: { at: "334" },
    addEventListener(type, fn) {
      this[type] = fn;
    },
  };
  const page = {
    innerHTML: "",
    querySelector: (selector) => (selector === "video" ? video : null),
    querySelectorAll: () => [chapter],
  };
  setup.AX.render.home(page);
  assert.match(page.innerHTML, new RegExp("The " + model.layers.length + " questions"));
  assert.match(page.innerHTML, /poster="media\/answerable-walkthrough-poster\.jpg"/);
  assert.match(page.innerHTML, /src="media\/answerable-walkthrough\.vtt"/);
  assert.match(
    page.innerHTML,
    /A walkthrough of the design and this site, recorded against the current runs\. The voice is a synthetic stand-in\./,
  );
  const chapters = Array.from(
    page.innerHTML.matchAll(/data-at="(\d+)"><span class="t">([^<]+)<\/span>([^<]+)<\/button>/g),
    (match) => match.slice(1),
  );
  assert.deepEqual(chapters, [
    ["0", "0:00", "Agents that act for us"],
    ["12", "0:12", "The goals"],
    ["36", "0:36", "Two gates around a black box"],
    ["61", "1:01", "The message and its layers"],
    ["88", "1:28", "The explorer"],
    ["117", "1:57", "Who is on the other end"],
    ["132", "2:12", "A bank asks for more"],
    ["158", "2:38", "Asking Sam"],
    ["186", "3:06", "RDF at every gate"],
    ["201", "3:21", "Payment is a contract"],
    ["243", "4:03", "Swap a layer"],
    ["256", "4:16", "When things go wrong"],
    ["278", "4:38", "Seventy use cases"],
    ["305", "5:05", "Requirements and specifications"],
    ["322", "5:22", "Starting from email"],
    ["334", "5:34", "Try it"],
  ]);
  chapter.click();
  assert.equal(video.currentTime, 334);
  assert.equal(video.played, true);
});

test("Explore uses one step count, shows recorded branch decisions and keeps the raw trace", async (t) => {
  const dir = bundleFixture(t);
  const keys = [
    "mortgage-main--baseline",
    "mortgage-core--baseline",
    "mortgage-over-ask--baseline",
    "mortgage-injected-fee--baseline",
    "mortgage-main--fee-payee-differs--baseline",
  ];
  for (const key of keys) {
    const source = join(root, "traces", key + ".json");
    copyFileSync(source, join(dir, "traces", key + ".json"));
    const { linkedTable } = JSON.parse(readFileSync(source, "utf8"));
    if (linkedTable) {
      mkdirSync(join(dir, "traces/linked"), { recursive: true });
      copyFileSync(join(root, "traces", linkedTable), join(dir, "traces", linkedTable));
    }
  }
  await promisify(execFile)(process.execPath, [join(dir, "scripts/bundle-data.mjs")]);
  const bundle = { window: {} };
  vm.runInNewContext(readFileSync(join(dir, "data/bundle.js"), "utf8"), bundle);
  const digest = "sha-256:" + "a".repeat(64);
  const setup = browser(
    async (url) => ({
      ok: true,
      json: async () => {
        const doc = traceData.restore(JSON.parse(readFileSync(join(dir, url), "utf8")));
        if (doc.scenario?.id === "mortgage-main") {
          doc.events
            .find((e) => e.seq === 81)
            .packet.attachments.push({ bytes: null, bytesOmitted: true, digest, byteLength: 4096 });
        }
        return doc;
      },
    }),
    bundle.window.AGENT_EXPLORER_DATA,
  );
  for (const name of ["diagram", "phone"])
    vm.runInContext(readFileSync(root + "js/" + name + ".js", "utf8"), setup.context);
  const { E, container, node } = exploreDOM(setup);
  node(".stage").clientWidth = 738;
  await E.mount(container, { scenario: "mortgage-main", step: 29, level: "steps" });
  assert.match(node("#pos").innerHTML, /^<strong>Step 28 of 36<\/strong>/);
  assert.match(node("#inspector").innerHTML, /Step 28 of 36/);
  const scrub = node("#scrub").innerHTML;
  const labels = Array.from(scrub.matchAll(/class="scrub-label"[^>]+>(\d+)<\/button>/g), (match) =>
    Number(match[1]),
  );
  assert.deepEqual(
    labels,
    Array.from({ length: 36 }, (_, i) => i + 1),
  );
  assert.match(setup.AX.lastExploreHash, /step=29/);
  assert.match(scrub, /Sam is asked, and the agent shares the evidence/);

  await E.apply({ scenario: "mortgage-main", seq: 81, level: "checks" });
  const stage = node("#stage-figure").innerHTML;
  assert.match(stage, /viewBox="-28 -4 1112 522"/);
  assert.match(stage, /North Bank’s agent/);
  assert.match(stage, /North Bank \(fictional\)/);
  assert.doesNotMatch(stage, /scale\(/);
  assert.match(node("#parties").innerHTML, /Harbour Bank’s agent/);
  assert.match(node("#caption").textContent, /North Bank’s agent sends/);
  assert.match(stage, /y="472"[^>]*class="msg-label-bg"/);
  assert.match(stage, /id="ax-packet".*?<rect x="-11" y="-8"/s);

  const inspector = node("#inspector");
  assert.match(
    inspector.innerHTML,
    /<pre class="json rdf-doc"[^>]*><code><span class="tok-punctuation">\{<\/span>\n {2}<span class="tok-key">&quot;id&quot;<\/span>/,
  );
  assert.doesNotMatch(inspector.innerHTML, /&quot;@context&quot;/);
  assert.ok(inspector.innerHTML.includes("<code>" + digest + "</code>"));
  inspector.click({
    target: {
      closest: (selector) =>
        selector === ".rdf-view"
          ? { id: "rdf-inspector-0" }
          : selector === "[data-rdf-context]"
            ? {}
            : null,
    },
  });
  assert.match(
    inspector.innerHTML,
    /<pre class="json rdf-doc"[^>]*><code><span class="tok-punctuation">\{<\/span>\n {2}<span class="tok-keyword">&quot;@context&quot;<\/span>/,
  );
  const event = E.state.trace.events.find((e) => e.seq === 81);
  const stripTokens = (html) => html.replace(/<span class="tok-[a-z-]+">([^<>]*)<\/span>/g, "$1");
  const linkedPanes = Array.from(
    inspector.innerHTML.matchAll(/<pre class="json rdf-doc"[^>]*><code>([\s\S]*?)<\/code><\/pre>/g),
    (match) => match[1],
  );
  assert.equal(linkedPanes.length, 2);
  assert.equal(
    stripTokens(linkedPanes[0]),
    setup.AX.esc(JSON.stringify(JSON.parse(event.packet.jsonld), null, 2)),
  );
  assert.match(linkedPanes[1], /<span class="tok-iri">/);
  assert.equal(stripTokens(linkedPanes[1]), setup.AX.esc(event.packet.rdf));

  await E.apply({ scenario: "mortgage-main", seq: 81, level: "raw" });
  assert.equal(node("#raw").hidden, false);
  assert.match(node("#raw").innerHTML, /<span class="tok-key">/);
  assert.equal(stripTokens(node("#raw").innerHTML), setup.AX.esc(JSON.stringify(event, null, 2)));

  node(".stage").clientWidth = 360;
  E.rerender();
  assert.match(node("#stage-figure").innerHTML, /viewBox="-28 -4 556 958"/);
  assert.doesNotMatch(node("#stage-figure").innerHTML, /scale\(/);
  for (const [scenario, step, title] of [
    [
      "mortgage-over-ask",
      11,
      "The gate stops the evidence from being shared because Sam’s mandate does not allow it.",
    ],
    [
      "mortgage-injected-fee",
      13,
      "The gate stops the injected fee because Sam’s mandate does not allow it.",
    ],
    [
      "mortgage-main--fee-payee-differs",
      29,
      "Stop. The payment recipient must be the party named by the agreement&#39;s compensation duty.",
    ],
  ]) {
    await E.apply({ scenario, step, level: "steps" });
    assert.ok(node("#inspector").innerHTML.includes("<h2>" + title + "</h2>"));
    assert.ok(node("#scrub").innerHTML.includes(title));
    assert.ok(node("#phone-host").innerHTML.includes(title.replace(/\.$/, "")));
  }
  E.unmount();
});

test("the hosted artifact keeps the UTF-8 meta and includes the Paper link targets", async (t) => {
  const dir = bundleFixture(t);
  mkdirSync(join(dir, "paper"));
  const paperAssets = ["figure-1.svg", "index.html"];
  for (const name of [
    "index.html",
    "styles.css",
    "scripts/build-artifact.mjs",
    "paper/paper.md",
    ...paperAssets.map((file) => `paper/${file}`),
  ]) {
    copyFileSync(join(root, name), join(dir, name));
  }
  writeFileSync(join(dir, "data/bundle.js"), "");
  mkdirSync(join(dir, "data/traces"));
  const out = join(dir, "artifact");
  await promisify(execFile)(process.execPath, [join(dir, "scripts/build-artifact.mjs"), out]);
  for (const file of [join(dir, "index.html"), join(out, "index.html")]) {
    const head = readFileSync(file, "utf8").slice(0, 200);
    assert.match(head, /<meta charset="utf-8">\s*<title>Answerable Agent Explorer<\/title>/);
  }
  assert.deepEqual(readdirSync(join(out, "paper")).sort(), paperAssets);
  for (const file of paperAssets) {
    assert.deepEqual(
      readFileSync(join(out, "paper", file)),
      readFileSync(join(dir, "paper", file)),
    );
  }
});
