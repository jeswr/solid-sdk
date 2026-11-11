// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { zipSync } from "fflate";
import { packageRoot, validatePackaging } from "./validate-packaging.mjs";

/** Stage a self-contained CLI, without copying credentials, caches or node_modules. */
export async function stageMcpb(stage) {
  const result = await build({
    absWorkingDir: packageRoot,
    entryPoints: ["dist/cli.js"],
    outfile: join(stage, "dist/cli.js"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    sourcemap: false,
    metafile: true,
    legalComments: "inline",
    logLevel: "silent",
    // Bundled CommonJS dependencies still require Node builtins at runtime.
    banner: {
      js: 'import { createRequire as __mcpbCreateRequire } from "node:module";\nconst require = __mcpbCreateRequire(import.meta.url);\n// AUTHORED-BY Codex GPT-6.1-Sol',
    },
  });
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  for (const output of Object.values(result.metafile.outputs)) {
    for (const dependency of output.imports) {
      assert(
        !dependency.external || builtins.has(dependency.path),
        `Unbundled MCPB dependency: ${dependency.path}`,
      );
    }
  }
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  writeFileSync(
    join(stage, "package.json"),
    `${JSON.stringify(
      {
        // biome-ignore lint/style/useNamingConvention: JSON Schema provenance keyword.
        $comment: "AUTHORED-BY Codex GPT-6.1-Sol",
        name: pkg.name,
        version: pkg.version,
        private: true,
        type: "module",
        engines: pkg.engines,
      },
      null,
      2,
    )}\n`,
  );
  for (const [source, target] of [
    ["packaging/mcpb/manifest.json", "manifest.json"],
    ["LICENSE", "LICENSE"],
    ["README.md", "README.md"],
  ]) {
    writeFileSync(join(stage, target), readFileSync(join(packageRoot, source)));
  }
}

/** Sorted regular files, fixed DOS timestamps and permissions, no host paths or symlinks. */
export function zipStage(stage) {
  const entries = {};
  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), `${name}/`);
      else {
        assert(entry.isFile(), "MCPB staging accepts only regular files");
        entries[name] = [
          readFileSync(join(directory, entry.name)),
          {
            // fflate encodes local calendar fields, so construct local midnight in every TZ.
            mtime: new Date(1980, 0, 1),
            os: 3,
            attrs: (0o100644 << 16) >>> 0,
            level: 9,
          },
        ];
      }
    }
  }
  visit(stage);
  return zipSync(entries);
}

/** Rebuild and validate before producing a local, unsigned archive. Never uploads. */
export async function buildMcpb() {
  execFileSync("pnpm", ["run", "build"], { cwd: packageRoot, stdio: "inherit" });
  await validatePackaging();
  const stage = mkdtempSync(join(tmpdir(), "solid-mcp-mcpb-"));
  try {
    await stageMcpb(stage);
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    assert(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?$/.test(pkg.version), "Unsafe archive version");
    const out = join(packageRoot, "packaging/out");
    mkdirSync(out, { recursive: true });
    const path = join(out, `solid-mcp-${pkg.version}.mcpb`);
    writeFileSync(path, zipStage(stage));
    return path;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Prepared local MCPB: ${await buildMcpb()}`);
  } catch (error) {
    console.error(`MCPB preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
