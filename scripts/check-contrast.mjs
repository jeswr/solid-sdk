#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
import { existsSync, readFileSync } from "node:fs";
import { contrastIssues, evaluateContrast } from "./contrast.mjs";
import { parseTokens } from "./token-css.mjs";

const css = readFileSync(
  new URL("../packages/suite-ui/src/styles/tokens.css", import.meta.url),
  "utf8",
);
const questions = new URL("../QUESTIONS.md", import.meta.url);
const known = contrastIssues(existsSync(questions) ? readFileSync(questions, "utf8") : "");
const results = evaluateContrast(parseTokens(css), known);
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
const stale = [...known.keys()].filter(
  (key) =>
    !results.some(
      (row) => `${row.theme}|${row.fg}|${row.bg}` === key && row.status === "KNOWN SPEC ISSUE",
    ),
);
if (stale.length) console.error("Stale spec issue entries:", stale);
console.log(
  `${results.length} pairs; ${results.filter((row) => row.status === "KNOWN SPEC ISSUE").length} known spec issues; ${failures.length} failures.`,
);
process.exitCode = failures.length || stale.length ? 1 : 0;
