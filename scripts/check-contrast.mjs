#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { evaluateContrast } from "./contrast.mjs";
import { parseTokens } from "./token-css.mjs";

const css = readFileSync(
  new URL("../packages/suite-ui/src/styles/tokens.css", import.meta.url),
  "utf8",
);
const results = evaluateContrast(parseTokens(css));
console.table(
  results.map((row) => ({
    theme: row.theme,
    foreground: row.fg,
    background: row.bg,
    ratio: row.ratio.toFixed(3),
    minimum: row.minimum,
    status: row.status,
  })),
);
const failures = results.filter((row) => row.status === "FAIL");
console.log(`${results.length} pairs; ${failures.length} failures.`);
process.exitCode = failures.length ? 1 : 0;
