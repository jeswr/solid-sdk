#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
// Rewrites the committed expected outlines from a fresh run (after build). Review the diff:
// an outline change is a change in what the agent does.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { generateTraces } = await import(join(root, "dist/reference/generate.js"));
const { outlineOf } = await import(join(root, "dist/trace/types.js"));
const outDir = join(root, "outlines");
mkdirSync(outDir, { recursive: true });
for (const [file, trace] of await generateTraces()) {
  writeFileSync(join(outDir, `${file}.json`), `${JSON.stringify(outlineOf(trace), null, 2)}\n`);
}
console.log(`outlines written to ${outDir}`);
