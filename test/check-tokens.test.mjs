// AUTHORED-BY Codex GPT-6.1-Sol

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { scanColours, scanDirectory } from "../scripts/check-tokens.mjs";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/token-scanner/${name}`, import.meta.url), "utf8");
test("scanner ignores comments, retains literals inside quoted CSS/JS and URLs", () => {
  expect(scanColours(fixture("valid.tsx"))).toEqual([]);
  expect(scanColours(fixture("invalid.css")).map((x) => x.literal)).toEqual([
    "#ffffff",
    "oklch(",
    "rgb(",
    "hsl(",
  ]);
  expect(scanColours('const x = "#abc"; const y = `rgba(1,2,3,.5)`; // #123')).toHaveLength(2);
  expect(scanColours('<!-- #abc -->\n<div style="color: #abcd"/>')).toEqual([
    { literal: "#abcd", line: 2 },
  ]);
  expect(
    scanDirectory(fileURLToPath(new URL("./fixtures/token-scanner", import.meta.url))),
  ).toHaveLength(4);
});

test("CSS URLs cannot hide subsequent literals behind false line comments", () => {
  expect(
    scanColours("a { background: url(https://example.test/image); color: #fff; }", ".css"),
  ).toEqual([{ literal: "#fff", line: 1 }]);
  expect(scanColours('<!-- #abc -->\n<svg fill="#fff"/>', ".svg")).toEqual([
    { literal: "#fff", line: 2 },
  ]);
});
