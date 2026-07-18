#!/usr/bin/env node
/**
 * check-insignia.mjs — the never-render gate over YOUR domain's banned marks
 * (regulatory insignia, third-party product marks, certification badges).
 *
 * The framework ships NO built-in roster: `branding.bannedMarks` in
 * apps/tour/content/walkthrough.json is the single source. Each entry is
 * `{ "pattern": "\\bEXAMPLEMARK\\b", "reason": "why it must never render" }` —
 * a JS regex source, case-insensitive unless it contains an uppercase letter.
 * Until you add your roster this gate passes vacuously and says so.
 */
import { readFileSync } from "node:fs";
import { scanInsigniaTree } from "@jeswr/solid-showcase-kit/testing";

const DOCUMENT = "apps/tour/content/walkthrough.json";
const SCANNED = ["apps", "packages", "seeds", "e2e", "docs"];

const doc = JSON.parse(readFileSync(DOCUMENT, "utf8"));
const bannedMarks = doc.branding?.bannedMarks ?? [];

if (bannedMarks.length === 0) {
  process.stdout.write(
    "• check:insignia — no banned-marks roster configured yet. Add your domain's " +
      `never-render marks to branding.bannedMarks in ${DOCUMENT} (the framework ships none).\n`,
  );
  process.exit(0);
}

const findings = scanInsigniaTree(SCANNED, { bannedMarks, rootDir: process.cwd() });
if (findings.length > 0) {
  process.stderr.write(`✗ ${findings.length} insignia finding(s):\n`);
  for (const finding of findings) {
    process.stderr.write(`  ${finding.file}:${finding.line} [${finding.id}] ${finding.excerpt}\n`);
  }
  process.exit(1);
}
process.stdout.write(
  `✔ check:insignia — ${bannedMarks.length} banned mark(s), zero findings across ${SCANNED.join(", ")}\n`,
);
