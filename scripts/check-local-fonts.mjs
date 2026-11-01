#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
import { globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";

export function importsGoogleFonts(source, path) {
  if (!source.includes("next/font/google")) return false;
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let found = false;
  function visit(node) {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isExternalModuleReference(node)
          ? node.expression
          : ts.isCallExpression(node) &&
              (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require"))
            ? node.arguments[0]
            : undefined;
    if (
      specifier &&
      ts.isStringLiteralLike(specifier) &&
      /^next\/font\/google(?:\/|$)/.test(specifier.text)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

export function checkLocalFonts(root) {
  const files = globSync(["packages/**/*", "apps/**/*"], {
    cwd: root,
    exclude: (entry) =>
      /(?:^|\/)(?:node_modules|dist|out|build|coverage|\.next|\.turbo|\.git)(?:\/|$)/.test(entry),
  });
  const forbidden = [];
  for (const path of files) {
    if (!/\.(?:[cm]?[jt]sx?|mdx)$/.test(path)) continue;
    if (importsGoogleFonts(readFileSync(join(root, path), "utf8"), path)) {
      forbidden.push(path);
    }
  }
  return forbidden.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const root = resolve(values.root ?? fileURLToPath(new URL("../", import.meta.url)));
  const forbidden = checkLocalFonts(root);
  if (forbidden.length) {
    console.error(
      "Google font imports require network access; vendor fonts and use next/font/local:",
    );
    for (const path of forbidden) console.error(`  ${path}`);
    process.exitCode = 1;
  } else {
    console.log("Local font guard passed (packages and apps, including templates).");
  }
}
