#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const packages = [
  "storage-capabilities",
  "storage-client",
  "pod-auth",
  "pod-notifications",
  "pod-access",
  "solid-bookmark",
  "fetch-rdf",
  "rdf-serialize",
  "suite-vocab",
];
const defaultSkills = [
  // Keep the selected standalone skill fences separate from the guide's import allowlist.
  "packages/storage-capabilities/SKILL.md",
  "packages/storage-client/SKILL.md",
  "packages/pod-auth/SKILL.md",
  "packages/pod-notifications/SKILL.md",
  "packages/pod-access/SKILL.md",
  "skills/lws-vs-solid/SKILL.md",
  "skills/solid-notifications/SKILL.md",
  "skills/solid-reactive-authentication/SKILL.md",
];

function defaultFiles() {
  const guide = join(root, "docs/guide");
  return [
    ...defaultSkills.map((file) => join(root, file)),
    join(root, "skills/build-solid-app/SKILL.md"),
    ...(existsSync(guide)
      ? readdirSync(guide, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => join(guide, entry.name))
      : []),
  ].filter((file) => existsSync(file));
}

function declaration(entry) {
  const path = typeof entry === "string" ? entry : entry?.types;
  // Raw artifacts (.ttl, package.json) and runtime-only entries have no declarations.
  return typeof path === "string" && /\.d\.[cm]?ts$/.test(path) ? path : undefined;
}

/** Check independent TS fences against built public exports, without running examples. */
export function checkExamples(files = defaultFiles()) {
  const paths = {};
  for (const name of packages) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const exports =
      typeof manifest.exports === "string" ||
      !Object.keys(manifest.exports).some((key) => key.startsWith("."))
        ? { ".": manifest.exports }
        : manifest.exports;
    for (const [subpath, entry] of Object.entries(exports)) {
      const types = declaration(entry);
      if (!types || subpath === "./package.json") continue;
      const specifier = `${manifest.name}${subpath === "." ? "" : subpath.slice(1)}`;
      paths[specifier] = [join(directory, types)];
    }
  }
  // Fences live in /tmp, outside pnpm's dependency tree. Resolve external RDF types from
  // an installed consumer (including @types/n3), then expose only its public entry points.
  for (const specifier of [
    "@solid/object",
    "@solid/object/acp",
    "@solid/object/solid",
    "@solid/object/webid",
    "@rdfjs/wrapper",
    "n3",
  ]) {
    for (const directory of [root, ...packages.map((name) => join(root, "packages", name))]) {
      const resolved = ts.resolveModuleName(
        specifier,
        join(directory, "example.mts"),
        {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
        },
        ts.sys,
        undefined,
        undefined,
        ts.ModuleKind.ESNext,
      ).resolvedModule;
      if (!resolved || !/\.d\.[cm]?ts$/.test(resolved.resolvedFileName)) continue;
      paths[specifier] = [resolved.resolvedFileName];
      break;
    }
  }
  const temporary = mkdtempSync(join(tmpdir(), "sdk-skill-examples-"));
  try {
    const sources = new Map();
    for (const file of files) {
      const markdown = readFileSync(file, "utf8");
      const fences = /^```(?:ts|typescript)[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*$/gm;
      for (const match of markdown.matchAll(fences)) {
        const filename = join(temporary, `example-${sources.size}.mts`);
        const line = markdown.slice(0, match.index).split("\n").length + 1;
        sources.set(filename, { file, line });
        // Each fence is a module, so identical identifiers in other examples cannot interfere.
        writeFileSync(filename, `${match[1]}\nexport {};\n`);
      }
    }
    const program = ts.createProgram([...sources.keys()], {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      strict: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      skipLibCheck: true,
      types: ["node"],
      typeRoots: [join(root, "node_modules/@types")],
      paths,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      const source = diagnostic.file && sources.get(diagnostic.file.fileName);
      if (!source || diagnostic.start === undefined) return message;
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${source.file}:${source.line + position.line}:${position.character + 1}: ${message}`;
    });
    return { examples: sources.size, diagnostics };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  const result = checkExamples(files.length ? files.map((file) => resolve(file)) : undefined);
  if (result.diagnostics.length) {
    console.error(result.diagnostics.join("\n"));
    console.error("Build the documented packages and dependencies before checking their examples.");
    process.exitCode = 1;
  } else if (result.examples === 0) {
    console.error("No TypeScript examples found.");
    process.exitCode = 1;
  } else {
    console.log(`Typechecked ${result.examples} SDK skill examples against public declarations.`);
  }
}
