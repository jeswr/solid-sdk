// AUTHORED-BY Codex GPT-6
// Shared source selection and baseline I/O for the code-quality ratchets.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

const excludedDirectories = new Set([
  "node_modules",
  "dist",
  "out",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".git",
  "__tests__",
  "test",
  "tests",
  "e2e",
  "fixtures",
]);

export function sourceFiles(root, includePackages = false) {
  // Reading root first prevents a mistyped --root from passing vacuously.
  readdirSync(root);
  const files = [];
  function walk(directory, project, insideSource = false) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (excludedDirectories.has(entry.name)) continue;
        if (entry.name === "generated" && directory.endsWith("/src")) continue;
        walk(path, project, insideSource || entry.name === "src");
      } else if (
        entry.isFile() &&
        insideSource &&
        /\.(?:ts|tsx|js|mjs)$/.test(entry.name) &&
        !/\.(?:test|spec)\./.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push({ path, project });
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
  return files.sort((a, b) => a.path.localeCompare(b.path, "en"));
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
  function visit(node) {
    const start = node.getStart(source);
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
    if (literals.has(start)) {
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
