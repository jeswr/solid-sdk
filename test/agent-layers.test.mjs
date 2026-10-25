// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkAgentLayers } from "../scripts/check-agent-layers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots = [];
afterEach(() => {
  for (const directory of temporaryRoots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function workspace(files) {
  const directory = mkdtempSync(join(tmpdir(), "agent-layers-"));
  temporaryRoots.push(directory);
  for (const [path, source] of Object.entries(files)) {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return directory;
}

function scan(path, source) {
  return checkAgentLayers(workspace({ [path]: source }));
}

describe("agent layer boundaries (DESIGN §2.2)", () => {
  it.each([
    'import "openai";',
    'export * from "@anthropic-ai/sdk";',
    'await import("openai");',
    'require("openai");',
    'import "open\\u0061i";',
  ])("also enforces SDK isolation outside agent projects: %s", (source) => {
    expect(scan("apps/pod-mail/web/src/index.ts", source).join("\n")).toContain("gateway-only");
  });
  it.each([
    "(require)(TARGET);",
    "(require as Loader)(TARGET);",
    "(require satisfies Loader)(TARGET);",
    "(<Loader>require)(TARGET);",
    "require!(TARGET);",
    "module.require(TARGET);",
    "(module.require as Loader)(TARGET);",
    'module["require"](TARGET);',
    'module[("require" as const)!](TARGET);',
    "module[`require`](TARGET);",
    'module["requ\\u0069re"](TARGET);',
    "(requ\\u0069re)(TARGET);",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source fixture for prefilter coverage
    "const label = `value ${name}`; (require)(TARGET);",
  ])("checks wrapped and member loader targets outside agent projects: %s", (source) => {
    for (const [target, reason] of [
      ["openai", "gateway-only"],
      ["@anthropic-ai/sdk", "gateway-only"],
      ["@jeswr/agent-channels/gmail/send", "executor-only"],
      ["../../../../packages/agent-channels/src/gmail/send.js", "executor-only"],
    ]) {
      expect(
        scan(
          "apps/pod-mail/web/src/index.ts",
          source.replace("TARGET", JSON.stringify(target)),
        ).join("\n"),
      ).toContain(reason);
    }
    expect(scan("apps/pod-mail/web/src/index.ts", source.replace("TARGET", '"fs"'))).toEqual([]);
    // Normalizing a loader for suite-wide target checks must not permit it in agent code.
    expect(
      scan("packages/agent-model-gateway/src/index.ts", source.replace("TARGET", '"openai"')).join(
        "\n",
      ),
    ).toContain("CommonJS");
  });
  it("allows test tooling without exempting configuration files from SDK restrictions", () => {
    expect(
      scan(
        "packages/agent-channels/vitest.config.ts",
        'import { defineConfig } from "vitest/config";',
      ),
    ).toEqual([]);
    expect(
      scan("packages/agent-channels/vitest.config.ts", 'import "openai";').join("\n"),
    ).toContain("gateway-only");
  });
  it.each([
    ["daemon-send", "executor-only"],
    ["channel-openai", "gateway-only"],
    ["gateway-audit", "outside DESIGN"],
  ])("rejects the seeded %s fixture with a nonzero CLI exit", (fixture, reason) => {
    const result = spawnSync(
      process.execPath,
      [
        join(root, "scripts/check-agent-layers.mjs"),
        join(root, "scripts/__fixtures__/agent-layers", fixture),
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(reason);
  });

  it.each([
    'import "@jeswr/agent-channels/gmail/send";',
    'export * from "@jeswr/agent-channels/gmail/send";',
    'await import("@jeswr/agent-channels/gmail/send");',
    'require("@jeswr/agent-channels/gmail/send");',
    'type Send = import("@jeswr/agent-channels/gmail/send").Send;',
    'import send = require("@jeswr/agent-channels/gmail/send");',
    'import "../../../packages/agent-channels/src/gmail/send.js";',
  ])("rejects alternate send import syntax: %s", (source) => {
    expect(scan("apps/agent-daemon/src/index.ts", source).join("\n")).toContain("executor-only");
  });

  it.each([
    ["packages/agent-executor/src/index.ts", 'import "@jeswr/agent-channels/gmail/send";'],
    ["packages/agent-channels/test/send.test.ts", 'import "../src/gmail/send.js";'],
    ["packages/agent-channels/src/gmail/send.test.ts", 'import "./send.js";'],
    [
      "packages/agent-model-gateway/src/index.ts",
      'import "openai/resources"; import "@anthropic-ai/sdk";',
    ],
    [
      "packages/agent-model-gateway/src/index.ts",
      'import type { Ingest } from "@jeswr/agent-channels/gmail";',
    ],
    [
      "packages/agent-model-gateway/src/index.ts",
      'export type { Ingest } from "@jeswr/agent-channels";',
    ],
    [
      "packages/agent-executor/src/index.ts",
      'import "@jeswr/agent-mandate"; import "@jeswr/agent-audit"; import "@jeswr/agent-credentials";',
    ],
    [
      "packages/agent-channels/src/index.ts",
      'import "@jeswr/agent-model"; import "@jeswr/guarded-fetch"; import "@jeswr/fetch-rdf"; import "@jeswr/rdf-serialize"; import "@solid/object"; import "@rdfjs/wrapper"; import "n3";',
    ],
    [
      "apps/agent-daemon/src/index.ts",
      'import "@jeswr/agent-executor"; import "@jeswr/agent-model-gateway";',
    ],
    [
      "apps/suite/src/apps/agent/index.ts",
      'import "@jeswr/agent-model"; import "@jeswr/agent-mandate/issue"; import "@jeswr/agent-mandate/verify"; import "@jeswr/agent-registry"; import "@jeswr/suite-sdk/react";',
    ],
  ])("allows the specified boundary in %s", (path, source) => {
    expect(scan(path, source)).toEqual([]);
  });

  it.each([
    ["packages/agent-channels/src/index.ts", 'import "@anthropic-ai/sdk";', "gateway-only"],
    ["packages/agent-executor/src/index.ts", 'import "openai";', "gateway-only"],
    [
      "packages/agent-executor/src/index.ts",
      'import "@jeswr/agent-model-gateway";',
      "outside DESIGN",
    ],
    [
      "packages/agent-executor/src/index.ts",
      'import "@jeswr/agent-channels";',
      "send subpaths only",
    ],
    [
      "packages/agent-memory/test/index.test.ts",
      'import "@jeswr/agent-channels/direct/send";',
      "executor-only",
    ],
    ["packages/agent-channels/src/gmail/index.ts", 'export * from "./send.js";', "executor-only"],
    [
      "packages/agent-model-gateway/src/index.ts",
      'import "../../agent-audit/src/index.js";',
      "outside DESIGN",
    ],
    [
      "packages/agent-model-gateway/src/index.ts",
      'import { Ingest } from "@jeswr/agent-channels";',
      "ingest types only",
    ],
    [
      "packages/agent-model-gateway/src/index.ts",
      'export * from "@jeswr/agent-channels";',
      "ingest types only",
    ],
    ["packages/agent-channels/src/index.ts", 'import "@jeswr/agent-executor";', "outside DESIGN"],
    [
      "apps/suite/src/apps/agent/index.ts",
      'import "@jeswr/agent-executor";',
      "agent UI dependency",
    ],
    ["apps/suite/apps/agent/index.ts", 'import "@jeswr/agent-mandate";', "issue/verify"],
    [
      "packages/agent-executor/src/index.ts",
      "await import(process.env.MODULE);",
      "unverifiable dynamic import",
    ],
  ])("refuses forbidden or unverifiable imports in %s", (path, source, reason) => {
    expect(scan(path, source).join("\n")).toContain(reason);
  });

  it("checks manifests, npm aliases and executor channel declarations", () => {
    const directory = workspace({
      "packages/agent-channels/package.json": JSON.stringify({
        devDependencies: { sdk: "npm:openai@^6.0.0" },
      }),
      "packages/agent-model-gateway/package.json": JSON.stringify({
        optionalDependencies: { "@jeswr/agent-audit": "workspace:*" },
      }),
      "packages/agent-executor/package.json": JSON.stringify({
        dependencies: { "@jeswr/agent-channels": "workspace:*" },
      }),
    });
    const failures = checkAgentLayers(directory);
    expect(failures).toHaveLength(3);
    expect(failures.join("\n")).toContain("gateway-only");
    expect(failures.join("\n")).toContain("agent-audit");
  });

  it.each([
    'import { type Ingest } from "TARGET";',
    'import { type Ingest, type Other } from "TARGET";',
    'export { type Ingest } from "TARGET";',
    'export { type Ingest, type Other } from "TARGET";',
    'import { type Ingest, value } from "TARGET";',
    'export { type Ingest, value } from "TARGET";',
    'import Default, { type Ingest } from "TARGET";',
    'import {} from "TARGET";',
    'export {} from "TARGET";',
  ])("keeps inline type specifiers subject to runtime layer rules: %s", (source) => {
    expect(
      scan(
        "packages/agent-model-gateway/src/index.ts",
        source.replace("TARGET", "@jeswr/agent-channels"),
      ).join("\n"),
    ).toContain("ingest types only");
    expect(
      scan(
        "apps/suite/src/apps/agent/index.ts",
        source.replace("TARGET", "@jeswr/agent-mandate"),
      ).join("\n"),
    ).toContain("issue/verify");
  });

  it.each([
    'import type { Ingest } from "TARGET";',
    'import type Ingest from "TARGET";',
    'import type * as Ingest from "TARGET";',
    'export type { Ingest } from "TARGET";',
    'export type * from "TARGET";',
    'export type * as Ingest from "TARGET";',
  ])("exempts whole type-only declarations from runtime layer rules: %s", (source) => {
    expect(
      scan(
        "packages/agent-model-gateway/src/index.ts",
        source.replace("TARGET", "@jeswr/agent-channels"),
      ),
    ).toEqual([]);
    expect(
      scan("apps/suite/src/apps/agent/index.ts", source.replace("TARGET", "@jeswr/agent-mandate")),
    ).toEqual([]);
  });

  it("ignores comments and string examples without importing them", () => {
    expect(
      scan(
        "packages/agent-model-gateway/src/index.ts",
        '// import "@jeswr/agent-audit";\nconst example = \'import "openai"\';',
      ),
    ).toEqual([]);
    expect(
      scan(
        "apps/pod-mail/web/src/index.ts",
        '// module.require("openai");\nconst example = \'(require)("@jeswr/agent-channels/gmail/send")\';',
      ),
    ).toEqual([]);
  });

  it("ignores generated, dependency and seeded-fixture directories", () => {
    const files = Object.fromEntries(
      ["dist", ".next", "out", "node_modules", "coverage", "__fixtures__"].map((directory) => [
        `packages/agent-channels/${directory}/index.ts`,
        'import "openai";',
      ]),
    );
    expect(checkAgentLayers(workspace(files))).toEqual([]);
  });
});

describe("agent module load allowlist", () => {
  it.each([
    'require("node:fs");',
    '(require)("node:fs");',
    '(require as Loader)("node:fs");',
    '(require satisfies Loader)("node:fs");',
    '(<Loader>require)("node:fs");',
    'require!("node:fs");',
    '(0, require)("node:fs");',
    'const load = require; load("node:fs");',
    'let load; load = require; load("node:fs");',
    "configure(require);",
    'module.require("node:fs");',
    '(module.require as Loader)("node:fs");',
    'module["require"]("node:fs");',
    'module[("require" as string)!]("node:fs");',
    'module[`require`]("node:fs");',
    "const load = module.require.bind(module);",
    "const { require: load } = module;",
    'const { "require": load } = module;',
    'const { ["require"]: load } = module;',
    'import load = require("node:fs");',
    'import type Fs = require("node:fs");',
    'import { createRequire } from "node:module";',
    'import { createRequire as makeLoader } from "node:module";',
    'import { "createRequire" as makeLoader } from "node:module";',
    'import { createRequire as makeLoader } from "module"; const load = makeLoader(import.meta.url);',
    "const makeLoader = (createRequire as Factory);",
    "const makeLoader = createRequire.bind(null);",
    'import * as mod from "node:module"; mod.createRequire(import.meta.url);',
    'const { createRequire: makeLoader } = await import("node:module");',
    'const { ["createRequire"]: makeLoader } = await import("node:module");',
    'const { [("createRequire" as const)]: makeLoader } = await import("node:module");',
    'import * as mod from "node:module"; const makeLoader = mod["createRequire"];',
    'export { createRequire as makeLoader } from "node:module";',
  ])("rejects CommonJS loader capabilities: %s", (source) => {
    expect(scan("packages/agent-model-gateway/src/index.ts", source).join("\n")).toContain(
      "CommonJS",
    );
  });

  it.each([
    "await import(specifier);",
    'await import("node:" + "fs");',
    "await import(`node:fs`);",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source fixture for a dynamic import
    "await import(`node:${name}`);",
    'await import(("node:fs"));',
    'await import("node:fs" as string);',
    'await import(new URL("node:fs"));',
    "await import();",
  ])("rejects non-literal module loads: %s", (source) => {
    expect(scan("packages/agent-model/src/index.ts", source).join("\n")).toContain(
      "unverifiable dynamic import",
    );
  });

  it.each([
    'import "./local.js";',
    'import * as local from "./local.js";',
    'import { value as local } from "./local.js";',
    'export * from "./local.js";',
    'export { value as local } from "./local.js";',
    'export * as local from "./local.js";',
    'import type { Value } from "./local.js";',
    'export type { Value } from "./local.js";',
    'type Value = import("./local.js").Value;',
    'await import("./local.js");',
    'await import("fs");',
    'import "fs/promises";',
    'import "@scope/package/subpath";',
    'import "../local.js";',
    'import "../../local.js";',
    'await import("./local.js", { with: { type: "json" } });',
  ])("allows literal ESM forms: %s", (source) => {
    expect(scan("packages/agent-model/src/index.ts", source)).toEqual([]);
  });

  it.each([
    "file:///tmp/module.js",
    "data:text/javascript,export default 1",
    "http://example.test/module.js",
    "https://example.test/module.js",
    "HTTPS://example.test/module.js",
    "ftp://example.test/module.js",
    "node:fs",
    "./local.js?raw",
    "../local.js#fragment",
    "@scope/package?query",
    "@scope/package/subpath#fragment",
    "package?query",
    "package#fragment",
    "#internal",
    "/tmp/module.js",
    "//example.test/module.js",
    "C:/tmp/module.js",
    "C:\\tmp\\module.js",
    "./local%2ejs",
    "./%2e%2e/local.js",
    "./local%2fmodule.js",
    "./local%5cmodule.js",
    "./local%zz.js",
    "./local\t.js",
    "./local\n.js",
    "./local\r.js",
    "",
  ])("rejects specifiers outside bare packages and relative paths: %s", (specifier) => {
    const literal = JSON.stringify(specifier);
    for (const source of [
      `import ${literal};`,
      `import * as value from ${literal};`,
      `export * from ${literal};`,
      `export { value } from ${literal};`,
      `await import(${literal});`,
      `import type { Value } from ${literal};`,
      `export type { Value } from ${literal};`,
      `type Value = import(${literal}).Value;`,
    ])
      expect(scan("packages/agent-model/src/index.ts", source).join("\n")).toContain(
        "agent module specifier must be a bare package name or relative path",
      );
  });

  it.each([
    'import "f\\u0069le:///tmp/module.js";',
    'await import("./local.js\\u003fraw");',
    'export * from "./local.js\\u0023fragment";',
    'import "../../agent-model/src/index.js?raw";',
  ])("checks decoded specifiers before path normalization: %s", (source) => {
    expect(scan("packages/agent-model/src/index.ts", source).join("\n")).toContain(
      "agent module specifier must be a bare package name or relative path",
    );
  });

  it.each([
    ["apps/agent-daemon/src/index.ts", "../../../packages/agent-channels/src/gmail/%73end.js"],
    ["packages/agent-model-gateway/src/index.ts", "../../agent-%61udit/src/index.js"],
    ["packages/agent-model-gateway/src/index.ts", "../../agent-audit/src/%69ndex.js"],
    ["apps/pod-mail/web/src/index.ts", "../../../../packages/agent-channels/src/gmail/%73end.js"],
  ])("rejects encoded boundary targets in %s before filesystem normalization", (path, target) => {
    const literal = JSON.stringify(target);
    for (const source of [
      `import ${literal};`,
      `export * from ${literal};`,
      `await import(${literal});`,
      `type Value = import(${literal}).Value;`,
    ])
      expect(scan(path, source).join("\n")).toContain(
        "URL-encoded module specifiers are forbidden",
      );
  });

  it.each([
    "packages/agent-channels/test/transport.test.ts",
    "packages/agent-channels/vitest.config.ts",
    "apps/agent-daemon/src/index.ts",
    "apps/suite/src/apps/agent/index.ts",
  ])("enforces the specifier allowlist throughout agent code: %s", (path) => {
    expect(scan(path, 'import "file:///tmp/module.js";').join("\n")).toContain(
      "agent module specifier must be a bare package name or relative path",
    );
  });
});

describe("agent capability references", () => {
  const globals = ["fetch", "globalThis", "global", "window", "self"];
  const wrappers = [
    "VALUE",
    "(VALUE)",
    "VALUE as any",
    "VALUE satisfies unknown",
    "<any>VALUE",
    "VALUE!",
    "(((VALUE as any) satisfies unknown)!)",
  ];

  it.each(globals)("rejects every wrapped reference to %s", (name) => {
    for (const wrapper of wrappers) {
      const expression = wrapper.replace("VALUE", name);
      expect(
        scan("packages/agent-channels/src/gmail/index.ts", `configure(${expression});`).join("\n"),
      ).toContain(`forbidden agent identifier: ${name}`);
    }
  });

  it.each([
    'const ORIGINS = new Set(["https://mail.example"]); fetch("https://mail.example/messages");',
    'global.fetch("https://mail.example/messages");',
    'globalThis["fetch"](input);',
    "const root = global; const request = root.fetch;",
    "const { fetch: request } = globalThis;",
    "let request; ({ fetch: request } = window);",
    "function configure({ fetch: request } = self) {}",
    "const request = fetch.bind(globalThis);",
    "const transport = { fetch };",
    "const transport = { request: fetch };",
    "let request; request = fetch;",
    "export { fetch };",
    "export { global as root };",
    "export default self;",
    "class Transport extends (fetch as any) {}",
    "const request = fetch<any>;",
    "type Fetch = typeof fetch;",
    "type Fetch = typeof globalThis.fetch;",
    "interface Transport extends globalThis.fetch {}",
    "class Fake implements fetch {}",
    "export type { fetch };",
    "const value = transport[fetch];",
    "const value = { [global]: fake };",
    "const { [self]: value } = transport;",
    "const { fetch } = transport;",
    'import { fetch as request } from "./transport.js";',
    "const request = f\\u0065tch;",
  ])("rejects direct calls, escapes and type references: %s", (source) => {
    expect(scan("packages/agent-channels/src/gmail/index.ts", source).join("\n")).toContain(
      "forbidden agent identifier",
    );
  });

  it.each([
    "packages/agent-executor/src/index.ts",
    "packages/agent-model-gateway/src/index.ts",
    "packages/agent-memory/src/index.ts",
    "packages/agent-channels/src/gmail/index.ts",
    "packages/agent-channels/test/transport.test.ts",
    "packages/agent-channels/src/gmail/transport.spec.ts",
    "packages/agent-channels/vitest.config.ts",
    "apps/agent-daemon/src/index.ts",
    "apps/agent-daemon/test/transport.test.ts",
    "apps/suite/src/apps/agent/index.ts",
  ])("enforces capability restrictions throughout agent code: %s", (path) => {
    for (const name of globals)
      expect(scan(path, `configure(${name});`).join("\n")).toContain(
        `forbidden agent identifier: ${name}`,
      );
    expect(scan(path, 'const load = require; load("node:fs");').join("\n")).toContain("CommonJS");
    expect(scan(path, "await import(specifier);").join("\n")).toContain(
      "unverifiable dynamic import",
    );
  });

  it.each(globals)("allows %s as an ordinary property or member name", (name) => {
    expect(
      scan(
        "packages/agent-channels/src/gmail/index.ts",
        `const transport = { ${name}: fake }; transport.${name}(input);
         transport["${name}"](input); const { ${name}: request } = transport;
         interface Transport { ${name}: TransportTypes.${name}; }
         class Fake { ${name}() {} }`,
      ),
    ).toEqual([]);
  });

  it("allows guarded transport calls and inert examples", () => {
    expect(
      scan(
        "packages/agent-channels/src/gmail/index.ts",
        'import { guardedFetch } from "@jeswr/guarded-fetch"; guardedFetch(input); io.fetch(input); // require(global.fetch)\nconst example = "createRequire, fetch, globalThis, global, window, self";',
      ),
    ).toEqual([]);
  });

  it("keeps other packages outside the agent capability policy", () => {
    expect(
      scan("packages/guarded-fetch/src/index.ts", "const request = globalThis.fetch;"),
    ).toEqual([]);
  });
});
