// AUTHORED-BY Codex GPT-6.1-Sol
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

it("confines environment access to the two Node-only VeSync credential variables", () => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const violations: string[] = [];
  const allowedReads = new Set<string>();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    const path = `${entry.parentPath}/${entry.name}`;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const envNames = new Set<string>();
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "node:process"
      )
        continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const binding of bindings.elements)
          if ((binding.propertyName ?? binding.name).text === "env")
            envNames.add(binding.name.text);
    }
    if (envNames.size && !path.endsWith("/node/vesync-auth.ts")) violations.push(path);
    function visit(node: ts.Node) {
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        node.expression.getText(source) === "process"
      )
        violations.push(path);
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        envNames.has(node.expression.getText(source))
      ) {
        const key = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : node.argumentExpression && ts.isStringLiteral(node.argumentExpression)
            ? node.argumentExpression.text
            : "";
        if (key === "VESYNC_EMAIL" || key === "VESYNC_PASSWORD") allowedReads.add(key);
        else violations.push(path);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
  expect([...allowedReads].sort()).toEqual(["VESYNC_EMAIL", "VESYNC_PASSWORD"]);
});
