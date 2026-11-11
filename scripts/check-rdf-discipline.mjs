#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";
import {
  compareText,
  isRecord,
  parseSource,
  readBaseline,
  sourceFiles,
  sourceTokens,
  writeBaseline,
} from "./code-quality.mjs";

const baselineName = "rdf-discipline-baseline.json";
const allowRule = "rdf-discipline-allow";
// Accept the retired mutation rule in old baselines so it can shrink away.
const rules = ["rdf-factory", "rdf-literal", allowRule, "rdf-store-mutation"].sort(compareText);
const factoryModules = new Set(["n3", "@rdfjs/data-model", "rdf-data-factory"]);
const factoryMethods = new Set(["quad", "triple"]);
const factoryConstructors = new Set(["Quad", "Triple"]);
const interpolation = "\uFFFC";
const shrinkNote = "baseline can shrink: run --update-baseline";

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
}

// Read actual comment trivia, never text inside a string, regex, JSX or template.
function allowances(source) {
  const allowed = new Set();
  const problems = [];
  for (const token of sourceTokens(source)) {
    if (token.kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
    const match = /^\/\/\s*rdf-discipline-allow:\s*(.*)$/.exec(
      source.text.slice(token.start, token.end),
    );
    if (!match) continue;
    const line = source.getLineAndCharacterOfPosition(token.start).line + 1;
    if (match[1].trim()) allowed.add(line);
    else
      problems.push(`${source.fileName}:${line} rdf-discipline-allow requires a non-empty reason`);
  }
  return { allowed, problems };
}

// Fold only visible string-building syntax. Unknown values become opaque markers;
// their source text cannot accidentally manufacture an RDF match.
function literalText(node, folded) {
  let text;
  if (ts.isParenthesizedExpression(node)) text = literalText(node.expression, folded);
  else if (ts.isStringLiteralLike(node)) text = node.text;
  else if (ts.isTemplateExpression(node)) {
    text =
      node.head.text +
      node.templateSpans.map((span) => `${interpolation}${span.literal.text}`).join("");
  } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalText(node.left, folded);
    const right = literalText(node.right, folded);
    if (left !== undefined || right !== undefined) {
      text = (left ?? interpolation) + (right ?? interpolation);
    }
  } else if (ts.isCallExpression(node) && memberName(node.expression) === "join") {
    let receiver = node.expression.expression;
    while (ts.isParenthesizedExpression(receiver)) receiver = receiver.expression;
    const separator = node.arguments.length ? literalText(node.arguments[0], folded) : ",";
    if (ts.isArrayLiteralExpression(receiver) && separator !== undefined) {
      text = receiver.elements
        .map((element) => literalText(element, folded) ?? interpolation)
        .join(separator);
    }
  }
  if (text !== undefined) folded.add(node);
  return text;
}

function isFactoryRequire(node) {
  return (
    node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "require" &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    factoryModules.has(node.arguments[0].text)
  );
}

function buildsRdf(text) {
  return (
    /\b(?:INSERT|DELETE)(?:\s+DATA)?\s*\{/.test(text) ||
    /(?:@prefix|\bPREFIX)\s+(?:[A-Za-z][\w-]*)?:\s*<[^<>\s]+>/.test(text) ||
    /<(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/[^<>\s]+|\uFFFC|\$\{[^}]+\})>\s+(?:<|a\s)/.test(text) ||
    /<[^<>\s]+>\s+(?:a\s+)?<[A-Za-z][A-Za-z0-9+.-]*:\/\/[^<>\s]+>/.test(text)
  );
}

