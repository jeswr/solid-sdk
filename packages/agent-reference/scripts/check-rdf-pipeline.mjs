#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
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
    return path.endsWith(".ts") && !/\.(?:d|test|spec)\.ts$/.test(path) ? [path] : [];
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

/** Mechanical migration guard. Every remaining scope has an exact count and a reason. */
export function checkRdfPipeline(root = packageRoot, allowlist = []) {
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
  const allowances = new Map();
  const ceiling = new Map();
  const statusPath = join(root, "RDF-PIPELINE-STATUS.json");
  let hasCeiling = false;
  const invalid = (name, detail, rule = "invalid-allowance") =>
    failures.push({
      file: "scripts/rdf-pipeline-allowlist.json",
      function: name,
      line: 1,
      rule,
      detail,
    });
  if (existsSync(statusPath)) {
    hasCeiling = true;
    try {
      const status = JSON.parse(readFileSync(statusPath, "utf8"));
      if (!Array.isArray(status.findings)) throw new Error("missing findings");
      for (const finding of status.findings) {
        const key = `${finding.file}/${finding.function}/${finding.rule}`;
        ceiling.set(key, (ceiling.get(key) ?? 0) + 1);
      }
    } catch {
      invalid("<module>", "RDF-PIPELINE-STATUS.json must contain the recorded finding ceiling");
    }
  }
  // The old empty file is harmless; nonempty legacy allowances lacked reasons and are refused.
  if (!Array.isArray(allowlist)) {
    if (!allowlist || typeof allowlist !== "object" || Object.keys(allowlist).length)
      invalid("<module>", "allowances must be a list of file/function/rule/count/reason entries");
    allowlist = [];
  }
  if (allowlist.length && !hasCeiling)
    invalid(
      "<module>",
      "nonempty allowances require the recorded RDF-PIPELINE-STATUS.json ceiling",
    );
  for (const entry of allowlist) {
    if (!entry || typeof entry !== "object") {
      invalid("<module>", "allowance must be an object");
      continue;
    }
    const { file, function: name, rule, count, reason } = entry;
    if (
      Object.keys(entry).some(
        (key) => !["file", "function", "rule", "count", "reason"].includes(key),
      ) ||
      typeof file !== "string" ||
      !/^src\/[a-zA-Z0-9_/-]+\.ts$/.test(file) ||
      typeof name !== "string" ||
      !name ||
      name === "<module>" ||
      name.includes("*") ||
      !["json-signature", "foreign-json-parse"].includes(rule) ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      typeof reason !== "string" ||
      reason.trim().length < 20
    ) {
      invalid(
        typeof name === "string" ? name : "<module>",
        "an allowance needs an exact source scope, supported rule, positive count and explanatory reason",
      );
      continue;
    }
    const key = `${file}/${name}/${rule}`;
    if (hasCeiling && count > (ceiling.get(key) ?? 0)) {
      invalid(name, "allowance would grow beyond the recorded file/function/rule ceiling");
      continue;
    }
    if (allowances.has(key)) invalid(name, "duplicate allowance for this file/function/rule");
    else allowances.set(key, entry);
  }
  let exempted = 0;
  for (const finding of findings) {
    const key = `${finding.file}/${finding.function}/${finding.rule}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > (allowances.get(key)?.count ?? 0)) failures.push(finding);
    else exempted++;
  }
  // Reductions must remove/shrink their allowance. A renamed function cannot leave a spare
  // exemption, and an allowance cannot reserve room for later object reads.
  for (const [key, entry] of allowances) {
    const actual = counts.get(key) ?? 0;
    if (actual < entry.count)
      invalid(
        entry.function,
        `allowance is no longer needed at this count: expected ${entry.count}, found ${actual}`,
        "stale-allowance",
      );
  }
  return { findings, failures, exempted };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex < 0 ? packageRoot : resolve(process.argv[rootIndex + 1]);
  const allowPath = join(root, "scripts/rdf-pipeline-allowlist.json");
  const allowlist = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, "utf8")) : [];
  const result = checkRdfPipeline(root, allowlist);
  // Updating the status can only shrink its per-scope ceiling: growth already failed above.
  if (process.argv.includes("--write-status") && result.failures.length === 0)
    writeFileSync(join(root, "RDF-PIPELINE-STATUS.json"), `${JSON.stringify(result, null, 2)}\n`);
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    for (const failure of result.failures)
      console.error(
        `${failure.file}:${failure.line} ${failure.function}: ${failure.rule}: ${failure.detail}`,
      );
    console.log(
      `RDF pipeline: ${result.failures.length} failures, ${result.exempted} explicit remaining violations.`,
    );
  }
  if (result.failures.length > 0) process.exitCode = 1;
}
