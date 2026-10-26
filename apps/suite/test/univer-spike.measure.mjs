// AUTHORED-BY Codex GPT-6.1-Sol
// Run from repo root: pnpm --filter @jeswr/app-suite measure:univer
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entryPoint = join(appDir, "src/apps/sheets/lib/univer-spike/index.ts");
const packages = new Map();

async function packageRoot(name, from) {
  const require = createRequire(join(from, "package.json"));
  let entry;
  try {
    entry = require.resolve(`${name}/package.json`);
  } catch {
    entry = require.resolve(name);
  }
  let root = dirname(await realpath(entry));
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      if (manifest.name === name) return { root, manifest };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(root);
    if (parent === root) throw new Error(`No package root for ${name}`);
    root = parent;
  }
}

async function unpackedBytes(root) {
  let bytes = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    bytes += entry.isDirectory() ? await unpackedBytes(path) : (await stat(path)).size;
  }
  return bytes;
}

async function visit(name, from) {
  const { root, manifest } = await packageRoot(name, from);
  if (packages.has(root)) return;
  packages.set(root, {
    name,
    version: manifest.version,
    license: manifest.license,
    bytes: await unpackedBytes(root),
  });
  // Include required peers (such as rxjs/React), omit optional peers/tooling.
  const peers = Object.keys(manifest.peerDependencies ?? {}).filter(
    (peer) => !manifest.peerDependenciesMeta?.[peer]?.optional,
  );
  for (const dep of new Set([...Object.keys(manifest.dependencies ?? {}), ...peers])) {
    await visit(dep, root);
  }
}

for (const name of ["@univerjs/core", "@univerjs/sheets", "rxjs"]) await visit(name, appDir);
const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  minify: true,
  treeShaking: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  write: false,
  metafile: true,
  legalComments: "none",
});
const output = result.outputFiles[0].contents;
console.log(
  JSON.stringify(
    {
      node: process.version,
      bundle: {
        entry: "src/apps/sheets/lib/univer-spike/index.ts",
        rawBytes: output.byteLength,
        gzipBytes: gzipSync(output, { level: 9 }).byteLength,
        inputs: Object.keys(result.metafile.inputs).length,
        externalImports: Object.values(result.metafile.outputs).flatMap((o) => o.imports),
      },
      install: {
        definition:
          "sum of regular file bytes in the runtime dependency and required peer closure; no node_modules, symlinks or dev dependencies",
        packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)),
        totalBytes: [...packages.values()].reduce((sum, pkg) => sum + pkg.bytes, 0),
      },
    },
    null,
    2,
  ),
);
