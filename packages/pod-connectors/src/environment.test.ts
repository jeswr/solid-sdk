// AUTHORED-BY Codex GPT-6.1-Sol
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps environment reads confined to the CLI's explicit connector vault key", () => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const violations: string[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    const path = `${entry.parentPath}/${entry.name}`;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const envAliases = new Set<string>();
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "node:process"
      )
        continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          if ((binding.propertyName?.text ?? binding.name.text) === "env")
            envAliases.add(binding.name.text);
        }
      }
    }
    function visit(node: ts.Node) {
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        node.expression.getText(source) === "process"
      )
        violations.push(path);
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        envAliases.has(node.expression.getText(source))
      ) {
        const name = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : ts.isStringLiteral(node.argumentExpression)
            ? node.argumentExpression.text
            : undefined;
        if (!path.endsWith("/node/cli.ts") || name !== "CONNECTOR_VAULT_KEY") violations.push(path);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});
