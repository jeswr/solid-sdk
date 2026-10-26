#!/usr/bin/env node
// Run the shared authorisation cases (src/pilot/policy-cases.ts) against the REAL Rust
// sparq-policy evaluator through a locally built `sparq-policy-decide` binary, side by side
// with the default solid-odrl engine. Requires `npm run build`.
//
//   cargo build --manifest-path ../sparq-policy/crates/sparq-policy/Cargo.toml \
//     --features json-cli --bin sparq-policy-decide
//   AWP_SPARQ_POLICY_BIN=../sparq-policy/target/debug/sparq-policy-decide npm run pilot:sparq-cases
//
// Without a binary the report records `setup-required` and the script exits 3: that is NOT a
// pass and NOT evidence about the evaluator.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { solidOdrlEngine } from "../dist/pilot/mechanisms/policy-engine.js";
import { sparqPolicyEngine } from "../dist/pilot/mechanisms/sparq-policy.js";
import { POLICY_CASES } from "../dist/pilot/policy-cases.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const OUT = resolve(root, "reports", "pilot-sparq-policy-cases.json");
const binary = resolve(
  root,
  process.env.AWP_SPARQ_POLICY_BIN ?? "../sparq-policy/target/debug/sparq-policy-decide",
);
mkdirSync(dirname(OUT), { recursive: true });

if (!existsSync(binary)) {
  const report = {
    report: "Agentic Web pilot — policy cases against the Rust sparq-policy evaluator",
    status: "setup-required",
    detail: `no sparq-policy-decide binary at ${binary}; nothing was evaluated by SPARQ`,
    build:
      "cargo build --manifest-path ../sparq-policy/crates/sparq-policy/Cargo.toml --features json-cli --bin sparq-policy-decide",
    solidOdrl: POLICY_CASES.map((c) => ({
      id: c.id,
      expected: c.expected,
      solidOdrl: solidOdrlEngine.evaluate(c.policy, c.request).effect,
    })),
  };
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`setup-required: ${report.detail}`);
  process.exit(3);
}

const sparq = sparqPolicyEngine({ binary });
const rows = POLICY_CASES.map((c) => {
  const s = sparq.evaluate(c.policy, c.request);
  const o = solidOdrlEngine.evaluate(c.policy, c.request);
  return {
    id: c.id,
    source: c.source,
    note: c.note,
    expected: c.expected,
    sparq: s.effect,
    sparqEvaluator: s.evaluator ?? sparq.id,
    sparqReason: s.reason,
    solidOdrl: o.effect,
    pass: s.effect === c.expected,
    enginesAgree: s.effect === o.effect,
  };
});
const report = {
  report: "Agentic Web pilot — policy cases against the Rust sparq-policy evaluator",
  status: "evaluated",
  binary,
  notice:
    "Both engines evaluate the pilot's own policies; agreement between two implementations is consistency evidence for these cases only, not conformance or interoperability evidence.",
  rows,
  summary: {
    cases: rows.length,
    passed: rows.filter((r) => r.pass).length,
    failed: rows.filter((r) => !r.pass).length,
    enginesAgree: rows.filter((r) => r.enginesAgree).length,
  },
};
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));
process.exit(report.summary.failed === 0 ? 0 : 1);
