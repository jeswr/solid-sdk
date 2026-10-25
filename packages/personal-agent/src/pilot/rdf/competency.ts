/**
 * Competency queries over the RDF evidence graph (conceptual-audit questions CT-02, CT-03,
 * CT-05, CT-07 and the uncertain-effect rule), plus assertion-absence checks. The SPARQL text
 * from `toSparql` is executed by a real SPARQL engine (SPARQ's CLI, in
 * `scripts/render-pilot-rdf.mjs`); `runQuery` evaluates the same patterns only as an
 * independent consistency comparison and for unit tests.
 *
 * `collectRuntimeEvidence` produces the graph from REAL runtime ledgers of synthetic runs:
 * a personal-scheduling negotiation whose responder's calendar effect times out after
 * commit (uncertain) and is later reconciled, and the industrial scenario (source-authority
 * assessments). Both sides run this code base — this is not interoperability evidence.
 */
import type { Quad } from "n3";
import { DirectBus } from "../bindings/direct.js";
import { digestOf } from "../core/canonical.js";
import { buildMeetingTerms, MEETING_MODEL, SCHEDULE_OP } from "../domains/scheduling.js";
import { runIndustrial } from "../scenarios/industrial.js";
import { BOB, fixedClock, personalPair } from "../scenarios/personal.js";
import type { LedgerEntry } from "../store/ledger.js";
import { descriptionToRdf, ledgerToRdf } from "./evidence.js";
import type { Query } from "./serialise.js";

export const COMPETENCY_QUERIES: readonly Query[] = [
  {
    id: "CQ-CT02",
    question:
      "Which verification results support integrity and key attribution for which key holder, and what do they state they leave open?",
    select: ["?holder", "?outcome", "?limitation"],
    where: [
      ["?v", "a", "awp:VerificationResult"],
      ["?v", "awp:attributedKeyHolder", "?holder"],
      ["?v", "awp:verificationOutcome", "?outcome"],
      ["?v", "awp:limitation", "?limitation"],
    ],
  },
  {
    id: "CQ-CT03",
    question:
      "Who recognises which source for which claim type, under which rule and version, with what outcome?",
    select: ["?evaluator", "?source", "?claimType", "?rule", "?version", "?outcome"],
    where: [
      ["?s", "a", "awp:SourceAuthorityAssessment"],
      ["?s", "prov:wasAttributedTo", "?evaluator"],
      ["?s", "awp:source", "?source"],
      ["?s", "awp:claimType", "?claimType"],
      ["?s", "awp:sourceRule", "?rule"],
      ["?s", "awp:sourceRuleVersion", "?version"],
      ["?s", "awp:assessmentOutcome", "?outcome"],
    ],
  },
  {
    id: "CQ-CT05",
    question:
      "Which owner mandate (by digest) authorised each permitted action, for which ODRL action and DPV purpose, on what basis and by which rule?",
    select: ["?requested", "?purpose", "?mandate", "?digest", "?basis", "?rule"],
    where: [
      ["?d", "a", "awp:AuthorisationDecision"],
      ["?d", "awp:authorisationOutcome", "awpa:permit"],
      ["?d", "awp:evaluatedPolicy", "?mandate"],
      ["?mandate", "a", "awp:OwnerMandate"],
      ["?d", "awp:policyDigest", "?digest"],
      ["?mandate", "awp:digest", "?digest"],
      ["?d", "awp:decisionBasis", "?basis"],
      ["?d", "awp:matchedRule", "?rule"],
      ["?d", "awp:action", "?i"],
      ["?i", "awp:requestedAction", "?requested"],
      ["?i", "dpv:hasPurpose", "?purpose"],
    ],
  },
  {
    id: "CQ-CT07",
    question:
      "Which offer and acceptance formed each agreement, on which terms digest, and which separate observations (by method) bear on its fulfilment?",
    select: ["?offer", "?acceptance", "?termsDigest", "?start", "?conclusion", "?method"],
    where: [
      ["?agr", "a", "awp:AgreementRecord"],
      ["?agr", "awp:offer", "?offer"],
      ["?agr", "awp:acceptance", "?acceptance"],
      ["?agr", "awp:termsDigest", "?termsDigest"],
      ["?agr", "awp:agreedEvent", "?ev"],
      ["?ev", "schema:startDate", "?start"],
      ["?act", "awp:basis", "?agr"],
      ["?o", "a", "awp:OutcomeRecord"],
      ["?o", "awp:concerns", "?act"],
      ["?o", "awp:conclusion", "?conclusion"],
      ["?o", "awp:method", "?method"],
    ],
  },
  {
    id: "CQ-CT07-peer",
    question: "Which conclusions were only REPORTED by a peer about the peer's own activity?",
    select: ["?reporter", "?conclusion"],
    where: [
      ["?r", "a", "awp:PeerOutcomeReport"],
      ["?r", "prov:wasAttributedTo", "?reporter"],
      ["?r", "awp:conclusion", "?conclusion"],
    ],
  },
  {
    id: "CQ-R11-unresolved",
    // Order is NOT compared (the evaluator has no FILTER): the query is correct for this
    // runtime because `conclude()` records nothing for an effect after a completed or
    // not-executed conclusion, so any such observation resolves the uncertain one.
    question:
      "Which activities have an uncertain observation and no completed or not-executed observation of the same activity in the graph (must be reconciled before any retry)?",
    select: ["?act", "?effectKey"],
    where: [
      ["?o", "awp:concerns", "?act"],
      ["?o", "awp:conclusion", "awpc:uncertain"],
      ["?act", "awp:effectKey", "?effectKey"],
    ],
    notExists: [
      [
        ["?o2", "awp:concerns", "?act"],
        ["?o2", "awp:conclusion", "awpc:completed"],
      ],
      [
        ["?o2", "awp:concerns", "?act"],
        ["?o2", "awp:conclusion", "awpc:not-executed"],
      ],
    ],
  },
];

