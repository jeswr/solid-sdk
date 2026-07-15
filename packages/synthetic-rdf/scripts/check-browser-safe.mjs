// AUTHORED-BY GPT-5.6 Sol via codex

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const forbidden = [
  [/(?<![A-Za-z0-9_.])Math[.]random\s*\(/u, "Math.random"],
  [/(?<![A-Za-z0-9_.])Date[.]now\s*\(/u, "Date.now"],
  [/crypto[.]getRandomValues\s*\(/u, "crypto.getRandomValues"],
  [/(?:from\s+|import\s*\()["']node:/u, "Node built-in import"],
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return extname(entry.name) === ".ts" ? [path] : [];
    }),
  );
  return nested.flat();
}

const violations = [];
for (const file of await sourceFiles(sourceRoot)) {
  const source = await readFile(file, "utf8");
  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) violations.push(`${file}: forbidden ${label}`);
  }
}

if (violations.length > 0) {
  throw new Error(`Browser-safe source check failed:\n${violations.join("\n")}`);
}
