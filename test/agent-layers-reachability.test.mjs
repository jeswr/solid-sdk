// AUTHORED-BY Codex GPT-6
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkAgentLayers } from "../scripts/check-agent-layers.mjs";

// Run with either the workspace's Vitest gate or node --test directly.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Vitest sets its own runner marker.
const { afterEach, describe, it } = process.env.VITEST
  ? await import("vitest")
  : await import("node:test");
const temporaryRoots = [];
afterEach(() => {
  for (const directory of temporaryRoots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function workspace(files = {}) {
  const directory = mkdtempSync(join(tmpdir(), "agent-reachability-"));
  temporaryRoots.push(directory);
  for (const [path, source] of Object.entries({
    "pnpm-workspace.yaml":
      'packages:\n  - "packages/*"\n  - "apps/*"\n  - "apps/*/web"\n  - "tools/*"\n  - "custom/*"\n',
    "package.json": '{"name":"@jeswr/test-workspace"}',
    "packages/ordinary/package.json": '{"name":"@jeswr/ordinary"}',
    "packages/helpers/package.json": '{"name":"@jeswr/helpers"}',
    ...files,
  })) {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return directory;
}

const forms = [
  "import TARGET;",
  "import { value } from TARGET;",
  "export * from TARGET;",
  "export { value } from TARGET;",
  "export * as helpers from TARGET;",
  "import type { Value } from TARGET;",
  "export type { Value } from TARGET;",
  "type Value = import(TARGET).Value;",
  "await import(TARGET);",
  "require(TARGET);",
  "(require as Loader)(TARGET);",
  "module.require(TARGET);",
  'module["require"](TARGET);',
  "require.resolve(TARGET);",
  "module.require.resolve(TARGET);",
  "createRequire(import.meta.url)(TARGET);",
  "import value = require(TARGET);",
  "import type Value = require(TARGET);",
];
const exemptTargets = [
  "test/helper.js",
  "tests/helper.js",
  "src/helper.test.js",
  "src/helper.spec.tsx",
  "src/helper.test.mjs",
  "src/helper.spec.cts",
  "src/__fixtures__/helper.js",
  "vitest.config.ts",
  // Directory and extensionless imports must not need an index or emitted JS file.
  "test",
  "tests",
  "__fixtures__",
  "src/helper.test",
  "src/helper.spec",
  "vitest.config",
];
const message = "non-test source must not import a test-exempt module";

describe("production reachability of test-exempt modules", () => {
  for (const form of forms)
    it(`rejects test targets for ${form}`, () => {
      const directory = workspace();
      const path = "packages/ordinary/index.ts";
      for (const target of exemptTargets) {
        const specifier = `../helpers/${target}`;
        writeFileSync(join(directory, path), form.replace("TARGET", JSON.stringify(specifier)));
        assert.deepEqual(checkAgentLayers(directory), [`${path}:1: ${message}: ${specifier}`]);
      }
    });

  for (const path of [
    "index.mjs",
    "packages/ordinary/src/index.ts",
    "apps/example/web/src/index.tsx",
    "tools/example/index.cts",
    "scripts/example.mjs",
    "guardrails/scripts/example.js",
    "custom/example/src/index.ts",
    "other/source/index.ts",
  ])
    it(`checks non-test sources at ${path}`, () => {
      const directory = workspace({ [path]: 'import "@jeswr/helpers/tests/helper.js";' });
      assert.deepEqual(checkAgentLayers(directory), [
        `${path}:1: ${message}: @jeswr/helpers/tests/helper.js`,
      ]);
    });

  for (const kind of ["relative", "absolute", "file", "file-upper", "bare"])
    it(`classifies ${kind} targets before stripping test suffixes`, () => {
      const directory = workspace();
      const path = "packages/ordinary/index.ts";
      const file = join(directory, path);
      for (const subpath of exemptTargets) {
        const target = join(directory, "packages/helpers", subpath);
        const specifier = kind.startsWith("file")
          ? pathToFileURL(target).href.replace(/^file:/, kind === "file-upper" ? "FILE:" : "file:")
          : kind === "absolute"
            ? target
            : kind === "bare"
              ? `@jeswr/helpers/${subpath}`
              : relative(dirname(file), target);
        writeFileSync(file, `export * from ${JSON.stringify(specifier)};`);
        assert.deepEqual(checkAgentLayers(directory), [`${path}:1: ${message}: ${specifier}`]);
      }
    });

  it("checks same-project bare imports and normalized paths", () => {
    const directory = workspace({
      "packages/helpers/index.ts":
        'import "@jeswr/helpers/tests/helper.js";\nimport "./src/../test/helper.js";',
    });
    assert.deepEqual(checkAgentLayers(directory), [
      `packages/helpers/index.ts:1: ${message}: @jeswr/helpers/tests/helper.js`,
      `packages/helpers/index.ts:2: ${message}: ./src/../test/helper.js`,
    ]);
  });

  it("rejects an agent-channels test bridge to executor-only send", () => {
    const directory = workspace({
      "packages/agent-channels/package.json": '{"name":"@jeswr/agent-channels"}',
      "packages/agent-channels/src/index.ts": 'export * from "./bridge.test.js";',
      "packages/agent-channels/src/bridge.test.ts": 'export * from "./gmail/send.js";',
    });
    assert.deepEqual(checkAgentLayers(directory), [
      `packages/agent-channels/src/index.ts:1: ${message}: ./bridge.test.js`,
    ]);
  });

  it("rejects a production bridge into ignored fixtures without reading them", () => {
    const directory = workspace({
      "index.ts": 'import "./packages/helpers/src/bridge.js";',
      "packages/helpers/src/bridge.ts": 'export * from "../__fixtures__/bypass.js";',
      "packages/helpers/__fixtures__/bypass.ts": 'import "openai";',
    });
    assert.deepEqual(checkAgentLayers(directory), [
      `packages/helpers/src/bridge.ts:1: ${message}: ../__fixtures__/bypass.js`,
    ]);
  });

  it("keeps test sources and test configurations exempt", () => {
    const files = Object.fromEntries(
      [
        "test/root.mjs",
        "tests/root.mjs",
        "packages/ordinary/test/helper.ts",
        "packages/ordinary/tests/helper.ts",
        "packages/ordinary/src/index.test.ts",
        "packages/ordinary/src/index.spec.tsx",
        "packages/ordinary/vitest.config.ts",
      ].map((path) => [path, 'export * from "@jeswr/helpers/__fixtures__/helper.js";']),
    );
    assert.deepEqual(checkAgentLayers(workspace(files)), []);
  });

  it("allows ordinary missing targets and paths that only resemble exemptions", () => {
    const directory = workspace({
      "packages/ordinary/index.ts": [
        "./missing.js",
        "./test-utils/helper.js",
        "./contests/helper.js",
        "./testing/helper.js",
        "./fixtures/helper.js",
        "./src/test.js",
        "./src/special.js",
        "./tests/../src/helper.js",
        "@jeswr/helpers/src/index.js",
      ]
        .map((target) => `import ${JSON.stringify(target)};`)
        .join("\n"),
      "packages/ordinary/dist/index.js": 'import "../test/helper.js";',
      "packages/ordinary/__fixtures__/index.ts": 'import "openai";',
    });
    assert.deepEqual(checkAgentLayers(directory), []);
  });

  it("reports the source location and fails the CLI", () => {
    const directory = workspace({ "index.js": '\nrequire("./tests/helper.js");' });
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/check-agent-layers.mjs", import.meta.url)), directory],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /index\.js:2: non-test source must not import a test-exempt module/,
    );
  });
});
