#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync, readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join, relative, resolve } from "path";
import ts from "typescript";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const objectModels = new Set([
  "Message",
  "EvidenceItem",
  "ActionIntent",
  "Agreement",
  "GrantRecord",
]);
const jsonNames = new Set(["Json", "JsonObject"]);
const checkedAreas = /^(gates|mechanisms|derive|runtime)\//;

function sources(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sources(path);
    return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}

function scopeOf(node, source) {
  const names = [];
  for (let cursor = node; cursor; cursor = cursor.parent) {
    if (
      (ts.isFunctionDeclaration(cursor) ||
        ts.isMethodDeclaration(cursor) ||
        ts.isGetAccessorDeclaration(cursor) ||
        ts.isSetAccessorDeclaration(cursor) ||
        ts.isClassDeclaration(cursor) ||
        ts.isInterfaceDeclaration(cursor) ||
        ts.isTypeAliasDeclaration(cursor)) &&
      cursor.name
    )
      names.unshift(cursor.name.getText(source));
    else if (
      (ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) &&
      ts.isVariableDeclaration(cursor.parent)
    )
      names.unshift(cursor.parent.name.getText(source));
  }
  return names.join(".") || "<module>";
}

/** Mechanical migration guard. Runtime exemptions are explicit function/count bounds only. */
export function checkRdfPipeline(root = packageRoot, allowlist = {}) {
  root = resolve(root);
  const files = sources(join(root, "src"));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const findings = [];

  function hasJson(typeNode, seen = new Set()) {
    if (!typeNode) return false;
    let found = false;
    function visit(node) {
      if (found) return;
      if (ts.isTypeReferenceNode(node) || ts.isImportTypeNode(node)) {
        const name = ts.isTypeReferenceNode(node) ? node.typeName : node.qualifier;
        let symbol = name && checker.getSymbolAtLocation(name);
        if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        if (symbol && !seen.has(symbol)) {
          seen.add(symbol);
          for (const declaration of symbol.declarations ?? []) {
            const path = declaration.getSourceFile().fileName;
            if (!path.startsWith(join(root, "src"))) continue;
            if (jsonNames.has(symbol.getName()) && path.endsWith("/core/types.ts")) {
              found = true;
              return;
            }
            if (ts.isTypeAliasDeclaration(declaration) && hasJson(declaration.type, seen)) {
              found = true;
              return;
            }
          }
        }
        // Fixture/import failures still cannot hide the forbidden type's spelling.
        if (name && jsonNames.has(name.getText(node.getSourceFile()))) {
          found = true;
          return;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(typeNode);
    return found;
  }

  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const path = relative(join(root, "src"), file).replaceAll("\\", "/");
    const report = (node, rule, detail) =>
      findings.push({
        file: `src/${path}`,
        function: scopeOf(node, source),
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        rule,
        detail,
      });
    function visit(node) {
      if (
        path === "core/types.ts" &&
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
        (objectModels.has(node.name.text) || /Body$/.test(node.name.text))
      ) {
        let wrapper = false;
        if (ts.isTypeAliasDeclaration(node)) {
          const type = checker.getTypeFromTypeNode(node.type);
          const declarations = (type.aliasSymbol ?? type.getSymbol())?.declarations ?? [];
          wrapper = declarations.some((declaration) =>
            /\/src\/(?:model|generated)\//.test(declaration.getSourceFile().fileName),
          );
        }
        if (!wrapper) report(node, "object-model", `${node.name.text} must alias an RDF wrapper`);
      }
      if (
        checkedAreas.test(path) &&
        node.type &&
        (ts.isParameter(node) ||
          ts.isPropertySignature(node) ||
          ts.isPropertyDeclaration(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isMethodSignature(node) ||
          ts.isGetAccessorDeclaration(node) ||
          ts.isSetAccessorDeclaration(node) ||
          ts.isFunctionTypeNode(node) ||
          ts.isTypeAliasDeclaration(node)) &&
        hasJson(node.type)
      )
        report(node, "json-signature", "signature contains Json/JsonObject (including aliases)");
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const access = node.expression;
        if (
          access.expression.getText(source) === "JSON" &&
          access.name.text === "parse" &&
          !path.startsWith("wire/")
        ) {
          const input = node.arguments[0];
          const copy =
            input &&
            ts.isCallExpression(input) &&
            input.expression.getText(source) === "JSON.stringify";
          const localState =
            path.startsWith("store/") ||
            path === "engine/load.ts" ||
            path === "setup.ts" ||
            path === "domains/purpose-store.ts" ||
            path === "domains/scheduling.ts";
          if (!copy && !localState)
            report(node, "foreign-json-parse", "foreign bytes may be parsed only in src/wire");
        }
        if (access.name.text === "quad" && !path.startsWith("model/") && !path.startsWith("wire/"))
          report(node, "direct-quad", "construct RDF through model/wire wrappers");
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  const counts = new Map();
  const failures = [];
  for (const finding of findings) {
    const key = `${finding.file}/${finding.function}/${finding.rule}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    const allowance =
      finding.file === "src/runtime/agent.ts"
        ? (allowlist[finding.function]?.[finding.rule] ?? 0)
        : 0;
    if (count > allowance) failures.push(finding);
  }
  for (const [name, rules] of Object.entries(allowlist))
    for (const [rule, count] of Object.entries(rules)) {
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        !["json-signature", "foreign-json-parse"].includes(rule)
      )
        failures.push({
          file: "scripts/rdf-pipeline-allowlist.json",
          function: name,
          line: 1,
          rule: "invalid-allowance",
          detail: "only bounded runtime/agent.ts function allowances are accepted",
        });
    }
  return { findings, failures, exempted: findings.length - failures.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex < 0 ? packageRoot : resolve(process.argv[rootIndex + 1]);
  const allowPath = join(root, "scripts/rdf-pipeline-allowlist.json");
  const allowlist = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, "utf8")) : {};
  const result = checkRdfPipeline(root, allowlist);
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    for (const failure of result.failures)
      console.error(
        `${failure.file}:${failure.line} ${failure.function}: ${failure.rule}: ${failure.detail}`,
      );
    console.log(
      `RDF pipeline: ${result.failures.length} failures, ${result.exempted} explicit runtime allowances.`,
    );
  }
  if (result.failures.length > 0) process.exitCode = 1;
}
