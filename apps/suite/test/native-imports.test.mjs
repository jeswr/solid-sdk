// AUTHORED-BY Codex GPT-6.1-Sol
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { checkServerFeatures } from "../scripts/route-manifest.mjs";

function lintPath(path, root) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("../node_modules/@biomejs/biome/bin/biome", import.meta.url)),
        "lint",
        "--only=style/noRestrictedImports",
        path,
      ],
      { cwd: root },
    );
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.stdout.resume();
    child.once("error", reject);
    child.once("exit", (status) => resolve({ status, stderr }));
  });
}

async function lint(source, relative = "src/import-probe.ts") {
  // Biome's stdin path does not apply this override. Exercise actual files under apps/suite.
  // Copy the real configuration into an isolated tree so concurrent lint cannot see the fixtures.
  const root = await mkdtemp(join(tmpdir(), "suite-lint-"));
  try {
    const config = JSON.parse(
      await readFile(new URL("../../../biome.json", import.meta.url), "utf8"),
    );
    await writeFile(
      join(root, "biome.json"),
      JSON.stringify({ ...config, vcs: { enabled: false } }),
    );
    const path = join(root, "apps/suite", relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `// AUTHORED-BY Codex GPT-6.1-Sol\n${source}`);
    return await lintPath(path, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it.each([
  'import { useParams } from "next/navigation"; useParams();',
  'import { useParams as readParams } from "next/navigation"; readParams();',
  'import * as navigation from "next/navigation"; navigation.useParams();',
])("Biome rejects the native routing bypass %s", async (source) => {
  const result = await lint(source);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("noRestrictedImports");
  expect(result.stderr).toContain("useRouteParams");
});

it("allows other named navigation hooks and the shared route-params implementation", async () => {
  expect((await lint('import { useRouter } from "next/navigation"; useRouter();')).status).toBe(0);
  expect(
    (
      await lint(
        'import { useParams } from "next/navigation"; useParams();',
        "src/lib/route-params.ts",
      )
    ).status,
  ).toBe(0);
});

it.each([
  'const { useParams } = await import("next/navigation"); useParams();',
  "const { useParams: readParams } = await import(`next/navigation`); readParams();",
  'const navigation = await import("next/navigation"); navigation.useParams();',
  "const navigation = require(`next/navigation`); navigation.useParams();",
])("the native scanner rejects dynamic routing bypass %s", async (source) => {
  const root = await mkdtemp(join(tmpdir(), "suite-imports-"));
  try {
    await writeFile(join(root, "page.tsx"), source);
    await expect(checkServerFeatures(root)).rejects.toThrow("useRouteParams");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
