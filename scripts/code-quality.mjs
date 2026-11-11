// AUTHORED-BY Codex GPT-6
// Shared source selection and baseline I/O for the code-quality ratchets.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

const excludedDirectories = new Set([
  "dist",
  "out",
  "build",
  "coverage",
  "test",
  "tests",
  "e2e",
  "fixtures",
  "fixture",
]);
const sourceExtensions = /\.(?:[cm]?[jt]s|[jt]sx)$/;

// Compare Unicode code points, independently of the machine's locale.
export function compareText(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a.codePointAt(i);
    const right = b.codePointAt(j);
    if (left !== right) return left < right ? -1 : 1;
    i += left > 0xffff ? 2 : 1;
    j += right > 0xffff ? 2 : 1;
  }
  return i < a.length ? 1 : j < b.length ? -1 : 0;
}

export function projectForPath(path) {
  const parts = path.split("/");
  return parts.slice(0, path.startsWith("apps/suite/src/apps/") ? 5 : 2).join("/");
}

export function sourceFiles(root, includePackages = false) {
  // Reading root first prevents a mistyped --root from passing vacuously.
  readdirSync(root);
  const files = [];
  let skippedSrcPaths = 0;
  function walk(directory, project, insideSource = false, insideScripts = false) {
    const entries = readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) =>
      compareText(a.name, b.name),
    );
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (
          ["node_modules", ".git", ".next", ".turbo", "__tests__", "__fixtures__"].includes(
            entry.name,
          ) ||
          (!insideSource && excludedDirectories.has(entry.name)) ||
          (entry.name === "generated" && directory.endsWith("/src"))
        ) {
          if (insideSource) skippedSrcPaths++;
          continue;
        }
        walk(
          path,
          project,
          insideSource || entry.name === "src",
          insideScripts ||
            (directory === project && project.startsWith("apps/") && entry.name === "scripts"),
        );
      } else if (
        entry.isFile() &&
        (insideSource || insideScripts) &&
        sourceExtensions.test(entry.name)
      ) {
        if (/\.(?:test|spec)\./.test(entry.name) || /\.d\.(?:[cm]?ts)$/.test(entry.name)) {
          if (insideSource) skippedSrcPaths++;
          continue;
        }
        files.push({ path, project: projectForPath(path) });
      }
    }
  }
  for (const kind of includePackages ? ["apps", "packages"] : ["apps"]) {
    let entries;
    try {
      entries = readdirSync(join(root, kind), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(`${kind}/${entry.name}`, `${kind}/${entry.name}`);
    }
  }
  return { files: files.sort((a, b) => compareText(a.path, b.path)), skippedSrcPaths };
}

export function parseSource(root, path) {
  return ts.createSourceFile(
    path,
    readFileSync(join(root, path), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

// Preserve parser context for regexes, JSX text and template spans. A plain
// JavaScript scanner would mistake // inside JSX text for comment trivia.
// Literal contents are opaque and represented by one normalized literal token.
export function* sourceTokens(source, { skipDeclarations = false } = {}) {
  const skipped = new Map();
  const literals = new Map();
  const jsxWhitespace = new Map();
  function visit(node) {
    const start = node.getStart(source);
    if (ts.isJsxText(node) && node.containsOnlyTriviaWhiteSpaces) {
      jsxWhitespace.set(node.pos, node.end);
      return;
    }
    if (
      skipDeclarations &&
      (ts.isImportDeclaration(node) ||
        ts.isImportEqualsDeclaration(node) ||
        (ts.isExportDeclaration(node) && (node.moduleSpecifier || node.isTypeOnly)) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node))
    ) {
      skipped.set(start, node.end);
      return;
    }
    if (
      ts.isLiteralExpression(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const position = ts.isJsxText(node) ? node.pos : start;
      if (node.end > position) literals.set(position, node.end);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source.text,
  );
  while (scanner.getTextPos() < source.text.length) {
    let start = scanner.getTextPos();
    let kind;
    if (jsxWhitespace.has(start)) {
      scanner.setTextPos(jsxWhitespace.get(start));
      continue;
    } else if (literals.has(start)) {
      scanner.setTextPos(literals.get(start));
      kind = ts.SyntaxKind.StringLiteral;
    } else {
      kind = scanner.scan();
      start = scanner.getTokenPos();
      if (kind === ts.SyntaxKind.EndOfFileToken) break;
    }
    if (skipped.has(start)) {
      scanner.setTextPos(skipped.get(start));
      kind = undefined;
    }
    yield { kind, start, end: scanner.getTextPos() };
  }
}

export function readBaseline(root, name) {
  try {
    return JSON.parse(readFileSync(join(root, "scripts", name), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error(`Cannot read scripts/${name}: ${error.message}`);
  }
}

export function writeBaseline(root, name, value) {
  const path = join(root, "scripts", name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
