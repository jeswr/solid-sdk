#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";
import {
  isRecord,
  parseSource,
  readBaseline,
  sourceFiles,
  sourceTokens,
  writeBaseline,
} from "./code-quality.mjs";

const baselineName = "rdf-discipline-baseline.json";
const rules = new Set(["rdf-factory", "rdf-store-mutation", "rdf-literal"]);
const factoryModules = new Set(["n3", "@rdfjs/data-model", "rdf-data-factory"]);
const factoryMethods = new Set(["quad", "triple"]);
const mutationMethods = new Set(["addQuad", "addQuads", "removeQuad"]);

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
}

// Read actual comment trivia from the parsed tree. A string, regex, JSX text or
// template containing "// rdf-discipline-allow:" cannot manufacture an escape.
function allowances(source) {
  const allowed = new Set();
  const problems = [];
  for (const token of sourceTokens(source)) {
    if (token.kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
    const text = source.text.slice(token.start, token.end);
    const match = /^\/\/\s*rdf-discipline-allow:\s*(.*)$/.exec(text);
    if (!match) continue;
    const line = source.getLineAndCharacterOfPosition(token.start).line + 1;
    if (match[1].trim()) allowed.add(line);
    else
      problems.push(`${source.fileName}:${line} rdf-discipline-allow requires a non-empty reason`);
  }
  return { allowed, problems };
}

function literalText(node) {
  if (ts.isStringLiteralLike(node))
    return { text: node.text, template: ts.isNoSubstitutionTemplateLiteral(node) };
  if (ts.isTemplateExpression(node)) {
    // Inspect only literal parts, never interpolation source code. The marker
    // preserves the requested <${...}> < pattern across template spans.
    return {
      text:
        node.head.text + node.templateSpans.map((span) => `\uFFFC${span.literal.text}`).join(""),
      template: true,
    };
  }
}

function buildsRdf({ text, template }) {
  return (
    /\b(?:INSERT|DELETE)\s+DATA\b/i.test(text) ||
    (/\b(?:DELETE|INSERT)\s*\{/i.test(text) && /\bWHERE\b/i.test(text)) ||
    /@prefix\b/i.test(text) ||
    (template && /<\uFFFC>\s*<|>\s*<https?:|>\s+a\s+</i.test(text))
  );
}

export function scanRdfDiscipline(root) {
  const files = sourceFiles(root);
  const violations = [];
  const problems = [];
  const counts = {};
  let allowed = 0;
  for (const { path } of files) {
    const source = parseSource(root, path);
    const escapes = allowances(source);
    allowed += escapes.allowed.size;
    problems.push(...escapes.problems);
    // Imported aliases and destructured aliases retain the factory operation.
    const factoryCalls = new Set();
    function collect(node) {
      if (ts.isImportDeclaration(node) && factoryModules.has(node.moduleSpecifier.text)) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const entry of bindings.elements) {
            if (factoryMethods.has((entry.propertyName ?? entry.name).text))
              factoryCalls.add(entry.name.text);
          }
        }
      }
      if (
        ts.isBindingElement(node) &&
        ts.isIdentifier(node.name) &&
        factoryMethods.has((node.propertyName ?? node.name).text)
      ) {
        factoryCalls.add(node.name.text);
      }
      ts.forEachChild(node, collect);
    }
    collect(source);
    function report(node, rule) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (escapes.allowed.has(line)) return;
      violations.push({ path, line, rule });
      counts[path] ??= {};
      counts[path][rule] = (counts[path][rule] ?? 0) + 1;
    }
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const name = memberName(node.expression);
        const location = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name
          : ts.isElementAccessExpression(node.expression)
            ? node.expression.argumentExpression
            : node.expression;
        if (
          factoryMethods.has(name) ||
          (ts.isIdentifier(node.expression) && factoryCalls.has(node.expression.text))
        ) {
          report(location, "rdf-factory");
        }
        if (mutationMethods.has(name)) report(location, "rdf-store-mutation");
      }
      const literal = literalText(node);
      if (literal && buildsRdf(literal)) report(node, "rdf-literal");
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const path of Object.keys(counts))
    counts[path] = Object.fromEntries(Object.entries(counts[path]).sort());
  return { files: files.length, violations, counts, allowed, problems };
}

export function checkRdfDiscipline(root, updateBaseline = false) {
  const result = scanRdfDiscipline(root);
  if (updateBaseline) {
    if (!result.problems.length) writeBaseline(root, baselineName, result.counts);
    return result;
  }
  const baseline = readBaseline(root, baselineName) ?? {};
  if (
    !isRecord(baseline) ||
    Object.values(baseline).some(
      (entry) =>
        !isRecord(entry) ||
        !Object.keys(entry).length ||
        Object.entries(entry).some(
          ([rule, count]) => !rules.has(rule) || !Number.isSafeInteger(count) || count <= 0,
        ),
    )
  ) {
    throw new Error(
      `Invalid scripts/${baselineName}; run pnpm run check:rdf-discipline --update-baseline`,
    );
  }
  for (const path of new Set([...Object.keys(baseline), ...Object.keys(result.counts)])) {
    for (const rule of rules) {
      const before = baseline[path]?.[rule] ?? 0;
      const now = result.counts[path]?.[rule] ?? 0;
      if (now > before) {
        for (const violation of result.violations.filter(
          (v) => v.path === path && v.rule === rule,
        )) {
          result.problems.push(`${path}:${violation.line} ${rule} (${now} > baseline ${before})`);
        }
      } else if (now < before) {
        result.problems.push(
          `${path} ${rule}: stale baseline (${before} -> ${now}); run pnpm run check:rdf-discipline --update-baseline`,
        );
      }
    }
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { root: { type: "string" }, "update-baseline": { type: "boolean", default: false } },
    });
    const result = checkRdfDiscipline(
      resolve(values.root ?? fileURLToPath(new URL("..", import.meta.url))),
      values["update-baseline"],
    );
    for (const problem of result.problems) console.error(problem);
    console.log(
      `RDF discipline: ${result.files} files scanned, ${result.violations.length} violations in ${Object.keys(result.counts).length} files, ${result.allowed} allow-comment(s).${values["update-baseline"] && !result.problems.length ? " Baseline updated." : ""}`,
    );
    if (result.problems.length) process.exitCode = 1;
  } catch (error) {
    console.error(`RDF discipline guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
