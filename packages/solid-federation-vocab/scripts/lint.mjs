// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Lightweight repo lint: every .ttl / .mjs source carries the AUTHORED-BY
// provenance marker, the JSON-LD contexts are valid JSON, and the required
// vocabulary files exist. Fast, dependency-free — the first gate to run.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "AUTHORED-BY Claude Opus 4.8";

let failures = 0;
const fail = (m) => {
  console.error(`  ✗ ${m}`);
  failures += 1;
};
const ok = (m) => console.log(`  ✓ ${m}`);

const REQUIRED = [
  "fedapp.ttl",
  "fedreg.ttl",
  "task.ttl",
  "context.jsonld",
  "fedreg-context.jsonld",
  "task-context.jsonld",
  "suite.json",
  ".npmrc",
  ".roborev.toml",
];
console.log("Required files:");
for (const f of REQUIRED) {
  if (existsSync(join(ROOT, f))) ok(f);
  else fail(`missing ${f}`);
}

console.log("\nAUTHORED-BY markers:");
const marked = [
  ...readdirSync(ROOT).filter((f) => f.endsWith(".ttl")),
  ...readdirSync(join(ROOT, "scripts")).filter((f) => f.endsWith(".mjs")).map((f) => `scripts/${f}`),
];
for (const rel of marked) {
  const txt = readFileSync(join(ROOT, rel), "utf8");
  if (txt.includes(MARKER)) ok(`${rel} marked`);
  else fail(`${rel} missing AUTHORED-BY marker`);
}

console.log("\nJSON-LD contexts are valid JSON:");
for (const f of readdirSync(ROOT).filter((x) => x.endsWith(".jsonld"))) {
  try {
    JSON.parse(readFileSync(join(ROOT, f), "utf8"));
    ok(f);
  } catch (err) {
    fail(`${f}: ${err.message}`);
  }
}

console.log("");
if (failures > 0) {
  console.error(`LINT FAILED — ${failures} problem(s).`);
  process.exit(1);
}
console.log("LINT PASSED.");
