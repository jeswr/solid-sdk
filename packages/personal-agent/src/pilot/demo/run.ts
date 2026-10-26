/**
 * The local demo: runs every scenario on the shared runtime, compares OBSERVED state with
 * stated expectations, and returns a machine-readable report. Nothing is sent to any
 * external service; all keys are fresh synthetic keys generated for this run.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../core/canonical.js";
import { COMPETENCY, PARTS, REQUIREMENTS } from "../matrix.js";
import {
  type PolicyEngine,
  SOLID_ODRL_ENGINE_ID,
  solidOdrlEngine,
} from "../mechanisms/policy-engine.js";
import { tallyingEngine } from "../policy-config.js";
import { CONFIGURATIONS } from "../profile/configurations.js";
import { PILOT_PROFILE, PILOT_PROFILE_VERSION, TERM_REGISTER } from "../profile/vocabulary.js";
import { runConventional } from "../scenarios/conventional.js";
import { runEnergy } from "../scenarios/energy.js";
import { runFhir } from "../scenarios/fhir.js";
import { runIndustrial } from "../scenarios/industrial.js";
import { runMortgage } from "../scenarios/mortgage.js";
import { fixedClock } from "../scenarios/personal.js";
import {
  caseApproval,
  caseConfigurationMismatch,
  caseEmailParity,
  caseFeeRefused,
  caseMandateAndRepresentation,
  caseMismatch,
  caseSuccessDirect,
  caseTamperReplayAudience,
  caseUncertainAndRestart,
} from "../scenarios/personal-cases.js";
import { useScenarioPolicyEngine } from "../scenarios/policy.js";

export interface Check {
  readonly id: string;
  readonly claim: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly pass: boolean;
}

export interface ScenarioReport {
  readonly id: string;
  readonly title: string;
  readonly useCase: string;
  readonly requirements: readonly string[];
  readonly competency: readonly string[];
  readonly evidenceLevel: string;
  readonly checks: readonly Check[];
  readonly observed: unknown;
  readonly limitations: readonly string[];
  readonly error?: string;
}

const EVIDENCE =
  "self-test with real cryptographic checks in a local simulation (not independent interop, not a live provider round trip)";

function same(a: unknown, b: unknown): boolean {
  try {
    return canonicalJson(a ?? null) === canonicalJson(b ?? null);
  } catch {
    return false;
  }
}

function checker() {
  const checks: Check[] = [];
  return {
    checks,
    eq(id: string, claim: string, actual: unknown, expected: unknown) {
      checks.push({ id, claim, expected, actual, pass: same(actual, expected) });
    },
    ok(
      id: string,
      claim: string,
      actual: unknown,
      predicate: (v: unknown) => boolean,
      expected: string,
    ) {
      checks.push({ id, claim, expected, actual, pass: predicate(actual) });
    },
  };
}

async function runScenario(
  meta: Omit<ScenarioReport, "checks" | "observed" | "error">,
  body: (c: ReturnType<typeof checker>) => Promise<unknown>,
): Promise<ScenarioReport> {
  const c = checker();
  try {
    const observed = await body(c);
    return { ...meta, checks: c.checks, observed };
  } catch (error) {
    return {
      ...meta,
      checks: [
        ...c.checks,
        {
          id: "run",
          claim: "scenario ran",
          expected: "no error",
          actual: String(error),
          pass: false,
        },
      ],
      observed: null,
      error: (error as Error).stack ?? String(error),
    };
  }
}

function gitCommit(): string {
  try {
    const head = readFileSync(join(".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = join(".git", head.slice(5));
    return existsSync(ref) ? readFileSync(ref, "utf8").trim() : head;
  } catch {
    return "unknown";
  }
}

export async function runDemo(
  opts: {
    only?: readonly string[];
    /** Policy module for every scenario runtime and enforcement point (default solid-odrl). */
    policy?: { module: string; engine: PolicyEngine };
  } = {},
) {
  const selected = opts.policy?.engine ?? solidOdrlEngine;
  // With another module selected, every verdict is ALSO computed by solid-odrl for comparison
  // only: the selected module's verdict is always the one used (no fallback, no override).
  const compared = { count: 0, disagreements: [] as Array<Record<string, unknown>> };
  const acting: PolicyEngine =
    selected === solidOdrlEngine
      ? selected
      : {
          id: selected.id,
          evaluate(policy, request) {
            const v = selected.evaluate(policy, request);
            const reference = solidOdrlEngine.evaluate(policy, request);
            compared.count++;
            if (reference.effect !== v.effect && compared.disagreements.length < 50)
              compared.disagreements.push({
                policy: policy.id,
                request,
                selected: v.effect,
                solidOdrl: reference.effect,
              });
            return v;
          },
        };
  const tallied = tallyingEngine(acting);
  useScenarioPolicyEngine(tallied.engine);
  try {
    return {
      ...(await runScenarios(opts)),
      policyModule: {
        selected: opts.policy?.module ?? `solid-odrl (${SOLID_ODRL_ENGINE_ID}; harness default)`,
        note: "every scenario runtime (mandate decisions) and enforcement point (data-use grants) used this module; no fallback. Tally of verdicts by the evaluator identity each verdict reports; UNANSWERED marks verdicts the module did not answer",
        verdicts: tallied.tally(),
        ...(selected === solidOdrlEngine
          ? {}
          : {
              crossCheckAgainstSolidOdrl: {
                note: "each verdict recomputed by @jeswr/solid-odrl for comparison only (never used to decide)",
                compared: compared.count,
                disagreements: compared.disagreements,
              },
            }),
      },
    };
  } finally {
    useScenarioPolicyEngine(undefined);
  }
}

