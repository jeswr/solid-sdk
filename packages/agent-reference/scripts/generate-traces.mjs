#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
// Writes every reference trace to traces/<scenario>--<configuration>.json (run after build).
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { execFileSync } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { dirname, join, resolve } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { generateTraces } from "../dist/reference/generate.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
