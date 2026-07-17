// AUTHORED-BY Claude Fable 5
/**
 * Domain-generic grep gate: this package is a GENERIC framework for multistakeholder
 * pod-data walkthroughs — no use case may leak into its source, tests, docs, or shipped
 * artifacts. Domain content enters ONLY via the walkthrough document at runtime.
 *
 * The banned terms are assembled from fragments so this gate can scan every file in the
 * package — including itself — without matching its own source.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".next"]);
const TEXT_EXTENSIONS = /\.(?:ts|tsx|mts|mjs|js|jsx|json|md|txt)$/u;

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

test("no use-case/domain term appears anywhere in the package", () => {
  const files = walk(packageRoot);
  expect(files.length).toBeGreaterThan(10);
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
  expect(hits, `domain terms leaked into the generic package:\n${hits.join("\n")}`).toEqual([]);
});
