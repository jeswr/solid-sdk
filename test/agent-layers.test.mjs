// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  const projects = Object.fromEntries(
    Object.keys(files)
      .filter((path) => /^(?:packages|apps|tools)\/[^/]+\//.test(path))
      .map((path) => {
        const [base, name] = path.split("/");
        return [`${base}/${name}/package.json`, JSON.stringify({ name: `@jeswr/${name}` })];
      }),
  );
  const contents = {
    "pnpm-workspace.yaml":
      'packages:\n  - "packages/*"\n  - "apps/*"\n  - "apps/*/web"\n  - "tools/*"\n',
    "package.json": '{"name":"@jeswr/test-workspace"}',
    ...projects,
    ...files,
  };
  for (const [path, source] of Object.entries(contents)) {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return directory;
}

function scan(path, source) {
  return checkAgentLayers(
    workspace({
      "packages/agent-model/src/local.js": "export {};",
      "packages/agent-model/local.js": "export {};",
      "packages/local.js": "export {};",
      "packages/agent-channels/src/gmail/send.ts": "export {};",
      "packages/agent-audit/src/index.ts": "export {};",
      [path]: source,
    }),
  );
}

describe("agent layer boundaries (DESIGN §2.2)", () => {
  it("rejects type-only ./gmail/send imports outside the executor", () => {
    expect(
      scan(
        "packages/agent-channels/src/reader.ts",
        'import type { Send } from "./gmail/send";',
      ).join("\n"),
    ).toContain("executor-only");
    expect(
      scan(
        "packages/agent-executor/src/index.ts",
        'import type { Send } from "@jeswr/agent-channels/gmail/send";',
      ),
    ).toEqual([]);
  });
  it("allows only the direct test factory composition and blocks production consumers", () => {
    expect(
      scan(
        "packages/agent-channels/src/testing.ts",
        'export { createInMemoryDirectBinding } from "./direct/send.js";',
      ),
    ).toEqual([]);
    expect(
      scan("packages/agent-channels/src/testing.ts", 'export * from "./gmail/send.js";').join("\n"),
    ).toContain("executor-only");
    expect(
      scan("apps/example/src/index.ts", 'import "@jeswr/agent-channels/testing";').join("\n"),
    ).toContain("test-only");
    expect(
      scan(
        "apps/example/src/index.ts",
        'import "../../../packages/agent-channels/src/testing.js";',
      ).join("\n"),
    ).toContain("test-only");
    expect(
      scan("apps/example/src/index.test.ts", 'import "@jeswr/agent-channels/testing";'),
    ).toEqual([]);
  });
  it.each([
    'import "openai";',
    'export * from "@anthropic-ai/sdk";',
    'await import("openai");',
    'import "open\\u0061i";',
  ])("also enforces SDK isolation outside agent projects: %s", (source) => {
    expect(scan("apps/pod-mail/web/src/index.ts", source).join("\n")).toContain("gateway-only");
  });
  it.each([
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "mts",
    "cts",
  ])("parses every .%s file even when preprocessing misses its imports", (extension) => {
    for (const target of ["openai", "@jeswr/agent-channels/gmail/send"]) {
      const source = `const pattern = /"/; import "${target}";`;
      expect(scan(`tools/example/index.${extension}`, source).join("\n")).toContain(
        target === "openai" ? "gateway-only" : "executor-only",
      );
    }
  });

  it("parses JSX text before a restricted re-export", () => {
    expect(
      scan(
        "apps/example/src/index.tsx",
        `const view = <div>'</div>; export * from "@jeswr/agent-channels/gmail/send";`,
      ).join("\n"),
    ).toContain("executor-only");
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
    'type Send = import("@jeswr/agent-channels/gmail/send").Send;',
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

describe("lexical workspace ownership", () => {
  function fixture(
    source,
    target = "packages/channel-store/gmail/send.ts",
    targetName = "@jeswr/agent-channels",
  ) {
    return workspace({
      "pnpm-workspace.yaml":
        'packages:\n  - "packages/*"\n  - "apps/*"\n  - "apps/*/web"\n  - "tools/*"\n',
      "packages/agent-model-gateway/package.json": JSON.stringify({
        name: "@jeswr/agent-model-gateway",
      }),
      "packages/agent-model-gateway/src/index.ts": source,
      [`${target.split("/").slice(0, 2).join("/")}/package.json`]: JSON.stringify({
        name: targetName,
      }),
      [target]: "export {};",
    });
  }

  it.each([
    'import "../../channel-store/gmail/send.js";',
    'export * from "../../channel-store/gmail/send.js";',
    'await import("../../channel-store/gmail/send.js");',
    'type Send = import("../../channel-store/gmail/send.js").Send;',
  ])("checks targets outside src/dist using the manifest name: %s", (source) => {
    expect(checkAgentLayers(fixture(source)).join("\n")).toContain("executor-only");
  });

  it("checks another project's root entry", () => {
    const directory = fixture(
      'import "../../audit-store/index.js";',
      "packages/audit-store/index.ts",
      "@jeswr/agent-audit",
    );
    expect(checkAgentLayers(directory).join("\n")).toContain("gateway must not import agent-audit");
  });

  it.each(["bare", "relative"])("ignores installed symlink targets for %s imports", (kind) => {
    const specifier = kind === "bare" ? "alias/gmail/send.js" : "./local.js";
    const directory = fixture(`import "${specifier}";`);
    const modules = join(directory, "packages/agent-model-gateway/node_modules");
    mkdirSync(modules, { recursive: true });
    symlinkSync(join(directory, "packages/channel-store"), join(modules, "alias"), "dir");
    symlinkSync(
      join(directory, "packages/channel-store/gmail/send.ts"),
      join(directory, "packages/agent-model-gateway/src/local.js"),
    );
    writeFileSync(
      join(directory, "packages/agent-model-gateway/package.json"),
      JSON.stringify({
        name: "@jeswr/agent-model-gateway",
        devDependencies: { alias: "link:../channel-store" },
      }),
    );
    const failures = checkAgentLayers(directory);
    if (kind === "bare") {
      expect(failures).toEqual([
        "packages/agent-model-gateway/src/index.ts:1: agent-model-gateway dependency is outside DESIGN §2.2: alias/gmail/send.js",
      ]);
    } else expect(failures).toEqual([]);
  });

  it("uses the longest workspace project prefix for nested apps", () => {
    const directory = workspace({
      "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n  - "apps/*"\n  - "apps/*/web"\n',
      "packages/agent-model-gateway/package.json": '{"name":"@jeswr/agent-model-gateway"}',
      "packages/agent-model-gateway/src/index.ts": 'import "../../../apps/example/web/index.js";',
      "apps/example/package.json": '{"name":"@jeswr/agent-model"}',
      "apps/example/web/package.json": '{"name":"@jeswr/agent-audit"}',
      "apps/example/web/index.ts": "export {};",
    });
    expect(checkAgentLayers(directory).join("\n")).toContain("gateway must not import agent-audit");
  });

  it("discovers tool projects from the workspace globs", () => {
    const directory = fixture('import "../../../tools/audit-store/index.js";');
    mkdirSync(join(directory, "tools/audit-store"), { recursive: true });
    writeFileSync(
      join(directory, "tools/audit-store/package.json"),
      '{"name":"@jeswr/agent-audit"}',
    );
    writeFileSync(join(directory, "tools/audit-store/index.ts"), "export {};");
    expect(checkAgentLayers(directory).join("\n")).toContain("gateway must not import agent-audit");
  });

  it("fails closed for lexical paths outside all workspace projects", () => {
    const directory = fixture('import "../../../../outside/index.js";');
    expect(checkAgentLayers(directory).join("\n")).toContain("outside every workspace project");
  });

  it("maps bare workspace exports by package name without builds or installed links", () => {
    const directory = workspace({
      "packages/agent-executor/src/index.ts": 'import "@jeswr/agent-channels/gmail/send";',
      "packages/channel-store/package.json": JSON.stringify({
        name: "@jeswr/agent-channels",
        exports: { "./gmail/send": "./dist/transport.js" },
      }),
    });
    expect(checkAgentLayers(directory)).toEqual([]);
    writeFileSync(
      join(directory, "packages/agent-executor/src/index.ts"),
      'import "@jeswr/agent-channels";',
    );
    expect(checkAgentLayers(directory).join("\n")).toContain("send subpaths only");
  });

  it("restricts bare send exports even when exports point at another filename", () => {
    const directory = fixture('import "@jeswr/agent-channels/gmail/send";');
    writeFileSync(
      join(directory, "packages/channel-store/package.json"),
      JSON.stringify({
        name: "@jeswr/agent-channels",
        exports: { "./gmail/send": "./dist/transport.js" },
      }),
    );
    expect(checkAgentLayers(directory).join("\n")).toContain("executor-only");
  });

  it("allows missing local files and generated template content", () => {
    const directory = workspace({
      "packages/agent-model/src/index.ts": 'import "./missing.js";',
      "packages/create-solid-demo/template/apps/tour/src/index.ts":
        'import "../content/walkthrough.json";',
    });
    expect(checkAgentLayers(directory)).toEqual([]);
  });

  it("applies cross-project rules to missing generated targets", () => {
    const directory = fixture('import "../../channel-store/dist/gmail/send.js";');
    expect(checkAgentLayers(directory).join("\n")).toContain("executor-only");
  });

  it("allows lexical local imports and permitted cross-project types", () => {
    const directory = fixture(
      'import "./local.js"; import type { Ingest } from "../../channel-store/ingest.js";',
      "packages/channel-store/ingest.ts",
    );
    writeFileSync(join(directory, "packages/agent-model-gateway/src/local.ts"), "export {};");
    expect(checkAgentLayers(directory)).toEqual([]);
  });
});

describe("global restrictions across module load forms", () => {
  const forms = [
    "import TARGET;",
    "export * from TARGET;",
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
    "type Value = import(TARGET).Value;",
  ];

  it.each(forms)("checks bare specifiers across all checked roots: %s", (form) => {
    for (const path of [
      "packages/ordinary/src/index.ts",
      "apps/ordinary/web/src/index.ts",
      "tools/ordinary/index.ts",
      "scripts/ordinary.ts",
      "test/ordinary.test.ts",
      "index.ts",
    ]) {
      for (const [target, reason] of [
        ["openai/resources", "gateway-only"],
        ["@anthropic-ai/sdk", "gateway-only"],
        ["@jeswr/agent-channels/gmail/send", "executor-only"],
      ])
        expect(scan(path, form.replace("TARGET", JSON.stringify(target))).join("\n")).toContain(
          reason,
        );
    }
  });

  it.each(forms)("checks relative, absolute and file URL targets lexically: %s", (form) => {
    for (const kind of ["relative", "absolute", "file", "file-upper"])
      for (const [name, subpath, reason] of [
        ["@jeswr/agent-channels", "dist/gmail/send.js", "executor-only"],
        ["openai", "dist/index.js", "gateway-only"],
        ["@anthropic-ai/sdk", "dist/index.js", "gateway-only"],
      ]) {
        const directory = workspace({
          "apps/ordinary/web/package.json": '{"name":"@jeswr/ordinary-web"}',
          "apps/ordinary/web/src/index.ts": "",
          "tools/provider-store/package.json": JSON.stringify({ name }),
        });
        const file = join(directory, "apps/ordinary/web/src/index.ts");
        const target = join(directory, "tools/provider-store", subpath);
        const specifier = kind.startsWith("file")
          ? pathToFileURL(target).href.replace(/^file:/, kind === "file-upper" ? "FILE:" : "file:")
          : kind === "absolute"
            ? target
            : relative(dirname(file), target);
        writeFileSync(file, form.replace("TARGET", JSON.stringify(specifier)));
        expect(checkAgentLayers(directory).join("\n")).toContain(reason);
      }
  });

  it.each(forms)("rejects disallowed path characters globally: %s", (form) => {
    for (const prefix of ["./", "../", "/"])
      for (const character of [
        "\\",
        "\t",
        "\n",
        "\r",
        " ",
        "\0",
        "\x7f",
        "é",
        "?",
        "#",
        "%",
        ":",
        "!",
        "$",
        "&",
        "'",
        "(",
        ")",
        "*",
        "+",
        ",",
        ";",
        "=",
        "[",
        "]",
        "{",
        "}",
        "<",
        ">",
        "|",
        "^",
        "`",
        "~",
      ])
        for (const specifier of [
          `${prefix}local${character}.js`,
          `${prefix}local.js${character}`,
        ]) {
          expect(
            scan("tools/ordinary/index.ts", form.replace("TARGET", JSON.stringify(specifier))),
          ).toContain(
            `tools/ordinary/index.ts:1: relative and absolute module specifiers must match ^[A-Za-z0-9@._/-]+$: ${specifier}`,
          );
        }
  });

  it.each(
    forms,
  )("allows the exact path alphabet without requiring targets to exist: %s", (form) => {
    const directory = workspace({ "tools/ordinary/index.ts": "" });
    const file = join(directory, "tools/ordinary/index.ts");
    for (const specifier of [
      "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@._-/missing.js",
      "../ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@._-/missing.js",
      join(
        directory,
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@._-/missing.js",
      ),
    ]) {
      writeFileSync(file, form.replace("TARGET", JSON.stringify(specifier)));
      expect(checkAgentLayers(directory)).toEqual([]);
    }
  });

  it.each([
    "packages/ordinary/src/index.ts",
    "packages/agent-model/src/index.ts",
    "apps/ordinary/web/src/index.ts",
    "tools/ordinary/index.ts",
    "scripts/ordinary.ts",
    "test/ordinary.test.ts",
    "index.ts",
  ])("rejects ESM-normalized path characters in every checked root: %s", (path) => {
    for (const specifier of [
      "./gmail\\send.js",
      "./gmail/se\tnd.js",
      "./gmail/se\nnd.js",
      "./gmail/se\rnd.js",
    ])
      expect(scan(path, `import ${JSON.stringify(specifier)};`).join("\n")).toContain(
        "relative and absolute module specifiers must match ^[A-Za-z0-9@._/-]+$",
      );
  });

  it.each(forms)("rejects URL suffixes and escapes globally: %s", (form) => {
    for (const kind of ["relative", "absolute", "file", "file-upper"])
      for (const suffix of ["?raw", "#fragment", "%2ejs", "%zz"]) {
        const directory = workspace({ "tools/ordinary/index.ts": "" });
        const file = join(directory, "tools/ordinary/index.ts");
        const target = join(directory, "tools/ordinary/local.js");
        const specifier =
          (kind.startsWith("file")
            ? pathToFileURL(target).href.replace(
                /^file:/,
                kind === "file-upper" ? "FILE:" : "file:",
              )
            : kind === "absolute"
              ? target
              : "./local.js") + suffix;
        writeFileSync(file, form.replace("TARGET", JSON.stringify(specifier)));
        expect(checkAgentLayers(directory)).toContain(
          `tools/ordinary/index.ts:1: ${kind.startsWith("file") ? "relative, absolute and file: module specifiers must not contain ?, # or %" : "relative and absolute module specifiers must match ^[A-Za-z0-9@._/-]+$"}: ${specifier}`,
        );
      }
  });

  it.each([
    "../../../packages/agent-channels/src/gmail\\send.js",
    "../../../packages/agent-channels/src/gmail/se\tnd.js",
    "../../../packages/agent-channels/src/gmail/se\nnd.js",
    "../../../packages/agent-channels/src/gmail/se\rnd.js",
    "../../../packages/agent-channels/src/gmail/send.js?raw",
    "../../../packages/agent-channels/src/gmail/send.js#fragment",
    "../../../packages/agent-channels/src/gmail/%73end.js",
    "../../../packages/agent-channels/src/gmail/send%2ejs",
    "../../../packages/%61gent-channels/src/gmail/send.js",
  ])("rejects escaped and suffixed cross-project targets: %s", (specifier) => {
    expect(
      scan("apps/ordinary/src/index.ts", `import ${JSON.stringify(specifier)};`).join("\n"),
    ).toContain("relative and absolute module specifiers must match ^[A-Za-z0-9@._/-]+$");
  });

  it("checks literal templates and wrapped literals outside agent projects", () => {
    for (const source of [
      "require(`openai`);",
      'await import(("openai" as string));',
      'module[("require" as const)]("openai");',
    ])
      expect(scan("apps/ordinary/src/index.ts", source).join("\n")).toContain("gateway-only");
  });

  it("reports malformed file URLs without crashing the scan", () => {
    expect(
      scan("tools/ordinary/index.ts", 'import "file://remote.example/module.js";').join("\n"),
    ).toContain("invalid file URL import target");
  });

  it("preserves global exceptions without permitting agent CommonJS", () => {
    expect(scan("packages/agent-model-gateway/src/index.ts", 'import "openai";')).toEqual([]);
    expect(
      scan("packages/agent-executor/src/index.ts", 'import "@jeswr/agent-channels/gmail/send";'),
    ).toEqual([]);
    expect(
      scan(
        "packages/agent-channels/test/send.test.ts",
        'import "@jeswr/agent-channels/gmail/send";',
      ),
    ).toEqual([]);
    expect(
      scan(
        "packages/ordinary/src/index.ts",
        'require("ordinary-external"); import value = require("other-external");',
      ),
    ).toEqual([]);
    for (const [path, target] of [
      ["packages/agent-model-gateway/src/index.ts", "openai"],
      ["packages/agent-executor/src/index.ts", "@jeswr/agent-channels/gmail/send"],
      ["packages/agent-channels/test/send.test.ts", "@jeswr/agent-channels/gmail/send"],
    ]) {
      const failures = scan(path, `require(${JSON.stringify(target)});`);
      expect(failures.length).toBeGreaterThan(0);
      for (const failure of failures) expect(failure).toContain("CommonJS");
    }
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
    '(requ\\u0069re)("openai");',
    'require.resolve("openai");',
    '(require.resolve as Resolver)("openai");',
    'require["resolve"]("openai");',
    'module.require.resolve("openai");',
    'module["requ\\u0069re"]["resolve"]("openai");',
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
    'createRequire(import.meta.url)("openai");',
    '(createRequire as Factory)(import.meta.url).resolve("openai");',
    'mod["createRequire"](import.meta.url)("openai");',
    'mod[`createRequire`](import.meta.url).resolve("openai");',
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
    ["apps/agent-daemon/src/index.ts", "../../../packages/agent-channels/src/gmail/send.js?raw"],
    [
      "apps/agent-daemon/src/index.ts",
      "../../../packages/agent-channels/src/gmail/send.js#fragment",
    ],
    ["packages/agent-executor/src/index.ts", "@jeswr/agent-channels/gmail/send?raw"],
    ["packages/agent-executor/src/index.ts", "@jeswr/agent-channels/gmail/send#fragment"],
    ["packages/agent-model-gateway/src/index.ts", "../../agent-audit/src/index.js?raw"],
    ["packages/agent-model-gateway/src/index.ts", "../../agent-audit/src/index.js#fragment"],
  ])("rejects unsupported boundary specifiers in %s without resolving them", (path, target) => {
    const literal = JSON.stringify(target);
    for (const source of [
      `import ${literal};`,
      `export * from ${literal};`,
      `await import(${literal});`,
      `type Value = import(${literal}).Value;`,
    ])
      expect(scan(path, source)).toContain(
        `${path}:1: agent module specifier must be a bare package name or relative path: ${target}`,
      );
  });

  it.each([
    "require(TARGET);",
    "(require as Loader)(TARGET);",
    'module["require"](TARGET);',
    "require.resolve(TARGET);",
    "module.require.resolve(TARGET);",
    "createRequire(import.meta.url)(TARGET);",
    "import value = require(TARGET);",
    "import type Value = require(TARGET);",
  ])("rejects CommonJS independently of its target: %s", (source) => {
    for (const target of [
      "fs",
      "openai",
      "@jeswr/agent-channels/gmail/send",
      "./local.js?raw",
      "./local%2ejs",
    ]) {
      const failures = scan(
        "packages/agent-model/src/index.ts",
        source.replace("TARGET", JSON.stringify(target)),
      );
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.some((failure) => failure.includes("CommonJS"))).toBe(true);
      if (target === "openai") expect(failures.join("\n")).toContain("gateway-only");
      if (target === "@jeswr/agent-channels/gmail/send")
        expect(failures.join("\n")).toContain("executor-only");
    }
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

describe("root project enforcement", () => {
  it.each([
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "devDependencies",
  ])("checks root manifest %s including npm aliases", (field) => {
    for (const [name, version, reason] of [
      ["openai", "^6.0.0", "gateway-only"],
      ["sdk", "npm:@anthropic-ai/sdk@^1.0.0", "gateway-only"],
      ["send", "npm:@jeswr/agent-channels/gmail/send@0.1.0", "executor-only"],
    ]) {
      const directory = workspace({
        "package.json": JSON.stringify({
          name: "@jeswr/test-workspace",
          [field]: { [name]: version },
        }),
      });
      const failures = checkAgentLayers(directory);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain(
        `package.json: ${reason === "gateway-only" ? "model SDKs are gateway-only" : "send subpaths are executor-only"}`,
      );
    }
  });

  it.each([
    "ts",
    "tsx",
    "mts",
    "cts",
    "js",
    "jsx",
    "mjs",
    "cjs",
  ])("checks root .%s sources", (extension) => {
    expect(scan(`index.${extension}`, 'import "openai";').join("\n")).toContain("gateway-only");
    expect(
      scan(
        `index.${extension}`,
        'export * from "./packages/agent-channels/src/gmail/send.js";',
      ).join("\n"),
    ).toContain("executor-only");
    expect(scan(`index.${extension}`, 'await import("./local.js?raw");').join("\n")).toContain(
      "relative and absolute module specifiers must match ^[A-Za-z0-9@._/-]+$",
    );
  });

  it("allows ordinary root dependencies and lexical imports without built output", () => {
    expect(
      checkAgentLayers(
        workspace({
          "package.json": JSON.stringify({
            name: "@jeswr/test-workspace",
            devDependencies: { typescript: "^6.0.0" },
          }),
          "index.mjs":
            'import "typescript"; import "./missing.js"; import "./packages/agent-model/dist/index.js";',
          "packages/agent-model/package.json": '{"name":"@jeswr/agent-model"}',
        }),
      ),
    ).toEqual([]);
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