async function runScenarios(opts: { only?: readonly string[] }) {
  const scenarios: ScenarioReport[] = [];
  const add = (r: ScenarioReport | undefined) => {
    if (r) scenarios.push(r);
  };
  const scenario = (
    meta: Omit<ScenarioReport, "checks" | "observed" | "error">,
    body: (c: ReturnType<typeof checker>) => Promise<unknown>,
  ) =>
    opts.only && !opts.only.includes(meta.id)
      ? Promise.resolve(undefined)
      : runScenario(meta, body);

  add(
    await scenario(
      {
        id: "P1",
        title: "Two personal agents agree a meeting (direct binding)",
        useCase: "personal-to-personal scheduling",
        requirements: ["R01", "R04", "R07", "R09", "R20"],
        competency: ["CT-05", "CT-07"],
        evidenceLevel: EVIDENCE,
        limitations: ["synthetic calendars; no real booking"],
      },
      async (c) => {
        const o = await caseSuccessDirect();
        c.eq(
          "P1.1",
          "interaction sequence: discovery, offer, counter-offer, acceptance, two receipts",
          o.trace.map((t) => `${t.kind}:${t.disposition}`),
          [
            "describe:accepted",
            "description:accepted",
            "propose:accepted",
            "propose:accepted",
            "accept:accepted",
            "receipt:accepted",
            "receipt:accepted",
          ],
        );
        c.eq(
          "P1.2",
          "both sides completed",
          [o.alice.phase, o.bob.phase],
          ["completed", "completed"],
        );
        c.eq(
          "P1.3",
          "exactly one synthetic hold per side at the same instant",
          [
            o.holds.alice.length,
            o.holds.bob.length,
            o.holds.alice[0]?.start === o.holds.bob[0]?.start,
          ],
          [1, 1, true],
        );
        c.eq(
          "P1.4",
          "agreement id computed independently on both sides",
          o.agreementIdsMatch,
          true,
        );
        c.eq("P1.5", "hash-chained ledgers verify", o.ledgersIntact, true);
        c.ok(
          "P1.6",
          "verification, representation, authorisation, agreement, activity and outcome are separate records",
          o.ledgerRecordTypes,
          (v) =>
            [
              "verification",
              "representation-assessment",
              "authorisation-decision",
              "agreement",
              "activity",
              "outcome",
            ].every((t) => (v as string[]).includes(t)),
          "all six record types present",
        );
        return {
          transitions: { alice: o.alice.transitions, bob: o.bob.transitions },
          trace: o.trace,
          holds: o.holds,
          recordTypes: o.ledgerRecordTypes,
        };
      },
    ),
  );

  add(
    await scenario(
      {
        id: "P2",
        title: "Same negotiation carried only as Gmail raw payloads (email binding)",
        useCase: "binding parity",
        requirements: ["R12", "R14"],
        competency: [],
        evidenceLevel: `${EVIDENCE}; MIME generated and parsed locally, NOT sent through Gmail`,
        limitations: ["no live provider round trip"],
      },
      async (c) => {
        const o = await caseEmailParity();
        c.eq(
          "P2.1",
          "every hop accepted with human/structured parity",
          o.hops.every((h) => h.disposition === "accepted" && h.parity === "match" && h.checks),
          true,
        );
        c.eq(
          "P2.2",
          "both sides completed",
          [o.alicePhase, o.bobPhase],
          ["completed", "completed"],
        );
        c.eq(
          "P2.3",
          "same terms digest and slot as the direct binding",
          [o.sameTermsDigestAsDirect, o.sameSelectionAsDirect],
          [true, true],
        );
        return o;
      },
    ),
  );

  add(
    await scenario(
      {
        id: "P3",
        title: "No mutually acceptable slot",
        useCase: "mismatch",
        requirements: ["R09"],
        competency: [],
        evidenceLevel: EVIDENCE,
        limitations: [],
      },
      async (c) => {
        const o = await caseMismatch();
        c.eq(
          "P3.1",
          "explicit refusal with a reason; nothing booked",
          [o.alice.phase, o.alice.closedReason, o.holds],
          ["refused", "no-acceptable-slot", 0],
        );
        return o;
      },
    ),
  );

  add(
    await scenario(
      {
        id: "P4",
        title: "A fee turns acceptance into a payment the scheduling mandate does not grant",
        useCase: "refusal",
        requirements: ["R02", "R07", "R24"],
        competency: ["CT-05"],
        evidenceLevel: EVIDENCE,
        limitations: [],
      },
      async (c) => {
        const o = await caseFeeRefused();
        c.eq(
          "P4.1",
          "responder's executor denies the compensate action",
          o.bobDecision.outcome,
          "deny",
        );
        c.eq(
          "P4.2",
          "initiator sees a refusal, no hold",
          [o.alice.phase, o.alice.closedReason, o.holds],
          ["refused", "not-authorised", 0],
        );
        return o;
      },
    ),
  );

  add(
    await scenario(
      {
        id: "P5",
        title: "Tampering, replay and wrong audience",
        useCase: "integrity/authentication",
        requirements: ["R05", "R09", "R15"],
        competency: ["CT-02"],
        evidenceLevel: EVIDENCE,
        limitations: [],
      },
      async (c) => {
        const o = await caseTamperReplayAudience();
        c.eq("P5.1", "tampered terms rejected by signature check; nothing booked", o.tampered, {
          disposition: "rejected",
          reason: "bad-signature",
          holds: 0,
        });
        c.eq(
          "P5.2",
          "replayed acceptance is a duplicate: prior responses, no second hold",
          [o.replay.disposition, o.replay.holdsAfter],
          ["duplicate", 1],
        );
        c.eq(
          "P5.3",
          "message redirected to another agent that pins the sender is rejected",
          [o.wrongAudience.disposition, o.wrongAudience.reason, o.wrongAudience.carolHolds],
          ["rejected", "wrong-audience", 0],
        );
        return o;
      },
    ),
  );

  add(
    await scenario(
      {
        id: "P6",
        title: "Expired own mandate; expired peer representation",
        useCase: "mandate bounds",
        requirements: ["R02", "R10"],
        competency: ["CT-09"],
        evidenceLevel: EVIDENCE,
        limitations: ["owner key colocated with the agent in the pilot"],
      },
      async (c) => {
        const o = await caseMandateAndRepresentation();
        c.eq(
          "P6.1",
          "own mandate expired: only discovery happens, no proposal sent",
          o.ownMandateExpired.sentKinds,
          ["describe", "description"],
        );
        c.ok(
          "P6.2",
          "conversation closed locally citing the expired mandate",
          o.ownMandateExpired.closedReason,
          (v) => String(v).includes("mandate-invalid: expired"),
          "mandate-invalid: expired",
        );
        c.eq(
          "P6.3",
          "peer refuses an expired representation statement",
          [o.peerRepresentationExpired.phase, o.peerRepresentationExpired.closedReason],
          ["refused", "representation-expired"],
        );
        return o;
      },
    ),
  );

  add(
    await scenario(
      {
        id: "P7",
        title: "No common configuration (Ed25519 vs P-256)",
        useCase: "configuration selection",
        requirements: ["R20", "R22"],
        competency: [],
        evidenceLevel: EVIDENCE,
        limitations: [],
      },
      async (c) => {
        const o = await caseConfigurationMismatch();
        c.eq(
          "P7.1",
          "explicit unsupported outcome, not a silent downgrade",
          [o.phase, o.closedReason],
          ["unsupported", "unsupported-configuration"],
        );
        return o;
      },
    ),
  );

  add(
    await scenario(
      {
        id: "P8",
        title: "Timeout after commit, process restart, redelivery, reconciliation",
        useCase: "reliability",
        requirements: ["R09"],
        competency: ["CT-09"],
        evidenceLevel: `${EVIDENCE}; file-backed state and ledger`,
        limitations: ["single process per agent state"],
      },
      async (c) => {
        const o = await caseUncertainAndRestart();
        c.eq(
          "P8.1",
          "uncertain outcome is visible before reconciliation",
          o.beforeCrash.phase,
          "uncertain",
        );
        c.eq(
          "P8.2",
          "every redelivered message after restart is a duplicate",
          o.redeliveriesAfterRestart,
          ["duplicate"],
        );
        c.eq(
          "P8.3",
          "reconciliation (not retry) concludes: exactly one hold each, both completed",
          [o.holdsAfter, o.after.alice.phase, o.after.bob.phase],
          [{ alice: 1, bob: 1 }, "completed", "completed"],
        );
        return o;
      },
    ),
  );

  add(
    await scenario(
      {
        id: "P9",
        title: "Owner approval bound to one exact action",
        useCase: "human decision",
        requirements: ["R10"],
        competency: [],
        evidenceLevel: EVIDENCE,
        limitations: ["approval is scripted in the demo"],
      },
      async (c) => {
        const o = await caseApproval();
        c.eq(
          "P9.1",
          "approval for a different action releases nothing",
          [o.pendingBefore, o.staleReleased],
          [1, 0],
        );
        c.eq(
          "P9.2",
          "each distinct action needs its own approval (offer, then acceptance of the counter-offer); the meeting completes",
          [o.released, o.final.phase],
          [[["propose"], ["accept", "receipt"]], "completed"],
        );
        return o;
      },
    ),
  );

  add(
    await scenario(
      {
        id: "M",
        title: "Mortgage: consumer → lender intake → internal PEP → underwriter; valuation fee",
        useCase: "UC-01",
        requirements: ["R02", "R04", "R05", "R06", "R07", "R08", "R10", "R24"],
        competency: ["CT-02", "CT-03", "CT-05", "CT-07", "CT-09"],
        evidenceLevel: EVIDENCE,
        limitations: [
          "synthetic lender/underwriter/issuers",
          "indicative eligibility only",
          "payment rail synthetic: settlement never observed",
        ],
      },
      async (c) => {
        const { obs, trace } = await runMortgage(fixedClock("2026-10-05T09:00:00Z"));
        const checked = (obs.intakeReceipt as { checked: Array<Record<string, unknown>> }).checked;
        c.eq(
          "M.1",
          "lender with an incompatible evidence model: explicit unsupported",
          obs.valley,
          { phase: "unsupported", reason: "unsupported-term" },
        );
        c.eq(
          "M.2",
          "a different-terms approval does not release the disclosure",
          obs.staleApprovalReleased,
          false,
        );
        c.eq(
          "M.3",
          "payroll and deposit accepted; valuer-signed income not authoritative; tampered copy invalid",
          checked.map((x) => [
            x.id ?? "(unparsed)",
            x.integrity,
            x.sourceAuthority ?? null,
            x.accepted,
          ]),
          [
            ["urn:awp:evidence:payroll-2026-09", "valid", "accepted", true],
            ["urn:awp:evidence:deposit-2026-09", "valid", "accepted", true],
            ["urn:awp:evidence:valuer-income", "valid", "not-accepted", false],
            ["(unparsed)", "invalid", null, false],
          ],
        );
        c.eq(
          "M.4",
          "12-month series annualised under the accepted rule",
          (obs.intakeReceipt as { derived: { annualGrossIncome: number } }).derived
            .annualGrossIncome,
          90000,
        );
        const pep = obs.pep as {
          assessment: string;
          marketing: { decision: string };
          marketingRelabelled: { decision: string };
          brokerOnward: string;
          underwriterOnward: string;
        };
        c.eq(
          "M.5",
          "PEP: assessment permitted; marketing denied by the consumer's terms; relabelled purpose denied by internal delegation; broker onward denied; underwriter onward permitted",
          [
            pep.assessment,
            pep.marketing.decision,
            pep.marketingRelabelled.decision,
            pep.brokerOnward,
            pep.underwriterOnward,
          ],
          ["permit", "deny", "deny", "deny", "permit"],
        );
        c.eq("M.6", "org-to-org underwriting completed on both sides", obs.underwriting, {
          lenderPhase: "completed",
          underwriterPhase: "completed",
          result: "pass",
          sourceAuthority: "accepted",
        });
        c.eq(
          "M.7",
          "consumer receives final application state (indicative, not approval)",
          obs.finalState,
          { samPhase: "completed", lenderPhase: "completed", decided: "indicatively-eligible" },
        );
        c.eq(
          "M.8",
          "fee: scheduling-only mandate denies; consumer mandate needs approval; instruction submitted, settlement unknown, obligation unresolved",
          obs.valuation,
          {
            underSchedulingOnlyMandate: "deny",
            samDecisionBeforeApproval: "approval-required",
            instruction: "submitted",
            settlement: "unknown",
            fulfilmentConclusion: "unresolved",
            samPhase: "completed",
          },
        );
        c.eq(
          "M.9",
          "after the retention period the same internal read is denied",
          obs.afterRetention,
          "deny",
        );
        c.eq("M.10", "all runtime and PEP ledgers verify", obs.ledgers, {
          sam: true,
          northbank: true,
          underwriter: true,
          northbankPep: true,
        });
        return { ...obs, trace };
      },
    ),
  );

  add(
    await scenario(
      {
        id: "E",
        title: "Public energy-plan comparison without requester identity",
        useCase: "UC-03",
        requirements: ["R04", "R06", "R12", "R19", "R23"],
        competency: ["CT-11"],
        evidenceLevel: EVIDENCE,
        limitations: [
          "synthetic retailers and tariffs",
          "CDS-like subset, not CDS conformant",
          "no public endpoint called",
        ],
      },
      async (c) => {
        const { obs, trace } = await runEnergy(fixedClock("2026-10-05T09:00:00Z").now);
        c.eq(
          "E.1",
          "endpoint outcomes: two served; credential-gated and old-version endpoints isolated as incompatibilities",
          obs.outcomes,
          {
            "southern-current": { phase: "completed", reason: "delivered" },
            "harbour-light": { phase: "completed", reason: "delivered" },
            "gated-power": { phase: "refused", reason: "credentials-required" },
            "oldschema-energy": { phase: "unsupported", reason: "unsupported-term" },
          },
        );
        c.eq(
          "E.2",
          "every comparator request unsigned, anonymous, evidence-free",
          obs.identityFreeRequests,
          true,
        );
        c.eq(
          "E.3",
          "services performed no representation or authorisation checks and no effects",
          [obs.serviceRepresentationChecks, obs.serviceAuthorisationDecisions, obs.effects],
          [0, 0, 0],
        );
        c.eq(
          "E.4",
          "malformed tariff rejected by validation",
          obs.rejected.map((r) => r.planId),
          ["HL-BROKEN-1"],
        );
        c.eq(
          "E.5",
          "ranking with hand-checked annual estimates (AUD)",
          obs.ranked.map((r) => [r.planId, r.estimateAudPerYear]),
          [
            ["HL-FLAT-2", 1694.36],
            ["SC-BASIC-1", 1753.83],
            ["SC-TOU-1", 1788.5],
          ],
        );
        c.eq(
          "E.6",
          "missing eligibility and conflicting versions excluded with reasons",
          obs.excluded.map((e) => e.planId),
          ["SC-SOLAR-1", "HL-FLAT-3", "HL-FLAT-3"],
        );
        c.eq(
          "E.7",
          "deterministic; every ranked plan cites its signed source message",
          [obs.deterministic, obs.citationsComplete, obs.ledgers],
          [true, true, true],
        );
        return { ...obs, trace };
      },
    ),
  );

  add(
    await scenario(
      {
        id: "H",
        title: "Synthetic patient-authorised FHIR summary",
        useCase: "UC-04",
        requirements: ["R01", "R02", "R04", "R07", "R11", "R19"],
        competency: ["CT-05", "CT-08", "CT-09"],
        evidenceLevel: EVIDENCE,
        limitations: [
          "SMART-like pattern only; no OAuth/PKCE exchange",
          "no Inferno run",
          "hand-authored synthetic resources",
        ],
      },
      async (c) => {
        const { obs, trace } = await runFhir(fixedClock("2026-10-05T09:00:00Z"));
        const summary = obs.summary as Array<{ text: string; status: string; cites: string[] }>;
        c.eq("H.1", "clinic without S256 stopped before any request", obs.birch, {
          phase: "unsupported",
          reason: "unsupported-term",
          proposalsSent: 0,
        });
        c.eq(
          "H.2",
          "requested 5 scopes, patient approved 4, 4 granted",
          [
            (obs.authorisation as { requested: unknown[] }).requested.length,
            (obs.authorisation as { approvedByPatient: unknown[] }).approvedByPatient.length,
            (obs.authorisation as { granted: unknown[] }).granted.length,
          ],
          [5, 4, 4],
        );
        c.eq(
          "H.3",
          "reads: three delivered, Observation refused (insufficient-scope); zero out-of-scope successes",
          [obs.reads, obs.outOfScopeSuccessfulReads],
          [
            {
              Patient: { phase: "completed", reason: "delivered" },
              MedicationRequest: { phase: "completed", reason: "delivered" },
              AllergyIntolerance: { phase: "completed", reason: "delivered" },
              Observation: { phase: "refused", reason: "insufficient-scope" },
            },
            0,
          ],
        );
        c.eq(
          "H.4",
          "writes: blocked by CareBrief's own mandate; rogue write unsupported; stolen grant key-bound",
          obs.writes,
          {
            careBriefWriteSent: 0,
            careBriefLocalDecision: "indeterminate",
            rogueWrite: { phase: "unsupported", reason: "unsupported-operation" },
            stolenGrant: { phase: "refused", reason: "grant-invalid" },
          },
        );
        c.eq(
          "H.5",
          "summary: conflicting medication records left unresolved; every statement cites resource/version",
          [
            summary.find((s) => s.text.startsWith("atorvastatin"))?.status,
            summary.every(
              (s) => s.cites.length > 0 && s.cites.every((x) => x.includes("/_history/")),
            ),
          ],
          ["unresolved", true],
        );
        c.eq("H.6", "after the patient revokes, reads fail", obs.afterRevocation, {
          phase: "refused",
          reason: "grant-revoked",
        });
        c.eq(
          "H.7",
          "resource-server audit has no clinical payload; ledgers verify",
          [obs.auditMinimised, obs.ledgers],
          [true, true],
        );
        return { ...obs, trace };
      },
    ),
  );

  add(
    await scenario(
      {
        id: "I",
        title:
          "Industrial maintenance data: eligibility, delegation, agreement, transfer, use, performance",
        useCase: "UC-05",
        requirements: ["R01", "R04", "R06", "R07", "R08", "R09", "R14", "R20", "R24"],
        competency: ["CT-03", "CT-06", "CT-07", "CT-10"],
        evidenceLevel: EVIDENCE,
        limitations: [
          "synthetic organisations and programme",
          "no Tractus-X/EDC connector",
          "post-transfer control limited to NordWerk's own enforcement point",
        ],
      },
      async (c) => {
        const { obs, trace } = await runIndustrial(fixedClock("2026-10-05T09:00:00Z"));
        c.eq(
          "I.1",
          "Alpine authority refuses an unlisted recipient; issues for NordWerk",
          [obs.authorisationForUnlistedRecipient, obs.authorisationForNordWerk],
          [
            { phase: "refused", reason: "not-authorised" },
            { phase: "completed", reason: "delivered", issued: true },
          ],
        );
        c.eq(
          "I.2",
          "restricted catalogue: offer invisible without a participant credential",
          obs.withoutCredential,
          { phase: "unsupported", reason: "unsupported-operation" },
        );
        c.eq(
          "I.3",
          "valid credential but no internal delegation to contract → refused",
          obs.contractByDiagnosticAgent,
          { phase: "refused", reason: "representation-out-of-scope" },
        );
        c.eq("I.4", "purpose outside the user's authorisation → refused", obs.purposeMismatch, {
          phase: "refused",
          reason: "purpose-not-permitted",
        });
        c.eq(
          "I.5",
          "transfer before agreement refused locally and by the holder; nothing transferred",
          obs.transferBeforeAgreement,
          {
            initiator: "no-agreement",
            holderReply: "refuse",
            holderReason: "no-agreement",
            transfersPerformed: 0,
          },
        );
        c.eq(
          "I.6",
          "failed transfer leaves an accepted agreement with nothing delivered",
          obs.afterFailedTransfer,
          { phase: "agreed", delivered: 0 },
        );
        c.eq(
          "I.7",
          "retry delivers; redelivered request is a duplicate; telemetry source accepted",
          obs.transfer,
          {
            attempts: ["not-executed", "delivered"],
            consumerPhase: "completed",
            holderPhase: "completed",
            duplicate: "duplicate",
            sourceAuthority: "accepted",
          },
        );
        c.eq(
          "I.8",
          "consumer PEP: diagnostic read permitted; product development and redistribution denied",
          obs.usage,
          { diagnosticRead: "permit", productDevelopmentRead: "deny", redistribution: "deny" },
        );
        c.eq(
          "I.9",
          "recommendation accepted → work order created; performance recorded separately",
          [obs.recommendation, obs.performance],
          [
            { alpinePhase: "completed", nordwerkPhase: "completed", workOrder: "open" },
            "completed-synthetic",
          ],
        );
        c.eq("I.10", "ledgers verify", obs.ledgers, true);
        return { ...obs, trace };
      },
    ),
  );

  add(
    await scenario(
      {
        id: "C",
        title: "Remembered conventional scheduling service (UC-02 / R25)",
        useCase: "UC-02",
        requirements: ["R02", "R09", "R10", "R15", "R25"],
        competency: ["CT-09"],
        evidenceLevel: `${EVIDENCE}; provider is a LOCAL reference HTTP service on 127.0.0.1 (a stand-in, not Calendly)`,
        limitations: [
          "no real Calendly or provider API is called or supported",
          "no real appointment is created",
          "owner confirmations are scripted",
        ],
      },
      async (c) => {
        const { obs } = await runConventional(fixedClock("2026-10-19T08:00:00Z"));
        c.eq(
          "C.1",
          "a first-contact link is only a candidate; booking is blocked until the owner confirms",
          [obs.firstContact, obs.beforeConfirmation, obs.confirmed],
          [{ candidates: 1, status: "candidate", forwarded: false }, "blocked", "accepted"],
        );
        c.eq(
          "C.2",
          "deterministic slot choice honours 10:00–16:00 London across the DST change; no message or email is generated",
          obs.bookings,
          {
            bst: "2026-10-20T09:00:00.000Z",
            gmt: "2026-10-26T10:00:00.000Z",
            outboundMessages: 0,
            emailsGenerated: 0,
          },
        );
        c.eq("C.3", "repeating a request does not book again", obs.repeatSameRequest, {
          status: "booked",
          newProviderPosts: 0,
          providerBookings: 2,
        });
        c.eq(
          "C.4",
          "poisoned links are rejected by the registry and nothing else is contacted",
          [
            (obs.poisoned as { rejected: string[] }).rejected,
            (obs.poisoned as { canaryHits: number }).canaryHits,
            obs.canaryHitsTotal,
          ],
          [
            [
              "ip-literal",
              "unsupported-scheme",
              "unsupported-host",
              "credentials-in-url",
              "unsupported-port",
              "unsupported-query",
              "non-canonical-url",
            ],
            0,
            0,
          ],
        );
        c.eq(
          "C.5",
          "a forwarded claim neither replaces nor blocks the accepted association; a same-sender conflict disputes it until the owner decides",
          [
            obs.forwarded,
            (obs.dispute as { disputed: boolean }).disputed,
            (obs.dispute as { booking: string }).booking,
            (obs.dispute as { afterReconfirm: string }).afterReconfirm,
          ],
          [
            { forwarded: true, candidateContact: "sam@example.net", mateoStatus: "accepted" },
            true,
            "blocked",
            "accepted",
          ],
        );
        c.eq(
          "C.6",
          "uncertain bookings are reconciled with the provider, never duplicated",
          obs.uncertain,
          {
            afterCommit: {
              first: "uncertain",
              providerBookingsAfterTimeout: 3,
              afterRecovery: "booked",
            },
            beforeCommit: {
              first: "uncertain",
              providerBookingsBeforeRetry: 3,
              afterRecovery: "booked",
            },
            duplicateProviderBookings: 0,
          },
        );
        c.eq(
          "C.7",
          "changed service terms and expiry block use; an unlisted contact needs owner approval",
          [
            (obs.stale as { status: string }).status,
            (obs.expired as { booking: string }).booking,
            obs.unlistedContact,
          ],
          ["changed", "blocked", { booking: "pending-approval" }],
        );
        return obs;
      },
    ),
  );

  const all = scenarios.flatMap((s) => s.checks);
  return {
    report: "Agentic Web pilot profile — local demo report",
    profile: { id: PILOT_PROFILE, version: PILOT_PROFILE_VERSION },
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      commit: gitCommit(),
      boundary:
        "local-simulation: in-process agents, direct binding and locally generated/parsed MIME; no network, no provider, no live mailbox",
      llm: "none — every step is deterministic code",
      keys: "fresh synthetic keys generated per run; none persisted except in a temporary directory deleted after scenario P8",
    },
    claimsNotMade: [
      "independent interoperation",
      "CDMC compliance",
      "legal effect",
      "production readiness",
      "CDS / SMART / Inferno / Catena-X / Data Act conformance",
      "live Gmail round trip",
    ],
    summary: {
      scenarios: scenarios.length,
      checks: all.length,
      passed: all.filter((x) => x.pass).length,
      failed: all.filter((x) => !x.pass).length,
    },
    scenarios,
    configurations: Object.values(CONFIGURATIONS),
    termRegister: TERM_REGISTER,
    matrix: { parts: PARTS, requirements: REQUIREMENTS, competency: COMPETENCY },
  };
}
