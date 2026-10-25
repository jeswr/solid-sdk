// AUTHORED-BY Codex GPT-6.1-Sol

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { scanColours, scanDirectory } from "../scripts/check-tokens.mjs";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/token-scanner/${name}`, import.meta.url), "utf8");
test("scanner ignores comments, retains literals inside quoted CSS/JS and URLs", () => {
  expect(scanColours(fixture("valid.tsx"), ".tsx")).toEqual([]);
  expect(scanColours(fixture("invalid.css")).map((x) => x.literal)).toEqual([
    "#ffffff",
    "oklch(",
    "rgb(",
    "hsl(",
  ]);
  expect(scanColours('const x = "#abc"; const y = `rgba(1,2,3,.5)`; // #123')).toHaveLength(2);
  expect(scanColours('<!-- #abc -->\n<div style="color: #abcd"/>', ".html")).toEqual([
    { literal: "#abcd", line: 2 },
  ]);
  expect(
    scanDirectory(fileURLToPath(new URL("./fixtures/token-scanner", import.meta.url))),
  ).toHaveLength(4);
});

test.each([
  '<><p>https://example.test</p><div style={{ color: "#fff" }} /></>',
  '<><p>// /* JSX text */</p><div style={{ color: "#fff" }} /></>',
  'const url = "https://example.test"; const colour = "#fff";',
  "const url = 'https://example.test'; const colour = '#fff';",
  'const url = `https://example.test`; const colour = "#fff";',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Test source includes a template expression.
  'const url = `https://${host}/path`; const colour = "#fff";',
  'const pattern = /[//]/; const colour = "#fff";',
  'const pattern = /https?:\\/\\//; const colour = "#fff";',
])("script literals and JSX cannot hide same-line raw colours: %s", (source) => {
  expect(scanColours(source, ".tsx")).toEqual([{ literal: "#fff", line: 1 }]);
});

test("only real script comments are blanked, preserving line numbers", () => {
  const source = [
    "// #abc rgb(1 2 3)",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Test source includes template trivia.
    "const template = `https://${/* #123 */ host /* #456 */}/#fff`; // #def",
    "const jsx = <p>{/* #789 */}https://example.test</p>; /* #abc */",
    'const pattern = /[//]/; /* #abc */ const colour = "#123";',
    "/* #abc",
    "oklch(1 0 0) */",
  ].join("\n");
  expect(scanColours(source, ".tsx")).toEqual([
    { literal: "#fff", line: 2 },
    { literal: "#123", line: 4 },
  ]);
});

test("CSS URLs cannot hide subsequent literals behind false line comments", () => {
  expect(
    scanColours("a { background: url(https://example.test/image); color: #fff; }", ".css"),
  ).toEqual([{ literal: "#fff", line: 1 }]);
  expect(scanColours('<!-- #abc -->\n<svg fill="#fff"/>', ".svg")).toEqual([
    { literal: "#fff", line: 2 },
  ]);
});
