// Render docs/PILOT-MATRIX.md from the machine-readable matrix in src/pilot/matrix.ts
// (via the built dist/). Run after `npm run build`: node scripts/render-pilot-matrix.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { PARTS, REQUIREMENTS, COMPETENCY } = await import(
  new URL("../dist/pilot/matrix.js", import.meta.url).href
);

const cell = (s) => String(s).replace(/\|/g, "\\|");
const table = (rows) =>
  [
    "| Id | Topic | Status | Evidence level | Code | Tests | Remaining gaps |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${cell(r.topic)} | ${r.status} | ${r.evidence} | ${r.code.map((c) => `\`${cell(c)}\``).join("<br>") || "—"} | ${r.tests.map((t) => `\`${t.replace("src/pilot/", "")}\``).join("<br>") || "—"} | ${r.gaps.map(cell).join("; ") || "—"} |`,
    ),
  ].join("\n");

const doc = `# Pilot capability / requirement matrix

Generated from \`src/pilot/matrix.ts\` by \`scripts/render-pilot-matrix.mjs\`; the same data is
embedded in \`reports/pilot-demo-report.json\`. Evidence levels are deliberately conservative:
**"self-test (real crypto, local simulation)"** means real JWS signing/verification, real
policy evaluation and real state transitions between separately configured agents in one
process, exercised by this repository's own tests and demo — not an independent
implementation, not a live provider round trip, and not a conformance or compliance claim.

## Specification parts A–G

${table(PARTS)}

## Requirements R01–R26

${table(REQUIREMENTS)}

## Audit competency questions CT-01–CT-12

${table(COMPETENCY)}
`;
writeFileSync(`${root}docs/PILOT-MATRIX.md`, doc);
console.log("wrote docs/PILOT-MATRIX.md");
