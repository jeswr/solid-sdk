// AUTHORED-BY GPT-5.6 Sol via codex

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const entryPoint = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const nodeImport =
  /(?:from\s+|import\s*\()["'](?:node:|(?:assert|buffer|child_process|crypto|events|fs|http|https|os|path|stream|url|util|worker_threads)(?:[/'"]))/u;

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
  if (nodeImport.test(await readFile(file, "utf8"))) {
    violations.push(`${file}: forbidden Node built-in import`);
  }
}
if (violations.length > 0) {
  throw new Error(`Browser-safe source check failed:\n${violations.join("\n")}`);
}

await build({
  entryPoints: [entryPoint],
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
  logLevel: "silent",
});
