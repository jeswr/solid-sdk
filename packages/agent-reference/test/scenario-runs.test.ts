// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { spawn } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { once } from "events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  // biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
} from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it, onTestFinished, vi } from "vitest";
// @ts-expect-error Standalone Node scripts are deliberately JavaScript.
import { publishScenarioRuns } from "../scripts/publish-scenario-runs.mjs";
// @ts-expect-error Standalone Node scripts are deliberately JavaScript.
import { ScenarioTraceWriter } from "../scripts/write-scenario-traces.mjs";
import { digestBytes } from "../src/core/canonical.js";
import { TRACE_SCHEMA } from "../src/trace/types.js";
import { STORE_CONTEXT } from "../src/wire/store-contexts.js";

const scenario = "test";
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scenario-runs-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const traces = join(root, "traces");
  const manifest = join(root, "scenario-runs.json");
  const index = join(traces, "index.json");
  mkdirSync(traces);
  writeFileSync(manifest, '{"paths":[]}');
  writeFileSync(index, "[]");
  return { root, traces, manifest, index };
}

it("merges rows and index entries from overlapping writers for different configurations", async () => {
  const { root, manifest, index } = fixture();
  const module = new URL("../scripts/publish-scenario-runs.mjs", import.meta.url).href;
  const script = `
    import { writeFileSync } from "fs";
    const { publishScenarioRuns, readScenarioRuns } = await import(process.argv[1]);
    const [, , root, scenario, configuration, ready] = process.argv;
    const trace = scenario + "--" + configuration + ".json";
    const path = { scenario, configuration, path: "main", status: "runs", settlement: "rdf-order", trace };
    writeFileSync(ready, JSON.stringify(readScenarioRuns(root)));
    publishScenarioRuns(root, { paths: [path] }, [{ file: trace }], { scenario, configuration });
  `;
  const lock = `${manifest}.lock`;
  writeFileSync(lock, "previous writer", { flag: "wx" });
  const writers = ["one", "two"].map((configuration) => {
    const ready = join(root, `${configuration}.ready`);
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script, module, root, scenario, configuration, ready],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    return { ready, done: once(child, "close") };
  });
  try {
    await vi.waitFor(
      () => {
        for (const { ready } of writers) expect(read(ready)).toEqual([]);
      },
      { timeout: 5_000 },
    );
    expect(read(manifest).paths).toEqual([]);
  } finally {
    rmSync(lock);
    const results = await Promise.all(writers.map(({ done }) => done));
    expect(results).toEqual([
      [0, null],
      [0, null],
    ]);
  }
  expect(
    read(manifest)
      .paths.map((row: { configuration: string }) => row.configuration)
      .sort(),
  ).toEqual(["one", "two"]);
  expect(
    read(index)
      .map((entry: { file: string }) => entry.file)
      .sort(),
  ).toEqual(["test--one.json", "test--two.json"]);
  expect(existsSync(lock)).toBe(false);
});

