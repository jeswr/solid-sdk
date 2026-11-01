// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";

it.each([
  ["../src/app/(suite)/drive/f/[ref]/page.tsx", "ref"],
  ["../src/app/(suite)/drive/p/[ref]/page.tsx", "ref"],
  ["../src/app/dev/components/[component]/page.tsx", "component"],
])("keeps %s on demand on web and exports one native placeholder", (path, key) => {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  expect(text).not.toContain('"use client"');
  const generator = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "generateStaticParams",
  );
  expect(generator).toBeDefined();
  const config = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations])
    .find((node) => node.name.getText(source) === "dynamicParams");
  expect(config?.initializer?.kind).toBe(ts.SyntaxKind.TrueKeyword);
  // Evaluate the actual exported generator independently of Next's rendering environment.
  const { outputText } = ts.transpileModule(
    `${generator?.getText(source)}\ngenerateStaticParams();`,
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  );
  for (const target of ["web", "native"]) {
    const params = runInNewContext(outputText, {
      exports: {},
      process: { env: { NEXT_PUBLIC_SUITE_TARGET: target } },
    });
    expect(params).toEqual(target === "native" ? [{ [key]: "__" }] : []);
  }
});
