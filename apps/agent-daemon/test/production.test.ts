// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6
import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, readdir, readFile, realpath, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const app = "@jeswr/app-agent-daemon";

interface Dependency {
  name: string;
  version: string;
  path: string;
  dependencies?: Record<string, Dependency>;
  optionalDependencies?: Record<string, Dependency>;
}

async function productionDependencies(cwd: string): Promise<Dependency[]> {
  const { stdout } = await execute(
    "pnpm",
    ["--filter", app, "list", "--prod", "--depth", "Infinity", "--json"],
    { cwd, maxBuffer: 16 * 1024 * 1024 },
  );
  const dependencies = new Map<string, Dependency>();
  function visit(node: Dependency) {
    if (dependencies.has(node.path)) return;
    dependencies.set(node.path, node);
    for (const [name, child] of Object.entries(node.dependencies ?? {})) visit({ ...child, name });
    for (const [name, child] of Object.entries(node.optionalDependencies ?? {}))
      visit({ ...child, name });
  }
  for (const node of JSON.parse(stdout) as Dependency[]) visit(node);
  for (const node of dependencies.values()) {
    if (node.version.startsWith("link:")) {
      node.version = JSON.parse(await readFile(join(node.path, "package.json"), "utf8")).version;
    }
  }
  return [...dependencies.values()];
}

it("packages the locked production dependency graph without build or test tools", async () => {
  const directory = await mkdtemp(join(tmpdir(), "awp-production-"));
  const output = join(directory, "out");
  try {
    const lockBefore = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
    const expected = await productionDependencies(root);
    await execute("sh", ["apps/agent-daemon/package-production.sh", output], {
      cwd: root,
      timeout: 120_000,
    });
    expect(await readFile(join(root, "pnpm-lock.yaml"), "utf8")).toBe(lockBefore);
    const actual = await productionDependencies(output);
    const versions = (nodes: Dependency[]) =>
      [...new Set(nodes.map((node) => `${node.name}@${node.version}`))].sort();
    expect(versions(actual)).toEqual(versions(expected));
    // pnpm's JSON also lists uninstalled optional binaries for other platforms.
    const installedNodes = actual.filter((node) => existsSync(node.path));
    expect(versions(installedNodes)).toEqual(
      versions(expected.filter((node) => existsSync(node.path))),
    );
    // Verify the files, including transitive dependencies, rather than trusting
    // pnpm list's lockfile metadata or symlinks back to the build workspace.
    for (const node of installedNodes) {
      expect((await realpath(node.path)).startsWith(`${resolve(output)}${sep}`)).toBe(true);
      const manifest = JSON.parse(await readFile(join(node.path, "package.json"), "utf8"));
      expect(`${manifest.name}@${manifest.version}`).toBe(`${node.name}@${node.version}`);
    }
    const installed = await readdir(join(output, "node_modules/.pnpm"));
    for (const name of ["vitest", "typescript", "@solid+community-server"]) {
      expect(installed.some((entry) => entry.startsWith(`${name}@`))).toBe(false);
    }
    // Use plain Node and the deployed entrypoint; the source Vitest tree cannot
    // supply missing dependencies to this isolated production workspace.
    await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import assert from "node:assert/strict";
      const daemon = await import("./dist/index.js");
      assert.equal(typeof daemon.runConfiguredCloud, "function");
    `,
      ],
      { cwd: output },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 150_000);
