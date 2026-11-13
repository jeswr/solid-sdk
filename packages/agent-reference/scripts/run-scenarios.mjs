#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { execFileSync } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { availableAdapters } from "../dist/derive/adapters/index.js";
import { SPARQ_AGGREGATE } from "../dist/derive/adapters/sparq-aggregate.js";
import { ProofCache } from "../dist/derive/cache.js";
import { loadCase } from "../dist/engine/load.js";
import { assertPublishable } from "../dist/engine/publication.js";
import { runScenario } from "../dist/engine/run.js";
import { outlineOf } from "../dist/trace/types.js";
import { jointPaths, recordedJoint, traceHash } from "./recorded-joint.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const record = process.argv.includes("--record-outlines");
const selected = process.argv.find((arg) => arg.startsWith("--scenario="))?.slice(11);
const status = { "x-authored-by": "Codex GPT-6", schema: "agent-scenario-runs/0.1", paths: [] };
const previous = JSON.parse(readFileSync(join(root, "scenario-runs.json"), "utf8")).paths;
const index = [];
let retained = 0;
let executed = 0;
const registry = await availableAdapters();
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
} catch {}
mkdirSync(join(root, "traces"), { recursive: true });
mkdirSync(join(root, "outlines"), { recursive: true });
for (const file of readdirSync(join(root, "scenarios"))
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const id = file.slice(0, -5);
  if (selected && selected !== id) continue;
  const { profile, scenario } = loadCase(root, id);
  const original = JSON.parse(readFileSync(join(root, "scenarios", file), "utf8"));
  for (const path of await runScenario(profile, scenario, {
    commit,
    compare: !record,
    registry,
    proofCache: new ProofCache(join(root, "proofs")),
  })) {
    assertPublishable(path);
    if (
      path.blocked &&
      jointPaths.has(`${id}/${path.path}`) &&
      !registry.jointProtocols.has(SPARQ_AGGREGATE.method)
    ) {
      const saved = recordedJoint(root, previous, id, path.path);
      status.paths.push(saved);
      const trace = JSON.parse(readFileSync(join(root, "traces", saved.trace), "utf8"));
      index.push({
        file: saved.trace,
        scenario: trace.scenario,
        configuration: trace.configuration.id,
        events: trace.events.length,
      });
      retained++;
      continue;
    }
    const stem = path.path === "main" ? id : `${id}--${path.path}`;
    const traceBytes = path.trace
      ? `${JSON.stringify({ "x-authored-by": "Codex GPT-6", ...path.trace }, null, 2)}\n`
      : undefined;
    status.paths.push({
      scenario: id,
      useCase: scenario.useCase ?? scenario.id,
      ...(scenario.cataloguePath ? { cataloguePath: scenario.cataloguePath } : {}),
      path: path.path,
      ...(path.path !== "main"
        ? { what: scenario.branches.find((b) => b.id === path.path).what }
        : {}),
      ...(path.blocked
        ? { status: "blocked", reason: path.blocked }
        : {
            status: path.disagrees ? "disagrees" : "runs",
            actual: path.actual,
            expected: path.expected,
            consequences: path.consequences,
            ...(path.note ? { note: path.note } : {}),
            trace: `${stem}--baseline.json`,
            ...(jointPaths.has(`${id}/${path.path}`) && traceBytes
              ? { traceSha256: traceHash(traceBytes), recordedWith: SPARQ_AGGREGATE }
              : {}),
          }),
    });
    if (!path.trace) continue;
    executed++;
    const outline = outlineOf(path.trace);
    if (record) {
      if (path.path === "main") scenario.expect = outline;
      else scenario.branches.find((b) => b.id === path.path).outline = outline;
    }
    writeFileSync(join(root, "traces", `${stem}--baseline.json`), traceBytes);
    const outlinePath = join(root, "outlines", `${stem}--baseline.json`);
    let legacyArray = false;
    try {
      legacyArray = Array.isArray(JSON.parse(readFileSync(outlinePath, "utf8")));
    } catch {}
    writeFileSync(
      outlinePath,
      `${JSON.stringify(legacyArray ? outline : { "x-authored-by": "Codex GPT-6", schema: "agent-outline/0.1", entries: outline }, null, 2)}\n`,
    );
    index.push({
      file: `${stem}--baseline.json`,
      scenario: path.trace.scenario,
      configuration: path.trace.configuration.id,
      events: path.trace.events.length,
    });
  }
  if (record) {
    original.expect = scenario.expect;
    for (const branch of original.branches)
      branch.outline = scenario.branches.find((b) => b.id === branch.id).outline;
    writeFileSync(join(root, "scenarios", file), `${JSON.stringify(original, null, 2)}\n`);
  }
}
if (selected) status.paths.push(...previous.filter((p) => p.scenario !== selected));
writeFileSync(join(root, "scenario-runs.json"), `${JSON.stringify(status, null, 2)}\n`);
const indexPath = join(root, "traces", "index.json");
const existing = JSON.parse(readFileSync(indexPath, "utf8"));
const newFiles = new Set(index.map((item) => item.file));
writeFileSync(
  indexPath,
  `${JSON.stringify([...existing.filter((item) => !newFiles.has(item.file)), ...index], null, 2)}\n`,
);
console.log(
  `${executed} live data paths ran; manifest: ${status.paths.filter((p) => p.status === "runs").length} runs, ${status.paths.filter((p) => p.status === "disagrees").length} disagree, ${status.paths.filter((p) => p.status === "blocked").length} blocked`,
);

if (retained)
  console.log(
    `${retained} recorded real joint paths retained after SHA-256 verification; package absent, no live rerun.`,
  );
