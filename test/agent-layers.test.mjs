// AUTHORED-BY Codex GPT-6.1-Sol
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
      'import { type Ingest } from "@jeswr/agent-channels";',
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

  it("ignores comments and string examples without importing them", () => {
    expect(
      scan(
        "packages/agent-model-gateway/src/index.ts",
        '// import "@jeswr/agent-audit";\nconst example = \'import "openai"\';',
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

describe("binding origin enforcement", () => {
  const wrappers = [
    "(FETCH)",
    "FETCH as typeof fetch",
    "FETCH satisfies typeof fetch",
    "<typeof fetch>FETCH",
    "FETCH!",
    "(((FETCH as typeof fetch) satisfies typeof fetch)!)",
  ];
  const rawFetchForms = [
    "fetch",
    "globalThis.fetch",
    "window.fetch",
    "self.fetch",
    'globalThis["fetch"]',
  ];
  const origins = 'const ORIGINS = new Set(["https://mail.example"]);';

  it.each(wrappers)("rejects storing a raw fetch wrapped as %s", (wrapper) => {
    for (const raw of rawFetchForms) {
      const expression = wrapper.replace("FETCH", raw);
      const failures = scan(
        "packages/agent-channels/src/gmail/index.ts",
        `${origins} const request = ${expression}; request("https://mail.example/messages");`,
      );
      expect(failures.join("\n")).toContain("raw fetch reference");
    }
  });

  it.each(wrappers)("validates a direct fetch wrapped as %s", (wrapper) => {
    for (const raw of rawFetchForms) {
      const expression = wrapper.replace("FETCH", raw);
      expect(
        scan(
          "packages/agent-channels/src/gmail/index.ts",
          `${origins} (${expression})("https://mail.example/messages");`,
        ),
      ).toEqual([]);
      expect(
        scan(
          "packages/agent-channels/src/gmail/index.ts",
          `${origins} (${expression})("https://other.example/messages");`,
        ).join("\n"),
      ).toContain("static ORIGINS");
    }
  });

  it.each([
    'let request; request = fetch; request("https://other.example/messages");',
    'let request; request = (globalThis.fetch as typeof fetch)!; request("https://other.example/messages");',
    "configure(fetch);",
    "configure((window.fetch satisfies typeof fetch));",
    "const { fetch: f } = globalThis;",
    "const { fetch } = window;",
    'const { ["fetch"]: f } = (self as Window);',
    'const { "fetch": f } = globalThis;',
    "let request; ({ fetch: request } = globalThis);",
    "function configure({ fetch: request } = globalThis) {}",
    "const request = fetch.bind(globalThis);",
    "const request = globalThis.fetch.call;",
    "export { fetch };",
    "export { fetch as request };",
    "export default fetch;",
    "export default (self.fetch!);",
    "export const request = globalThis.fetch;",
    "const transport = { fetch };",
    "const transport = { request: fetch };",
    "class Transport extends (fetch as any) {}",
    "const request = fetch<any>;",
  ])("rejects raw fetch escaping even with valid declared origins: %s", (source) => {
    expect(
      scan("packages/agent-channels/src/gmail/index.ts", `${origins} ${source}`).join("\n"),
    ).toContain("raw fetch");
  });

  it.each([
    "packages/agent-executor/src/index.ts",
    "packages/agent-model-gateway/src/index.ts",
    "packages/agent-memory/src/index.ts",
    "apps/agent-daemon/src/index.ts",
    "apps/suite/src/apps/agent/index.ts",
  ])("enforces raw fetch references throughout agent source: %s", (path) => {
    expect(scan(path, `${origins} configure(globalThis.fetch);`).join("\n")).toContain("raw fetch");
    expect(scan(path, `${origins} fetch("https://mail.example/messages");`)).toEqual([]);
    expect(scan(path, `${origins} fetch(input);`).join("\n")).toContain("static ORIGINS");
  });

  it("preserves test and type-only references without treating property names as raw fetch", () => {
    expect(scan("packages/agent-channels/test/transport.test.ts", "configure(fetch);")).toEqual([]);
    expect(
      scan(
        "packages/agent-channels/src/gmail/index.ts",
        "type Fetch = typeof globalThis.fetch; type Bare = typeof fetch; export type { fetch }; interface Transport extends globalThis.fetch {} class Fake implements fetch {} const transport = { fetch: fake }; const { fetch: f, ...rest } = transport;",
      ),
    ).toEqual([]);
  });

  it("reuses a binding's imported static origins in its send half", () => {
    expect(
      checkAgentLayers(
        workspace({
          "packages/agent-channels/src/gmail.ts":
            'export const ORIGINS = new Set(["https://mail.example"]);',
          "packages/agent-channels/src/gmail/send.ts":
            'import { ORIGINS } from "../gmail.js"; fetch("https://mail.example/messages");',
        }),
      ),
    ).toEqual([]);
  });
  it("allows a literal URL only when its exact origin is statically declared", () => {
    expect(
      scan(
        "packages/agent-channels/src/gmail/index.ts",
        'export const ORIGINS: ReadonlySet<string> = new Set(["https://mail.example"]); fetch("https://mail.example/messages");',
      ),
    ).toEqual([]);
  });

  it.each([
    'fetch("https://mail.example/messages");',
    'const ORIGINS = new Set(["https://mail.example"]); fetch("https://mail.example.evil.example/messages");',
    'const ORIGINS = new Set(["https://mail.example"]); globalThis.fetch("https://other.example/messages");',
    'const ORIGINS = new Set(["https://mail.example"]); fetch(input);',
    'const ORIGINS = new Set(["https://mail.example"]); io.fetch(new URL("https://other.example/messages"));',
    'const request = globalThis.fetch; request("https://other.example/messages");',
    'globalThis["fetch"]("https://other.example/messages");',
    'const { fetch: request } = globalThis; request("https://other.example/messages");',
    'const request = fetch.bind(globalThis); request("https://other.example/messages");',
    'const ORIGINS = new Set(["https://mail.example"]); let url = "https://mail.example"; url = input; fetch(url);',
    'let ORIGINS = new Set(["https://mail.example"]); fetch("https://mail.example/messages");',
    'function configure() { const ORIGINS = new Set(["https://mail.example"]); } fetch("https://mail.example/messages");',
  ])("refuses missing, hostile or unverifiable fetch origins: %s", (source) => {
    expect(scan("packages/agent-channels/src/gmail/index.ts", source).join("\n")).toContain(
      "static ORIGINS",
    );
  });
});