export function scanRdfDiscipline(root) {
  const { files, skippedSrcPaths } = sourceFiles(root);
  const violations = [];
  const problems = [];
  const counts = {};
  let allowed = 0;
  for (const { path } of files) {
    const source = parseSource(root, path);
    const escapes = allowances(source);
    const used = new Set();
    allowed += escapes.allowed.size;
    problems.push(...escapes.problems);
    if (escapes.allowed.size) counts[path] = { [allowRule]: escapes.allowed.size };
    const factoryCalls = new Set();
    const constructors = new Set();
    const namespaces = new Set();
    const folded = new Set();
    function collect(node) {
      if (ts.isImportDeclaration(node) && factoryModules.has(node.moduleSpecifier.text)) {
        const clause = node.importClause;
        if (clause?.name) namespaces.add(clause.name.text);
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const entry of bindings.elements) {
            const name = (entry.propertyName ?? entry.name).text;
            if (factoryMethods.has(name)) factoryCalls.add(entry.name.text);
            if (factoryConstructors.has(name)) constructors.add(entry.name.text);
          }
        }
      }
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        factoryModules.has(node.moduleReference.expression?.text)
      )
        namespaces.add(node.name.text);
      if (
        ts.isVariableDeclaration(node) &&
        isFactoryRequire(node.initializer) &&
        ts.isIdentifier(node.name)
      )
        namespaces.add(node.name.text);
      if (
        ts.isBindingElement(node) &&
        ts.isIdentifier(node.name) &&
        factoryMethods.has((node.propertyName ?? node.name).text)
      ) {
        factoryCalls.add(node.name.text);
      }
      if (
        ts.isBindingElement(node) &&
        ts.isIdentifier(node.name) &&
        factoryConstructors.has((node.propertyName ?? node.name).text) &&
        ts.isVariableDeclaration(node.parent.parent)
      ) {
        const initializer = node.parent.parent.initializer;
        if (
          isFactoryRequire(initializer) ||
          (initializer && ts.isIdentifier(initializer) && namespaces.has(initializer.text))
        )
          constructors.add(node.name.text);
      }
      ts.forEachChild(node, collect);
    }
    collect(source);
    function report(node, rule) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (escapes.allowed.has(line)) {
        used.add(line);
        return;
      }
      violations.push({ path, line, rule });
      counts[path] ??= {};
      counts[path][rule] = (counts[path][rule] ?? 0) + 1;
    }
    function visit(node) {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const expression = node.expression;
        const name = memberName(expression);
        const location = ts.isPropertyAccessExpression(expression)
          ? expression.name
          : ts.isElementAccessExpression(expression)
            ? expression.argumentExpression
            : expression;
        if (
          ts.isCallExpression(node)
            ? factoryMethods.has(name) ||
              (ts.isIdentifier(expression) && factoryCalls.has(expression.text))
            : (ts.isIdentifier(expression) && constructors.has(expression.text)) ||
              (factoryConstructors.has(name) &&
                ts.isIdentifier(expression.expression) &&
                namespaces.has(expression.expression.text))
        ) {
          report(location, "rdf-factory");
        }
        // Store/Writer methods accepting existing quads are legitimate operations.
        // Inline construction is covered by rdf-factory / rdf-literal below.
      }
      const text = folded.has(node) ? undefined : literalText(node, folded);
      if (text !== undefined && buildsRdf(text)) report(node, "rdf-literal");
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const line of escapes.allowed) {
      if (!used.has(line))
        problems.push(`${path}:${line} unused rdf-discipline-allow (no violation on this line)`);
    }
  }
  for (const path of Object.keys(counts))
    counts[path] = Object.fromEntries(
      Object.entries(counts[path]).sort(([a], [b]) => compareText(a, b)),
    );
  return { files: files.length, skippedSrcPaths, violations, counts, allowed, problems, notes: [] };
}

export function checkRdfDiscipline(root, { updateBaseline = false, acceptNew = false } = {}) {
  const result = scanRdfDiscipline(root);
  const baseline = readBaseline(root, baselineName) ?? {};
  if (
    !isRecord(baseline) ||
    Object.values(baseline).some(
      (entry) =>
        !isRecord(entry) ||
        !Object.keys(entry).length ||
        Object.entries(entry).some(
          ([rule, count]) => !rules.includes(rule) || !Number.isSafeInteger(count) || count <= 0,
        ),
    )
  ) {
    throw new Error(`Invalid scripts/${baselineName}`);
  }
  // Pair whole, equal rule-count vectors one-to-one. A source path must lose all
  // its debt before it can donate a move allowance; copying never qualifies.
  const moved = new Map();
  const donors = Object.keys(baseline)
    .filter((path) => !result.counts[path])
    .sort(compareText);
  for (const path of Object.keys(result.counts)
    .filter((path) => !baseline[path])
    .sort(compareText)) {
    const index = donors.findIndex((old) =>
      rules.every((rule) => (baseline[old][rule] ?? 0) === (result.counts[path][rule] ?? 0)),
    );
    if (index >= 0) {
      const [old] = donors.splice(index, 1);
      moved.set(path, old);
      result.notes.push(`RDF baseline moved: ${old} -> ${path}; ${shrinkNote}`);
    }
  }
  const movedFrom = new Set(moved.values());
  const accepted = [];
  const paths = [...new Set([...Object.keys(baseline), ...Object.keys(result.counts)])].sort(
    compareText,
  );
  for (const path of paths) {
    if (movedFrom.has(path)) continue;
    for (const rule of rules) {
      const before = baseline[moved.get(path) ?? path]?.[rule] ?? 0;
      const now = result.counts[path]?.[rule] ?? 0;
      if (now > before) {
        const increase = `${path} ${rule} (${now} > baseline ${before})`;
        if (updateBaseline && acceptNew) accepted.push(`Accepted increase: ${increase}`);
        else {
          const lines = result.violations.filter((v) => v.path === path && v.rule === rule);
          result.problems.push(
            `${increase}${lines.length ? ` at line(s) ${lines.map((v) => v.line).join(", ")}` : ""}; accepting new debt requires --update-baseline --accept-new`,
          );
        }
      } else if (now < before) {
        result.notes.push(`${path} ${rule}: ${before} -> ${now}; ${shrinkNote}`);
      }
    }
  }
  if (updateBaseline && !result.problems.length) {
    writeBaseline(root, baselineName, result.counts);
    result.notes.push(...accepted);
    result.updated = true;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        root: { type: "string" },
        "update-baseline": { type: "boolean", default: false },
        "accept-new": { type: "boolean", default: false },
      },
    });
    const result = checkRdfDiscipline(
      resolve(values.root ?? fileURLToPath(new URL("..", import.meta.url))),
      { updateBaseline: values["update-baseline"], acceptNew: values["accept-new"] },
    );
    for (const problem of result.problems) console.error(problem);
    for (const note of result.notes) console.log(note);
    console.log(
      `RDF discipline: ${result.files} files scanned, ${result.violations.length} violations in ${Object.keys(result.counts).length} baseline files, ${result.allowed} allow-comment(s), ${result.skippedSrcPaths} skipped src/ paths.${result.updated ? " Baseline updated." : ""}`,
    );
    if (result.problems.length) process.exitCode = 1;
  } catch (error) {
    console.error(`RDF discipline guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
