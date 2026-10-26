/**
 * Authorisation cases for comparing policy engines on the pilot's REAL policies: the
 * personal scheduling/UC-02 mandate, Sam's mortgage mandate, the mortgage evidence grant and
 * the industrial usage grant — plus the review's reproduction shape (a broad permission and
 * a purpose-gated prohibition with the purpose missing).
 *
 * `expected` is the per-policy verdict under three-valued semantics (missing or unsupported
 * context on a rule that would otherwise apply is `indeterminate`, never a known mismatch).
 * The default solid-odrl engine is checked against it in `policy-engine.test.ts`;
 * `scripts/sparq-policy-cases.mjs` checks the Rust sparq-policy evaluator when a locally
 * built `sparq-policy-decide` binary is available.
 */
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import type { Agreement, Iri } from "./core/types.js";
import { CONVENTIONAL_BOOK_OP } from "./domains/conventional/registry.js";
import { consumerGrant, type OfferTerms } from "./domains/industrial.js";
import {
  DISCLOSURE_TARGET,
  type EvidenceRequestTerms,
  grantFromTerms,
  PREQUAL_OP,
} from "./domains/mortgage.js";
import { PAYMENT_OP, SCHEDULE_OP } from "./domains/scheduling.js";
import { personalMandate } from "./mandates.js";
import type { EngineRequest, EngineVerdict } from "./mechanisms/policy-engine.js";
import { PURPOSE } from "./profile/vocabulary.js";
import { NORTH, SAM, samMortgageMandate } from "./scenarios/mortgage.js";

export interface PolicyCase {
  readonly id: string;
  readonly source: string;
  readonly policy: OdrlPolicy;
  readonly request: EngineRequest;
  readonly expected: EngineVerdict["effect"];
  readonly note: string;
}

const AT = "2026-10-20T09:00:00.000Z";
const ALICE_ACTOR = "https://agents.alice.example/personal#agent";
const BOB_PARTY = "https://bob.example/#me";
const MALLORY = "https://mallory.example/#me";

const personal = personalMandate({
  knownParties: [BOB_PARTY],
  knownContacts: ["mateo@example.org"],
})({
  owner: "https://alice.example/#me",
  actor: ALICE_ACTOR,
  validFrom: "2026-10-19T00:00:00.000Z",
  validUntil: "2026-11-19T00:00:00.000Z",
});
const sam = samMortgageMandate()({
  owner: SAM.party,
  actor: SAM.actor,
  validFrom: "2026-10-19T00:00:00.000Z",
  validUntil: "2026-11-19T00:00:00.000Z",
});
const mortgageAgreement = { id: "urn:awp:agreement:0000000000000000000000000000c0de" } as Agreement;
const mortgageGrant = grantFromTerms(
  mortgageAgreement,
  {
    purpose: PURPOSE.creditChecking,
    onward: [{ purpose: PURPOSE.creditChecking, recipient: "https://underwriter.example/#org" }],
    prohibitedPurposes: [PURPOSE.marketing],
  } as unknown as EvidenceRequestTerms,
  SAM.party,
  NORTH.party,
);
const industrialAgreement = {
  id: "urn:awp:agreement:00000000000000000000000000000d47",
} as Agreement;
const industrialGrant = consumerGrant(
  industrialAgreement,
  { purpose: PURPOSE.maintenance } as unknown as OfferTerms,
  "https://orbis-robotics.example/#org",
  "https://nordwerk.example/#org",
);

/** The review's reproduction: broad permission + purpose-gated prohibition. */
const reproduction: OdrlPolicy = {
  id: "urn:awp:policy:review-reproduction",
  type: "Set",
  conflict: "prohibit",
  permissions: [
    { id: "urn:awp:rule:broad", type: "permission", action: "use", target: "urn:awp:asset:x" },
  ],
  prohibitions: [
    {
      id: "urn:awp:rule:no-marketing",
      type: "prohibition",
      action: "use",
      target: "urn:awp:asset:x",
      constraints: [
        { leftOperand: "purpose", operator: "isAnyOf", rightOperand: [PURPOSE.marketing] },
      ],
    },
  ],
};

function req(
  agent: Iri,
  action: string,
  target: Iri,
  extra: { purpose?: Iri; recipient?: Iri } = {},
): EngineRequest {
  return { agent, action, target, at: AT, ...extra };
}

