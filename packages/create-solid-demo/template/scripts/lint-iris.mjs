#!/usr/bin/env node
/**
 * lint-iris.mjs — every https:// IRI in the walkthrough document and docs must
 * dereference (house rule: no minted IRIs). HEAD-checks with a 7-day cache
 * (.cache/lint-iris.json); a 405/403 on HEAD falls back to GET.
 *
 * Scope: the walkthrough document + markdown docs. Add directories here as you
 * publish vocabularies of your own — a vocab IRI must resolve before it ships.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCANNED_FILES = ["apps/tour/content/walkthrough.json", "README.md"];
const SCANNED_DIRS = ["docs"];
/** Prefixes exempted from the check (add sparingly, with a reason). */
const ALLOWLIST = [
  "https://openapi.vercel.sh/", // vercel.json $schema — schema id, fetched by tooling
  "https://turborepo.dev/schema.json", // turbo.json $schema
  "https://biomejs.dev/schemas/", // biome.json $schema
  "https://json.schemastore.org/", // tsconfig $schema
];

const CACHE_PATH = ".cache/lint-iris.json";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const files = [...SCANNED_FILES];
for (const dir of SCANNED_DIRS) {
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith(".md")) files.push(join(dir, entry));
  }
}

const iris = new Set();
const IRI_RE = /https:\/\/[^\s"'`<>\\)\]]+/g;
for (const file of files) {
  if (!existsSync(file)) continue;
  for (const match of readFileSync(file, "utf8").matchAll(IRI_RE)) {
    const iri = match[0].replace(/[.,;:]+$/, "");
    if (!ALLOWLIST.some((prefix) => iri.startsWith(prefix))) iris.add(iri);
  }
}

let cache = {};
if (existsSync(CACHE_PATH)) {
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    cache = {};
  }
}

const now = Date.now();
const failures = [];
for (const iri of [...iris].sort()) {
  const cached = cache[iri];
  if (cached !== undefined && now - cached.checkedAt < CACHE_TTL_MS && cached.ok) continue;
  let ok = false;
  let detail = "";
  try {
    let response = await fetch(iri, { method: "HEAD", redirect: "follow" });
    if (response.status === 405 || response.status === 403) {
      response = await fetch(iri, { method: "GET", redirect: "follow" });
    }
    ok = response.status < 400;
    detail = `HTTP ${response.status}`;
  } catch (error) {
    detail = String(error);
  }
  cache[iri] = { checkedAt: now, ok };
  if (!ok) failures.push(`${iri} — ${detail}`);
}

mkdirSync(".cache", { recursive: true });
writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);

if (failures.length > 0) {
  process.stderr.write(`✗ ${failures.length} IRI(s) do not dereference:\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`✔ lint:iris — ${iris.size} IRI(s) dereference (7-day cache)\n`);
