// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";

it.each([
  ["../src/app/(suite)/contacts/c/[ref]/page.tsx", "ref"],
  ["../src/app/(suite)/contacts/c/[ref]/edit/page.tsx", "ref"],
  ["../src/app/(suite)/contacts/label/[group]/page.tsx", "group"],
  ["../src/app/(suite)/drive/f/[ref]/page.tsx", "ref"],
  ["../src/app/(suite)/docs/d/[ref]/page.tsx", "ref"],
  ["../src/app/(suite)/drive/p/[ref]/page.tsx", "ref"],
  ["../src/app/(suite)/chat/r/[ref]/page.tsx", "ref"],
  ["../src/app/(suite)/mail/[folder]/page.tsx", "folder"],
  ["../src/app/(suite)/mail/t/[ref]/page.tsx", "ref"],
  ["../src/app/(suite)/money/a/[ref]/page.tsx", "ref"],
  ["../src/app/(suite)/photos/a/[ref]/page.tsx", "ref"],
  ["../src/app/(suite)/photos/p/[ref]/page.tsx", "ref"],
  ["../src/app/(suite)/home/[domain]/page.tsx", "domain"],
  ["../src/app/(suite)/home/[domain]/i/[ref]/page.tsx", ["domain", "ref"]],
  ["../src/app/(suite)/permissions/a/[agentRef]/page.tsx", "agentRef"],
  ["../src/app/dev/components/[component]/page.tsx", "component"],
] as const)("keeps %s on demand on web and exports one native placeholder", (path, keys) => {
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
    const placeholder = Object.fromEntries([keys].flat().map((key) => [key, "__"]));
    expect(params).toEqual(target === "native" ? [placeholder] : []);
  }
});

it("keeps the web calendar view on demand (native staging replaces the file)", () => {
  const web = readFileSync(
    new URL("../src/app/(suite)/calendar/[view]/page.tsx", import.meta.url),
    "utf8",
  );
  // native-calendar-staging.test.mjs covers the staged placeholder page.
  expect(web).toMatch(/export const dynamicParams = true;/);
  expect(web).toMatch(/generateStaticParams\(\) \{\s*return \[\];/);
});
