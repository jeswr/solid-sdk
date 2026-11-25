// AUTHORED-BY Claude Sonnet 5.5
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regression guard: some bundler import-analysis lexers (Vite's, used when a consuming app is
 * built) decide between "regex" and "division" for a `/` from the preceding token, and misparse
 * a regex literal written inline in an expression (`if (/.../.test(x))`, `!/.../.test(x)`,
 * `|| /.../.test(x)`). The emitted JS then fails to parse. Every regex literal in this package
 * must therefore be the initializer of a named module-level `const`, where the preceding token
 * is always `=`. The check is over the TypeScript AST of each source file, so it also holds for
 * the emitted JavaScript (tsc keeps literals and their position verbatim).
 */
const SRC = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(SRC).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

function offending(source: string): string[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.ESNext, true);
  const bad: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node)) {
      const parent = node.parent;
      const hoisted =
        ts.isVariableDeclaration(parent) &&
        parent.initializer === node &&
        ts.isIdentifier(parent.name) &&
        ts.isVariableDeclarationList(parent.parent) &&
        (parent.parent.flags & ts.NodeFlags.Const) !== 0 &&
        ts.isVariableStatement(parent.parent.parent) &&
        ts.isSourceFile(parent.parent.parent.parent);
      if (!hoisted) bad.push(node.getText(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return bad;
}

describe("regex literal placement (bundler lexer safety)", () => {
  it("finds the source files", () => {
    expect(files).toContain("lws.ts");
    expect(files).toContain("common.ts");
  });

  it.each(files)("%s has no inline regex literal", (name) => {
    expect(offending(readFileSync(join(SRC, name), "utf8"))).toEqual([]);
  });

  it("detects inline literals after parentheses, negation and operators", () => {
    expect(offending("if (/a/u.test(x)) {}")).toEqual(["/a/u"]);
    expect(offending("const y = !/a/.test(x);")).toEqual(["/a/"]);
    expect(offending("const y = a || /a/i.test(x);")).toEqual(["/a/i"]);
    expect(offending("function f() { const r = /a/; }")).toEqual(["/a/"]);
    expect(offending("let r = /a/;")).toEqual(["/a/"]);
    expect(offending("const { r } = { r: /a/ };")).toEqual(["/a/"]);
  });

  it("accepts a hoisted module-level const", () => {
    expect(
      offending("const A_PATTERN = /a/u;\nexport function f(x) { return A_PATTERN.test(x); }"),
    ).toEqual([]);
  });
});