it("serializes a blocked publication behind a runnable writer in the same group", async () => {
  const { root, traces, manifest, index } = fixture();
  const module = new URL("../scripts/publish-scenario-runs.mjs", import.meta.url).href;
  const trace = "test--baseline.json";
  const reference = "linked/test--baseline.json";
  const group = { scenario, configuration: "baseline" };
  const main = { ...group, path: "main", status: "runs", trace };
  const blocked = { ...group, path: "main", status: "blocked" };
  const key = digestBytes('{"@id":"urn:test"}');
  using writer = new ScenarioTraceWriter(traces, scenario, group.configuration);
  writer.write(trace, {
    schema: TRACE_SCHEMA,
    events: [{ linked: [key] }],
    linked: {
      [key]: {
        what: "record-entry",
        context: STORE_CONTEXT,
        jsonld: '{"@id":"urn:test"}',
        turtle: "<urn:test> a <urn:test:Type> .",
      },
    },
  });
  writer.stageViews();
  // Seed a prior runnable row so the blocked writer would remove the trace if it
  // could merge while the replacement trace is visible and its row is pending.
  const previous = { ...main, actual: "previous" };
  const previousIndex = [{ file: trace, events: 0 }];
  writeFileSync(manifest, JSON.stringify({ paths: [previous] }));
  writeFileSync(index, JSON.stringify(previousIndex));
  writeFileSync(join(traces, trace), '{"events":[]}');
  const script = `
    import fs from "fs";
    import { syncBuiltinESMExports } from "module";
    const [, , root, blocked, manifest, ready] = process.argv;
    const open = fs.openSync;
    fs.openSync = (path, ...args) => {
      try {
        return open(path, ...args);
      } catch (error) {
        if (path === manifest + ".lock" && error.code === "EEXIST") fs.writeFileSync(ready, "");
        throw error;
      }
    };
    syncBuiltinESMExports();
    const { publishScenarioRuns } = await import(process.argv[1]);
    const row = JSON.parse(blocked);
    publishScenarioRuns(root, { paths: [row] }, [], row);
  `;
  const ready = join(root, "blocked.ready");
  let done: ReturnType<typeof once> | undefined;
  try {
    const publish = writer.publish.bind(writer);
    writer.publish = () => {
      publish();
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          script,
          module,
          root,
          JSON.stringify(blocked),
          manifest,
          ready,
        ],
        { stdio: ["ignore", "inherit", "inherit"] },
      );
      done = once(child, "close");
      // Wait until the blocked writer has tried to acquire the lock while this
      // writer is between trace and manifest publication.
      const waiter = new Int32Array(new SharedArrayBuffer(4));
      const deadline = performance.now() + 5_000;
      while (!existsSync(ready) && performance.now() < deadline) Atomics.wait(waiter, 0, 0, 10);
      expect(existsSync(ready)).toBe(true);
      expect(read(manifest).paths).toEqual([previous]);
      expect(read(index)).toEqual(previousIndex);
      expect(read(join(traces, trace)).events).toEqual([{ linked: [key] }]);
      expect(existsSync(join(traces, reference))).toBe(true);
    };
    publishScenarioRuns(root, { paths: [main] }, [{ file: trace, events: 1 }], {
      ...group,
      writers: [writer],
    });
  } finally {
    if (done) expect(await done).toEqual([0, null]);
  }
  expect(read(manifest).paths).toEqual([blocked]);
  expect(read(index)).toEqual([]);
  expect(existsSync(join(traces, trace))).toBe(false);
  expect(existsSync(join(traces, reference))).toBe(false);
});

it("removes traces and unused table keys when formerly runnable paths become blocked", () => {
  const { root, traces, manifest, index } = fixture();
  const reference = join(traces, "linked", "test--baseline.json");
  const base = { scenario, settlement: "rdf-order" };
  const main = { ...base, path: "main", status: "runs", trace: "test--baseline.json" };
  const branch = { ...base, path: "branch", status: "runs", trace: "test--branch--baseline.json" };
  const indexEntry = { file: main.trace };
  const keyFor = (name: string) => digestBytes(JSON.stringify({ "@id": `urn:test:${name}` }));
  {
    using writer = new ScenarioTraceWriter(traces, scenario, "baseline");
    for (const row of [main, branch]) {
      const id = `urn:test:${row.path}`;
      const key = keyFor(row.path);
      writer.write(row.trace, {
        schema: TRACE_SCHEMA,
        events: [{ linked: [key] }],
        linked: {
          [key]: {
            what: "record-entry",
            context: STORE_CONTEXT,
            jsonld: JSON.stringify({ "@id": id }),
            turtle: `<${id}> a <urn:test:Type> .`,
          },
        },
      });
    }
    publishScenarioRuns(root, { paths: [main, branch] }, [indexEntry, { file: branch.trace }], {
      scenario,
      configuration: "baseline",
      writers: [writer],
    });
  }
  expect(Object.keys(read(reference)).sort()).toEqual([keyFor("main"), keyFor("branch")].sort());
  const mainBytes = readFileSync(join(traces, main.trace));
  const blocked = (path: string) => ({ ...base, path, status: "blocked", reason: "Unavailable" });
  const blockedBranch = blocked("branch");
  publishScenarioRuns(root, { paths: [main, blockedBranch] }, [indexEntry], {
    scenario,
    configuration: "baseline",
  });
  expect(read(manifest).paths).toEqual([main, blockedBranch]);
  expect(read(index)).toEqual([indexEntry]);
  expect(existsSync(join(traces, branch.trace))).toBe(false);
  expect(readFileSync(join(traces, main.trace))).toEqual(mainBytes);
  expect(Object.keys(read(reference))).toEqual([keyFor("main")]);

  const blockedMain = blocked("main");
  publishScenarioRuns(root, { paths: [blockedMain, blockedBranch] }, [], {
    scenario,
    configuration: "baseline",
  });
  expect(read(manifest).paths).toEqual([blockedMain, blockedBranch]);
  expect(read(index)).toEqual([]);
  expect(existsSync(join(traces, main.trace))).toBe(false);
  expect(existsSync(reference)).toBe(false);
});
