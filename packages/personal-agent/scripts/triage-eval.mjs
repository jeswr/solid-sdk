#!/usr/bin/env node
// Triage evaluation over the LABELLED SYNTHETIC corpus (24 invented messages; see
// src/triage/corpus.ts). Requires `npm run build`.
//
// Default: the local deterministic baseline only (no network). Reports answered/abstained counts,
// best-guess accuracy, a confusion matrix and every error for error analysis. With 24 items and
// one author's labels this measures nothing about production quality, and nothing about any
// hosted model.
//
// Optional hosted run (TypeSafe), ONLY with all of:
//   TYPESAFE_API_KEY in the environment (never on the command line), optional TYPESAFE_MODEL
//   (pinned jev-X.Y.Z), and the flag --send-synthetic-corpus-to-typesafe. It sends the 24
//   synthetic samples to https://api.typesafe.ai/v1/systemone. Thresholds are uncalibrated.
//
// Usage: node scripts/triage-eval.mjs [--out=reports/triage-eval-report.json]
//        [--send-synthetic-corpus-to-typesafe]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { SYNTHETIC_CORPUS, evaluate, triageSample, typeSafeFromEnv } = await import(
  join(root, "dist", "triage", "index.js")
);
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = flag("out") ?? join(root, "reports", "triage-eval-report.json");
const hostedRequested = process.argv.includes("--send-synthetic-corpus-to-typesafe");

const runs = {};
runs.baseline = await evaluate(SYNTHETIC_CORPUS, (item) => triageSample(item.sample));

if (hostedRequested) {
  const hosted = typeSafeFromEnv(process.env);
  if (!hosted.classifier) {
    console.error(`hosted run not possible: ${hosted.problem ?? "TYPESAFE_API_KEY is not set"}`);
    process.exit(3);
  }
  const statuses = {};
  runs.typesafe = await evaluate(SYNTHETIC_CORPUS, async (item) => {
    const r = await triageSample(item.sample, {
      classifier: hosted.classifier,
      allowed: true,
      why: "explicit flag for the synthetic corpus",
    });
    statuses[r.hosted.status] = (statuses[r.hosted.status] ?? 0) + 1;
    return r;
  });
  runs.typesafe.hostedStatuses = statuses;
  runs.typesafe.model = hosted.model;
}

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
