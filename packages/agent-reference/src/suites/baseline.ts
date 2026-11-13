// AUTHORED-BY Claude Opus 5.5
/**
 * The baseline suites: what the pilot runtime already runs, one per layer, and the baseline
 * configuration built from them. Names follow the explorer model; each summary says what
 * this runtime does, including where it falls short of the suite's full description.
 */
import { MECHANISM_ID } from "../mechanisms/statements.js";
import { CONFIG_ED25519, POLICY_PROFILE } from "../profile/configurations.js";
import { PILOT_PROFILE } from "../profile/vocabulary.js";
import { type Configuration, type SuiteConstraint, SuiteRegistry } from "./registry.js";

export const BASELINE_SUITES = {
  transport: {
    layer: "transport",
    id: "direct-http",
    name: "Direct HTTP",
    summary:
      "One agent hands the signed message straight to the other; in this runtime the hop is the in-process direct binding.",
    binding: "direct-local/0.1",
  },
  "data-access": {
    layer: "data-access",
    id: "by-value",
    name: "By value",
    summary: "The data travels inside the message.",
    mode: "by-value",
  },
  identity: {
    layer: "identity",
    id: "pinned-key",
    name: "Web address with a pinned key",
    summary: "Keys are exchanged in advance (the reviewed introduction) and looked up locally.",
    resolution: "pinned",
  },
  meaning: {
    layer: "meaning",
    id: "fixed-vocabulary",
    name: "Fixed vocabulary",
    summary: "Both sides declare the pilot profile and its versioned operation models.",
    vocabulary: PILOT_PROFILE,
  },
  authority: {
    layer: "authority",
    id: "mandate-signed",
    name: "Mandate signed by the person's key",
    summary:
      "An owner mandate in the pilot ODRL subset, signed as a JWS with the owner's pinned key; approvals are signed the same way and bound to the exact action.",
    mandateFormat: "awp-mandate+jws",
    approvalFormat: "awp-approval+jws",
  },
  authenticity: {
    layer: "authenticity",
    id: "jws",
    name: "Signed statement (JWS)",
    summary: "Every message and every relayed statement is a compact JWS (EdDSA) over its bytes.",
    mechanism: MECHANISM_ID,
    algs: ["EdDSA"],
  },
  trust: {
    layer: "trust",
    id: "register-chain",
    name: "Own list, then a chain of registers",
    summary:
      "The principal's own list (the trust store's scoped source rules and chosen recipients) is checked first; otherwise a lookup starts at a root the principal accepts and follows its delegation to the register that answers.",
    anchors: "register-chain",
  },
  reliance: {
    layer: "reliance",
    id: "precedence-rules",
    name: "Precedence and freshness rules",
    summary:
      "Methods and freshness are enforced; profiles that declare a precedence policy select a source or ask for an order, retaining superseded statements outside factual support. Legacy profiles without that policy retain their existing behavior.",
    enforcedAtGate: true,
  },
  "usage-control": {
    layer: "usage-control",
    id: "odrl-rules",
    name: "ODRL terms, rules only",
    summary: `Terms and mandates are ODRL policies in the pilot subset (${POLICY_PROFILE}), decided by deterministic code.`,
    policyLanguage: POLICY_PROFILE,
    rulesOnly: true,
  },
  commitments: {
    layer: "commitments",
    id: "signed-offer-acceptance",
    name: "Signed offer and acceptance",
    summary:
      "Each side signs the exact terms; the acceptance names the offer and its terms digest, and both sides derive the same agreement id.",
    agreement: "signed-offer-acceptance",
  },
  accountability: {
    layer: "accountability",
    id: "local-ledger",
    name: "Signed ledger on each side",
    summary: "Each party keeps an append-only, hash-chained record of its own decisions.",
    record: "hash-chained-local",
  },
} as const;

/** The baseline configuration: one baseline suite per layer, carried as the pilot's Ed25519 one. */
export const BASELINE: Configuration = {
  id: "baseline",
  pilotConfiguration: CONFIG_ED25519,
  layers: {
    transport: BASELINE_SUITES.transport.id,
    "data-access": BASELINE_SUITES["data-access"].id,
    identity: BASELINE_SUITES.identity.id,
    meaning: BASELINE_SUITES.meaning.id,
    authority: BASELINE_SUITES.authority.id,
    authenticity: BASELINE_SUITES.authenticity.id,
    trust: BASELINE_SUITES.trust.id,
    reliance: BASELINE_SUITES.reliance.id,
    "usage-control": BASELINE_SUITES["usage-control"].id,
    commitments: BASELINE_SUITES.commitments.id,
    accountability: BASELINE_SUITES.accountability.id,
  },
};

/** Combinations the plan rules out, stated now so later suites cannot slip past them. */
export const SUITE_CONSTRAINTS: readonly SuiteConstraint[] = [
  {
    id: "by-reference-needs-access-control",
    text: "sharing by reference needs the Solid access-control usage suite",
    violated: (l) =>
      l["data-access"] === "by-reference-solid" && l["usage-control"] !== "solid-access-control"
        ? "data-access"
        : undefined,
  },
  {
    id: "zk-needs-credentials",
    text: "a zero-knowledge query proof needs credentials in a form it can read (Data Integrity)",
    violated: (l) =>
      l.authenticity === "zk-query-proof" && l.authority !== "mandate-credential"
        ? "authenticity"
        : undefined,
  },
];

/** A registry holding the baseline suites and the baseline configuration. */
export function baselineRegistry(): SuiteRegistry {
  const registry = new SuiteRegistry(SUITE_CONSTRAINTS);
  for (const suite of Object.values(BASELINE_SUITES)) registry.register(suite);
  registry.configure(BASELINE);
  return registry;
}