export const POLICY_CASES: readonly PolicyCase[] = [
  {
    id: "X-1",
    source: "phase-2 review reproduction",
    policy: reproduction,
    request: req(ALICE_ACTOR, "use", "urn:awp:asset:x"),
    expected: "indeterminate",
    note: "broad permission + purpose-gated prohibition, purpose missing: must not permit",
  },
  {
    id: "X-2",
    source: "phase-2 review reproduction",
    policy: reproduction,
    request: req(ALICE_ACTOR, "use", "urn:awp:asset:x", { purpose: PURPOSE.serviceProvision }),
    expected: "permit",
    note: "a definitely different purpose disproves the prohibition",
  },
  {
    id: "X-3",
    source: "phase-2 review reproduction",
    policy: reproduction,
    request: req(ALICE_ACTOR, "use", "urn:awp:asset:x", { purpose: PURPOSE.marketing }),
    expected: "prohibited",
    note: "the prohibited purpose",
  },
  {
    id: "P-1",
    source: "personalMandate (autonomous)",
    policy: personal.autonomous,
    request: req(ALICE_ACTOR, "use", SCHEDULE_OP.id, {
      purpose: PURPOSE.scheduling,
      recipient: BOB_PARTY,
    }),
    expected: "permit",
    note: "scheduling with a known counterparty",
  },
  {
    id: "P-2",
    source: "personalMandate (autonomous)",
    policy: personal.autonomous,
    request: req(ALICE_ACTOR, "use", SCHEDULE_OP.id, { recipient: BOB_PARTY }),
    expected: "indeterminate",
    note: "purpose missing on a purpose-gated permission",
  },
  {
    id: "P-3",
    source: "personalMandate (autonomous)",
    policy: personal.autonomous,
    request: req(ALICE_ACTOR, "use", SCHEDULE_OP.id, {
      purpose: PURPOSE.scheduling,
      recipient: MALLORY,
    }),
    expected: "not-applicable",
    note: "unknown counterparty: autonomy does not cover it (the with-approval policy may)",
  },
  {
    id: "P-4",
    source: "personalMandate (with-approval)",
    policy: personal.withApproval,
    request: req(ALICE_ACTOR, "use", SCHEDULE_OP.id, {
      purpose: PURPOSE.scheduling,
      recipient: MALLORY,
    }),
    expected: "permit",
    note: "within the with-approval policy (the composition layer then requires an owner approval)",
  },
  {
    id: "P-5",
    source: "personalMandate (autonomous)",
    policy: personal.autonomous,
    request: req(ALICE_ACTOR, "compensate", PAYMENT_OP, { purpose: PURPOSE.scheduling }),
    expected: "prohibited",
    note: "the unconstrained no-payment prohibition",
  },
  {
    id: "P-6",
    source: "personalMandate (autonomous, UC-02)",
    policy: personal.autonomous,
    request: req(ALICE_ACTOR, "use", CONVENTIONAL_BOOK_OP.id, {
      purpose: PURPOSE.scheduling,
      recipient: "mailto:mateo@example.org",
    }),
    expected: "permit",
    note: "booking through a remembered service for a known contact",
  },
  {
    id: "M-1",
    source: "samMortgageMandate (autonomous)",
    policy: sam.autonomous,
    request: req(SAM.actor, "use", PREQUAL_OP.id, {
      purpose: PURPOSE.mortgagePrequalification,
      recipient: NORTH.party,
    }),
    expected: "permit",
    note: "compare offers with a listed lender",
  },
  {
    id: "M-2",
    source: "samMortgageMandate (with-approval)",
    policy: sam.withApproval,
    request: req(SAM.actor, "distribute", DISCLOSURE_TARGET, { purpose: PURPOSE.creditChecking }),
    expected: "indeterminate",
    note: "disclosure with the recipient missing",
  },
  {
    id: "M-3",
    source: "grantFromTerms (mortgage evidence grant)",
    policy: mortgageGrant.policy,
    request: req(NORTH.party, "read", mortgageGrant.target, { purpose: PURPOSE.creditChecking }),
    expected: "permit",
    note: "read for the agreed purpose",
  },
  {
    id: "M-4",
    source: "grantFromTerms (mortgage evidence grant)",
    policy: mortgageGrant.policy,
    request: req(NORTH.party, "read", mortgageGrant.target, { purpose: PURPOSE.marketing }),
    expected: "prohibited",
    note: "marketing is a prohibited purpose",
  },
  {
    id: "M-5",
    source: "grantFromTerms (mortgage evidence grant)",
    policy: mortgageGrant.policy,
    request: req(NORTH.party, "read", mortgageGrant.target),
    expected: "indeterminate",
    note: "purpose missing: the marketing prohibition may apply",
  },
  {
    id: "I-1",
    source: "consumerGrant (industrial usage grant)",
    policy: industrialGrant.policy,
    request: req("https://nordwerk.example/#org", "read", industrialGrant.target, {
      purpose: PURPOSE.maintenance,
    }),
    expected: "permit",
    note: "read for the agreed maintenance purpose",
  },
  {
    id: "I-2",
    source: "consumerGrant (industrial usage grant)",
    policy: industrialGrant.policy,
    request: req("https://nordwerk.example/#org", "distribute", industrialGrant.target, {
      purpose: PURPOSE.maintenance,
    }),
    expected: "prohibited",
    note: "redistribution is prohibited",
  },
  {
    id: "I-3",
    source: "consumerGrant (industrial usage grant)",
    policy: industrialGrant.policy,
    request: req("https://nordwerk.example/#org", "read", industrialGrant.target),
    expected: "indeterminate",
    note: "purpose missing: 'no other purpose' (isNoneOf) may apply",
  },
  {
    id: "I-4",
    source: "consumerGrant (industrial usage grant)",
    policy: industrialGrant.policy,
    request: req("https://nordwerk.example/#org", "read", industrialGrant.target, {
      purpose: PURPOSE.marketing,
    }),
    expected: "prohibited",
    note: "any other purpose is prohibited",
  },
  {
    id: "I-5",
    source: "consumerGrant (industrial usage grant)",
    policy: industrialGrant.policy,
    request: req("https://intruder.example/#org", "read", industrialGrant.target, {
      purpose: PURPOSE.maintenance,
    }),
    expected: "not-applicable",
    note: "the grant is assigned to NordWerk only",
  },
];
