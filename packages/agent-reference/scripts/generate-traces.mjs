#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Claude Opus 5.5
// Writes every reference trace to traces/<scenario>--<configuration>.json (run after build).
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { execFile } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { dirname, join, resolve } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { promisify } from "util";
import { generateTraces } from "../dist/reference/generate.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let commit = "unknown";
try {
  commit = (await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
} catch {}
const outDir = join(root, "traces");
mkdirSync(outDir, { recursive: true });
const traces = await generateTraces(commit, true);
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
