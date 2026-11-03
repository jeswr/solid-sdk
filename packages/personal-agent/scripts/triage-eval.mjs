#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
// Triage evaluation over the LABELLED SYNTHETIC corpus (24 invented messages; see
// src/triage/corpus.ts). Requires `npm run build`.
//
// Default: the local deterministic baseline only (no network). Reports answered/abstained counts,
// best-guess accuracy, a confusion matrix and every error for error analysis. With 24 items and
// one author's labels this measures nothing about production quality, and nothing about any
// hosted model.
//
// Hosted pilot triage was retired in A-011. This evaluation uses local rules only.
// Usage: node scripts/triage-eval.mjs [--out=reports/triage-eval-report.json]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { SYNTHETIC_CORPUS, evaluate, triageSample } = await import(
  join(root, "dist", "triage", "index.js")
);
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = flag("out") ?? join(root, "reports", "triage-eval-report.json");
const runs = { baseline: await evaluate(SYNTHETIC_CORPUS, (item) => triageSample(item.sample)) };

const report = {
  report: "Message triage — evaluation over the labelled synthetic corpus",
  generatedAt: new Date().toISOString(),
  corpus: {
    items: SYNTHETIC_CORPUS.length,
    labels: "author's judgement; synthetic; example.* domains",
  },
  caveats: [
    "24 synthetic items: no quality, cost or calibration claim follows from this report.",
    "Thresholds are uncalibrated defaults; 'uncertain' means the owner is asked.",
    "The local baseline deliberately stays below the thresholds, so it abstains on every item; its best-guess accuracy is for error analysis only.",
  ],
  runs,
};
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
for (const [name, r] of Object.entries(runs))
  console.log(
    `${name}: ${r.items} items, answered ${r.answered}, abstained ${r.abstained}, best-guess accuracy ${(r.candidateAccuracy * 100).toFixed(0)}%, errors ${r.errors.length}`,
  );
