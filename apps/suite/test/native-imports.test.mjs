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

// AUTHORED-BY Claude Opus 5.5
it.each([
  'import { useSelectedLayoutSegment } from "next/navigation"; useSelectedLayoutSegment();',
  'import { useSelectedLayoutSegments } from "next/navigation"; useSelectedLayoutSegments();',
])("Biome rejects placeholder-tree segment hook %s", async (source) => {
  const result = await lint(source);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("noRestrictedImports");
});

async function scan(source) {
  const root = await mkdtemp(join(tmpdir(), "suite-imports-"));
  try {
    await writeFile(join(root, "page.tsx"), source);
    return await checkServerFeatures(root).then(
      () => null,
      (error) => error.message,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it.each([
  ['import { useParams } from "next/navigation.js"; useParams();', "aliased next/navigation"],
  [
    'import { useParams } from "next/dist/client/components/navigation"; useParams();',
    "aliased next/navigation",
  ],
  ['const n = await import("next/navigation.js"); n.useParams();', "useRouteParams"],
  ["const x = 'navigation'; const n = await import(`next/${x}`);", "computed next/"],
  ['const n = await import("next/" + "navigation");', "computed next/"],
  ['const n = require(("next/") + "headers");', "computed next/"],
  ['import { cookies } from "next/headers.js"; cookies();', "server-only"],
  ['import { headers } from "next/dist/server/request/headers";', "server-only"],
])("the native scanner rejects module-spelling bypass %s", async (source, message) => {
  expect(await scan(source)).toContain(message);
});

it("the native scanner allows unrelated computed imports and plain navigation hooks", async () => {
  expect(
    await scan(
      'import { useRouter } from "next/navigation"; const l = "en"; await import(`./locales/${l}.json`);',
    ),
  ).toBeNull();
});
