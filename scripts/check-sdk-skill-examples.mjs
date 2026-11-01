#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
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

// Only ts/typescript fences are checked; tsx and other languages are intentionally excluded.
function* codeFences(source, tokens, firstLine = 1) {
  let offset = 0;
  for (const token of tokens) {
    // Locate raw blocks rather than summing their lengths: reference definitions can be omitted
    // from the token stream. Marked normalises container prefixes but preserves their newlines.
    const start = source.indexOf(token.raw, offset);
    if (start === -1) continue; // Marked can rewrite task-list paragraphs (not code blocks).
    const line = firstLine + source.slice(0, start).split("\n").length - 1;
    offset = start + token.raw.length;
    if (token.type === "code" && /^(ts|typescript)$/.test(token.lang ?? "")) {
      yield { text: token.text, line: line + 1 };
    } else if (token.type === "list") {
      yield* codeFences(token.raw, token.items, line);
    } else if (token.type === "list_item" || token.type === "blockquote") {
      yield* codeFences(token.text, token.tokens, line);
    }
  }
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
      const markdown = readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
      for (const fence of codeFences(markdown, new Marked().lexer(markdown))) {
        const filename = join(temporary, `example-${sources.size}.mts`);
        sources.set(filename, { file, line: fence.line });
        // Each fence is a module, so identical identifiers in other examples cannot interfere.
        writeFileSync(filename, `${fence.text}\nexport {};\n`);
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
