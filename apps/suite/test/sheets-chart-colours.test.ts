// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const globals = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const suiteTokens = readFileSync(
  new URL("../../../packages/suite-ui/src/styles/tokens.css", import.meta.url),
  "utf8",
);

it("defines all five chart colours in both themes in the stylesheet Sheets loads", () => {
  expect(globals).toContain('@import "@jeswr/suite-ui/styles/tokens.css"');
  for (const selector of [":root", ".dark"]) {
    const block = suiteTokens.slice(suiteTokens.indexOf(`${selector} {`)).split("}")[0] as string;
    for (let i = 1; i <= 5; i++) expect(block).toMatch(new RegExp(`--chart-${i}:\\s*oklch\\b`));
  }
});
