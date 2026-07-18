// AUTHORED-BY Claude Fable 5
/**
 * Domain-generic grep gate (mirrors @jeswr/solid-showcase's): this scaffolder is a
 * GENERIC framework entry point — no use case, organisation, or domain term may
 * appear anywhere in the package, template included. Domain content enters ONLY
 * through the caller's flags/prompts.
 *
 * Banned terms are assembled from fragments so the gate can scan every file —
 * including itself — without matching its own source.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".next", ".cache"]);
const TEXT_EXTENSIONS = /\.(?:ts|tsx|mts|mjs|js|jsx|json|md|txt|yml|yaml|css|ttl)$/u;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, files);
    } else if (TEXT_EXTENSIONS.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

// Assembled at runtime; no fragment pair sits adjacent in this file's own source.
const bannedFragments: [string, string][] = [
  ["mort", "gage"],
  ["\\bED", "MA\\b"],
  ["len", "der"],
  ["ba", "nk"],
  ["fin", "ance"],
  ["cre", "dit"],
  ["lo", "an"],
  ["fre", "ddie"],
  ["equi", "fax"],
  ["veri", "zon"],
  ["under", "writ"],
  ["decision-", "00"],
  ["borrow", "er"],
];
const banned = new RegExp(bannedFragments.map(([a, b]) => `${a}${b}`).join("|"), "iu");

test("no use-case/domain term appears anywhere in the package (template included)", () => {
  const files = walk(packageRoot);
  expect(files.length).toBeGreaterThan(30);
  const hits: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const match = banned.exec(line);
      if (match !== null) {
        hits.push(`${relative(packageRoot, file)}:${index + 1} → "${match[0]}" in: ${line.trim()}`);
      }
    });
  }
  expect(hits, `domain terms leaked into the generic scaffolder:\n${hits.join("\n")}`).toEqual([]);
});
