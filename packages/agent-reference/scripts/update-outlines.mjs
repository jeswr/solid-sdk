#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
// Rewrites the committed expected outlines from a fresh run (after build). Review the diff:
// an outline change is a change in what the agent does.
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { dirname, join, resolve } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { generateTraces } from "../dist/reference/generate.js";
import { outlineOf } from "../dist/trace/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "outlines");
mkdirSync(outDir, { recursive: true });
for (const [file, trace] of await generateTraces()) {
  writeFileSync(join(outDir, `${file}.json`), `${JSON.stringify(outlineOf(trace), null, 2)}\n`);
}
console.log(`outlines written to ${outDir}`);
