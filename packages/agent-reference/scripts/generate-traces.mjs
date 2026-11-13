#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
// Writes every reference trace to traces/<scenario>--<configuration>.json (run after build).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { generateTraces } = await import(join(root, "dist/reference/generate.js"));
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
} catch {}
const outDir = join(root, "traces");
mkdirSync(outDir, { recursive: true });
const traces = await generateTraces(commit);
const index = [];
for (const [file, trace] of traces) {
  writeFileSync(join(outDir, `${file}.json`), `${JSON.stringify(trace, null, 2)}\n`);
  index.push({
    file: `${file}.json`,
    scenario: trace.scenario,
    configuration: trace.configuration.id,
    events: trace.events.length,
  });
}
writeFileSync(join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${traces.size} traces to ${outDir}`);
