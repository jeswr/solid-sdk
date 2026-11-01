// AUTHORED-BY Codex GPT-6.1-Sol
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const inlined = new Set(manifest.mirrorPublish.inlined);
const require = createRequire(import.meta.url);

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });

// Keep the existing module paths, including the Node-only shape entry. Only the
// private vocabulary package is bundled; all published dependencies stay external.
await build({
  absWorkingDir: root,
  entryPoints: readdirSync(new URL("../src", import.meta.url))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => `src/${name}`),
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: [
    "node:*",
    ...Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).filter(
      (name) => !inlined.has(name),
    ),
  ],
  sourcemap: true,
});

// Declarations must not reference suite-vocab: mirror consumers never install it.
execFileSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"],
  {
    cwd: root,
    stdio: "inherit",
  },
);
