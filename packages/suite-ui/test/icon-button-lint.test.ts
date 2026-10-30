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
function iconButtonIssues(source: string, includeNativeControls = false): string[] {
  const file = ts.createSourceFile(
    "fixture.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const buttonNames = new Set(["Button"]);
  const iconButtonNames = new Set(["IconButton"]);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements) {
        if ((item.propertyName ?? item.name).text === "Button") buttonNames.add(item.name.text);
        if ((item.propertyName ?? item.name).text === "IconButton")
          iconButtonNames.add(item.name.text);
      }
  }
  const issues: string[] = [];
  function hasVisibleText(node: ts.Node): boolean {
    if (ts.isJsxText(node)) return Boolean(node.text.trim());
    if (ts.isJsxExpression(node)) return Boolean(node.expression);
    const element = opening(node);
    if (!element || !ts.isJsxElement(node)) return false;
    const tag = element.tagName.getText(file);
    const hidden = element.attributes.properties
      .filter(ts.isJsxAttribute)
      .some((attr) => attr.name.getText(file) === "aria-hidden" && attrValue(attr) === "true");
    if (hidden || tag === "svg" || /^[A-Z]/.test(tag)) return false;
    return node.children.some(hasVisibleText);
  }
  function visit(node: ts.Node, ancestors: ts.JsxElement[]) {
    const element = opening(node);
    if (element) {
      const tag = element.tagName.getText(file);
      const attrs = element.attributes.properties.filter(ts.isJsxAttribute);
      const size = attrs.find((attr) => attr.name.getText(file) === "size");
      const className = attrs.find((attr) => attr.name.getText(file) === "className");
      const slot = attrs.find((attr) => attr.name.getText(file) === "data-slot");
      const native =
        includeNativeControls &&
        (["button", "a"].includes(tag) || tag.endsWith(".Close")) &&
        !attrs.some((attr) => attr.name.getText(file) === "asChild") &&
        ((slot &&
          /^(?:app-launcher-trigger|navigation-icon-button|customise-rail-drag|top-bar-.*-toggle|details-pane-close|shell-sheet-close)$/.test(
            attrValue(slot) ?? "",
          )) ||
          /\bsuite-(?:rail-button|icon-button|shell-icon-button|drag)\b/.test(
            className ? (attrValue(className) ?? "") : "",
          ) ||
          (ts.isJsxElement(node) && !node.children.some(hasVisibleText)));
      const iconButton = iconButtonNames.has(tag) || tag.endsWith(".IconButton");
      if (
        iconButton ||
        native ||
        ((buttonNames.has(tag) || tag.endsWith(".Button")) &&
          size &&
          attrValue(size)?.startsWith("icon"))
      ) {
        const name = attrs.find((attr) =>
          (iconButton ? ["label"] : ["aria-label", "aria-labelledby"]).includes(
            attr.name.getText(file),
          ),
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
        if (iconButton) return;
        const tooltip = [...ancestors]
          .reverse()
          .find((parent) => /(?:^|\.)Tooltip$/.test(parent.openingElement.tagName.getText(file)));
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
  it.each([
    '<button aria-label="Close apps" title="Close apps"><X /></button>',
    '<a href="/drive" aria-label="Drive" title="Drive"><AppGlyph /></a>',
    '<Dialog.Close aria-label="Close details" title="Close"><X /></Dialog.Close>',
    '<button className="suite-drag" aria-label="Drag Home" title="Drag Home" aria-hidden="true" tabIndex={-1}><GripVertical /></button>',
    '<button data-slot="app-launcher-trigger" aria-label="Apps" title="Apps"><Grid />{trigger === "button" && <span>Apps</span>}</button>',
    '<Tooltip><TooltipTrigger asChild><button aria-label="Back"><ArrowLeft /></button></TooltipTrigger></Tooltip>',
  ])("rejects title-only navigation/shell controls: %s", (source) =>
    expect(iconButtonIssues(source, true)).toContain(
      "Icon Button requires a Tooltip trigger and content",
    ));
  it.each([
    '<IconButton label="Close apps"><X /></IconButton>',
    'import { IconButton as I } from "../components/ui/icon-button.js"; const x = <I label="Close apps"><X /></I>',
    '<Tooltip><TooltipTrigger asChild><a href="/drive" aria-label="Drive"><AppGlyph /></a></TooltipTrigger><TooltipContent>Drive</TooltipContent></Tooltip>',
    "<button><Plus /><span>Create</span></button>",
    '<a href="/drive"><AppGlyph />{app.name}</a>',
  ])("accepts tooltips or visible text: %s", (source) =>
    expect(iconButtonIssues(source, true)).toEqual([]));
  it("rejects an IconButton without a nonempty label", () => {
    expect(iconButtonIssues('<IconButton label=""><X /></IconButton>', true)).toContain(
      "Icon Button requires an accessible name",
    );
  });
  it.each(["navigation", "shell"])("guards native icon-only controls in %s", (directory) => {
    const files = sources(fileURLToPath(new URL(`../src/${directory}`, import.meta.url)));
    expect(files.length).toBeGreaterThan(0);
    expect(
      files.flatMap((file) =>
        iconButtonIssues(readFileSync(file, "utf8"), true).map((issue) => `${file}: ${issue}`),
      ),
    ).toEqual([]);
  });
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