/**
 * Assertion-absence checks: patterns that must not be ASSERTED in one agent's exported graph.
 * No reasoning is performed, so an empty answer is not a proof that the pattern is not
 * entailed under PROV/ODRL/RDFS semantics — only that the export does not state it.
 */
export const FORBIDDEN: readonly Query[] = [
  {
    id: "F-claimed-representation-as-provenance",
    question:
      "Does any inbound CLAIM of representation appear as prov:actedOnBehalfOf? (Claims are not provenance.)",
    select: ["?a", "?p"],
    where: [
      ["?m", "awp:claimedSender", "?a"],
      ["?m", "awp:claimedOnBehalfOf", "?p"],
      ["?a", "prov:actedOnBehalfOf", "?p"],
    ],
  },
  {
    id: "F-delegation-without-activity",
    question: "Is any prov:actedOnBehalfOf asserted without an activity-scoped delegation?",
    select: ["?a", "?p"],
    where: [["?a", "prov:actedOnBehalfOf", "?p"]],
    notExists: [
      [
        ["?a", "prov:qualifiedDelegation", "?d"],
        ["?d", "prov:agent", "?p"],
        ["?d", "prov:hadActivity", "?act"],
        ["?act", "prov:wasAssociatedWith", "?a"],
      ],
    ],
  },
  {
    id: "F-verification-as-authorisation",
    question: "Does any verification result carry an authorisation or assessment outcome?",
    select: ["?v"],
    where: [
      ["?v", "a", "awp:VerificationResult"],
      ["?v", "awp:authorisationOutcome", "?x"],
    ],
  },
  {
    id: "F-agreement-record-as-odrl-agreement",
    question: "Is any agreement record typed as odrl:Agreement?",
    select: ["?agr"],
    where: [
      ["?agr", "a", "awp:AgreementRecord"],
      ["?agr", "a", "odrl:Agreement"],
    ],
  },
];

export interface RuntimeEvidence {
  readonly ledgers: Record<string, readonly LedgerEntry[]>;
  /** Bob's ledger before reconciliation (the uncertain effect is still unresolved). */
  readonly beforeReconcile: readonly LedgerEntry[];
  readonly description: Record<string, unknown>;
  readonly descriptionId: string;
}

export async function collectRuntimeEvidence(): Promise<RuntimeEvidence> {
  const clock = fixedClock();
  const pair = await personalPair({ now: clock.now });
  pair.bob.calendar.failNext = "timeout-after-commit";
  const start = await pair.alice.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: buildMeetingTerms({
      calendar: pair.alice.calendar,
      title: "Synthetic catch-up",
      durationMinutes: 30,
      window: { start: "2026-10-20T13:00:00Z", end: "2026-10-20T17:00:00Z" },
      now: clock.now().toISOString(),
    }) as never,
    models: [MEETING_MODEL],
  });
  await new DirectBus()
    .register(pair.alice.runtime, pair.bob.runtime)
    .send(pair.alice.runtime, start)
    .run();
  const beforeReconcile = [...pair.bob.ledger.entries()];
  const rec = await pair.bob.runtime.reconcile();
  await new DirectBus()
    .register(pair.alice.runtime, pair.bob.runtime)
    .send(pair.bob.runtime, rec)
    .run();
  const industrial = await runIndustrial(fixedClock("2026-10-05T09:00:00Z"));
  const description = pair.bob.runtime.description() as unknown as Record<string, unknown>;
  return {
    ledgers: {
      "urn:awp:ledger:alice": pair.alice.ledger.entries(),
      "urn:awp:ledger:bob": pair.bob.ledger.entries(),
      "urn:awp:ledger:industrial-nordwerk": industrial.ledgers.nordwerk ?? [],
    },
    beforeReconcile,
    description,
    descriptionId: `urn:awp:description:${digestOf(description).replace(/^sha-256:/, "")}`,
  };
}

/** Convert collected evidence into one graph (plus the per-ledger conversion reports). */
export function evidenceGraph(ev: RuntimeEvidence): {
  quads: Quad[];
  reports: Record<string, ReturnType<typeof ledgerToRdf>["report"]>;
} {
  const reports: Record<string, ReturnType<typeof ledgerToRdf>["report"]> = {};
  const quads = [];
  for (const [id, entries] of Object.entries(ev.ledgers)) {
    const r = ledgerToRdf(entries, id);
    reports[id] = r.report;
    quads.push(...r.quads);
  }
  quads.push(...descriptionToRdf(ev.description, ev.descriptionId));
  return { quads, reports };
}
