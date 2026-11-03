#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
];
const defaultSkills = [
  ...packages.map((name) => `packages/${name}/SKILL.md`),
  "skills/lws-vs-solid/SKILL.md",
  "skills/solid-notifications/SKILL.md",
  "skills/solid-reactive-authentication/SKILL.md",
];

/** Check independent TS fences against built public exports, without running examples. */
export function checkExamples(files = defaultSkills.map((file) => join(root, file))) {
  const paths = {};
  for (const name of packages) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      const specifier = `${manifest.name}${subpath === "." ? "" : subpath.slice(1)}`;
      paths[specifier] = [join(directory, entry.types)];
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
