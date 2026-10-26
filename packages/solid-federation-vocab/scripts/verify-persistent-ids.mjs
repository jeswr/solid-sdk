// AUTHORED-BY Codex GPT-6.1-Sol
// Read-only VOC-02 registry verification. Pass an unmodified local copy of
// jeswr/portfolio config/persistent-ids.ts, or fetch the default-branch copy.
// Emits TSV suitable for a review attachment; exits nonzero on any failed URL.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryUrl =
  "https://raw.githubusercontent.com/jeswr/portfolio/main/config/persistent-ids.ts";
const source = process.argv[2]
  ? readFileSync(process.argv[2], "utf8")
  : await (async () => {
      const response = await fetch(registryUrl, { signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, "portfolio registry must answer 200");
      return response.text();
    })();
const registry = await import(
  `data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`
);
const entries = registry.PERSISTENT_IDS.filter(
  (entry) =>
    entry.tree === "ns" &&
    (["fed", "fedreg", "task", "core"].includes(entry.slug) || entry.slug.startsWith("sectors/")),
);
assert.equal(entries.length, 17, "expected all 17 registered federation namespaces");
const jobs = [];
for (const entry of entries) {
  const legacy = new URL(entry.w3id);
  assert.equal(legacy.origin, "https://w3id.org", `${entry.slug}: retain legacy predecessor`);
  assert.equal(legacy.pathname, `/jeswr/${entry.slug}`, `${entry.slug}: retain legacy path`);
  for (const rep of ["turtle", "html", "jsonld"]) {
    const url = entry[rep];
    assert.equal(typeof url, "string", `${entry.slug}: missing ${rep}`);
    const path = new URL(url).pathname;
    const file =
      rep === "html" ? path.replace(/^\/solid-federation-vocab\//, "") : path.split("/docs/")[1];
    assert.ok(file && existsSync(join(ROOT, "docs", file)), `${entry.slug}: missing docs/${file}`);
    jobs.push({ slug: entry.slug, rep, url });
  }
}
console.log("# AUTHORED-BY Codex GPT-6.1-Sol");
console.log(`# Checked ${new Date().toISOString()}; registry ${registryUrl}`);
console.log(
  "# All 17 legacy predecessor fields retained; all 51 target files exist in local docs/.",
);
console.log("slug\trepresentation\tstatus\turl\tfinal-url");
let failures = 0;
// Batches bound concurrent HTTP traffic without requiring another dependency.
for (let index = 0; index < jobs.length; index += 4) {
  const rows = await Promise.all(
    jobs.slice(index, index + 4).map(async ({ slug, rep, url }) => {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          redirect: "follow",
        });
        await response.arrayBuffer();
        if (response.status !== 200) failures += 1;
        return [slug, rep, response.status, url, response.url].join("\t");
      } catch (error) {
        failures += 1;
        return [slug, rep, "ERROR", url, String(error).replace(/[\t\n]/g, " ")].join("\t");
      }
    }),
  );
  for (const row of rows) console.log(row);
}
console.log(`# ${jobs.length - failures}/${jobs.length} representation URLs answered 200.`);
if (failures) process.exitCode = 1;
