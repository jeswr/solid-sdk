// AUTHORED-BY Codex GPT-6.1-Sol
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function attrValue(attr: ts.JsxAttribute): string | undefined {
  const value = attr.initializer;
  if (value && ts.isStringLiteral(value)) return value.text;
  if (
    value &&
    ts.isJsxExpression(value) &&
    value.expression &&
    ts.isStringLiteral(value.expression)
  )
    return value.expression.text;
  return undefined;
}
function opening(node: ts.Node) {
  return ts.isJsxElement(node)
    ? node.openingElement
    : ts.isJsxSelfClosingElement(node)
      ? node
      : undefined;
}
/** Parse JSX, including expression-valued sizes and aliased imports, without regex gaps. */
function iconButtonIssues(source: string): string[] {
  const file = ts.createSourceFile(
    "fixture.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const buttonNames = new Set(["Button"]);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements) {
        if ((item.propertyName ?? item.name).text === "Button") buttonNames.add(item.name.text);
      }
  }
  const issues: string[] = [];
  function visit(node: ts.Node, ancestors: ts.JsxElement[]) {
    const element = opening(node);
    if (
      element &&
      (buttonNames.has(element.tagName.getText(file)) ||
        element.tagName.getText(file).endsWith(".Button"))
    ) {
      const attrs = element.attributes.properties.filter(ts.isJsxAttribute);
      const size = attrs.find((attr) => attr.name.getText(file) === "size");
      if (size && attrValue(size)?.startsWith("icon")) {
        const name = attrs.find((attr) =>
          ["aria-label", "aria-labelledby"].includes(attr.name.getText(file)),
        );
        const hasName =
          name &&
          (attrValue(name)?.trim() ||
            (name.initializer &&
              ts.isJsxExpression(name.initializer) &&
              name.initializer.expression &&
              ![ts.SyntaxKind.NullKeyword, ts.SyntaxKind.FalseKeyword].includes(
                name.initializer.expression.kind,
              ) &&
              name.initializer.expression.getText(file) !== "undefined"));
        if (!hasName) issues.push("Icon Button requires an accessible name");
        const tooltip = ancestors.find((parent) =>
          /(?:^|\.)Tooltip$/.test(parent.openingElement.tagName.getText(file)),
        );
        const trigger = ancestors.some((parent) =>
          /(?:^|\.)TooltipTrigger$/.test(parent.openingElement.tagName.getText(file)),
        );
        let hasContent = false;
        if (tooltip) {
          const walk = (child: ts.Node) => {
            if (opening(child)?.tagName.getText(file).endsWith("TooltipContent")) hasContent = true;
            ts.forEachChild(child, walk);
          };
          walk(tooltip);
        }
        if (!trigger || !hasContent)
          issues.push("Icon Button requires a Tooltip trigger and content");
      }
    }
    const parents = ts.isJsxElement(node) ? [...ancestors, node] : ancestors;
    ts.forEachChild(node, (child) => visit(child, parents));
  }
  visit(file, []);
  return issues;
}
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : entry.name.endsWith(".tsx") ? [path] : [];
  });
}
describe("icon-only button lint", () => {
  it.each([
    '<Button size="icon" />',
    '<Button size={"icon-sm"} aria-label="" />',
    '<UI.Button size="icon" aria-label="More" />',
    'import { Button as B } from "@jeswr/suite-ui"; const x = <B size="icon" />',
  ])("rejects missing name or tooltip: %s", (source) =>
    expect(iconButtonIssues(source).length).toBeGreaterThan(0));
  it("accepts names paired with a tooltip", () =>
    expect(
      iconButtonIssues(
        '<Tooltip><TooltipTrigger asChild><Button size="icon" aria-label="More" /></TooltipTrigger><TooltipContent>More</TooltipContent></Tooltip>',
      ),
    ).toEqual([]));
  it("enforces the rule throughout suite-ui and apps/suite", () => {
    const files = [
      ...sources(fileURLToPath(new URL("../src", import.meta.url))),
      ...sources(fileURLToPath(new URL("../../../apps/suite/src", import.meta.url))),
    ];
    expect(files.length).toBeGreaterThan(35);
    expect(
      files.flatMap((file) =>
        iconButtonIssues(readFileSync(file, "utf8")).map((issue) => `${file}: ${issue}`),
      ),
    ).toEqual([]);
  });
});
