/**
 * UC-01 executable workflow: Sam's personal agent, North Bank (intake + internal agents +
 * enforcement point), Valley Bank (incompatible evidence model) and an underwriting
 * service. Every step below is a real message through the shared runtime with real
 * signatures, source-authority rules, mandate decisions and PEP decisions; the driver
 * only routes messages and plays the scripted human/organisational decisions (Sam's
 * approvals, which internal agents ask for what).
 */

import { DirectBus } from "../bindings/direct.js";
import { digestOf } from "../core/canonical.js";
import type { ActionIntent, Iri, JsonObject } from "../core/types.js";
import {
  applicationTermsFor,
  ConsumerMortgageHandler,
  ConsumerValuationHandler,
  LenderPrequalHandler,
  LenderUnderwritingHandler,
  LenderValuationHandler,
  MODEL_ANNUAL,
  MODEL_MONTHLY,
  PREQUAL_OP,
  SyntheticPaymentRail,
  UNDERWRITING_OP,
  UnderwriterHandler,
  UW_MODEL,
  underwritingTermsFor,
  VALUATION_MODEL,
  VALUATION_OP,
  valuationTermsFor,
} from "../domains/mortgage.js";
import { PurposeBoundStore } from "../domains/purpose-store.js";
import { PAYMENT_OP } from "../domains/scheduling.js";
import {
  DATA_BROKER,
  DEPOSIT_BANK,
  lenderInternalRoles,
  lenderMandate,
  lenderSourceRules,
  NB_ASSESS,
  NB_MARKETING,
  NORTH,
  newSyntheticIssuers,
  PAYROLL,
  SAM,
  SAM_POLICY,
  samMortgageMandate,
  samWallet,
  UW,
  underwriterMandate,
  underwriterSourceRules,
  VALLEY,
  VALUER,
  valleyMandate,
} from "../fixtures/mortgage.js";
import { schedulingMandate } from "../mandates.js";
import { evaluateIntent } from "../mechanisms/mandate.js";
import { PURPOSE } from "../profile/vocabulary.js";
import { verifyLedger } from "../store/ledger.js";
import { Cast } from "./common.js";
import { scenarioPolicyEngine } from "./policy.js";

export {
  NORTH,
  SAM,
  samMortgageMandate,
  UW,
  VALLEY,
} from "../fixtures/mortgage.js";

export async function runMortgage(clock: { now: () => Date; advance: (ms: number) => void }) {
  const now = clock.now;
  const cast = new Cast(now);
  await cast.add(SAM, samMortgageMandate(), [PREQUAL_OP.id, VALUATION_OP.id]);
  await cast.add(NORTH, lenderMandate(), [PREQUAL_OP.id, UNDERWRITING_OP.id, VALUATION_OP.id]);
  await cast.add(VALLEY, valleyMandate(), [PREQUAL_OP.id]);
  await cast.add(UW, underwriterMandate(), [UNDERWRITING_OP.id]);
  cast.introduce("sam", "northbank-intake");
  cast.introduce("sam", "valleybank-intake");
  cast.introduce("northbank-intake", "underwriter");

  const issuers = await newSyntheticIssuers();
  for (const [iri, key] of [
    [PAYROLL, issuers.payroll],
    [DEPOSIT_BANK, issuers.deposit],
    [VALUER, issuers.valuer],
  ] as const) {
    cast.pinIssuer(
      "northbank-intake",
      iri,
      key,
      "synthetic issuer pinned by North Bank's onboarding",
    );
  }
  const until = new Date(now().getTime() + 365 * 86_400_000).toISOString();
  for (const rule of lenderSourceRules(until)) cast.rule("northbank-intake", rule);
  for (const rule of underwriterSourceRules(until)) cast.rule("underwriter", rule);

  // Sam's wallet: payroll series, deposit balance, plus adversarial fixtures (an income
  // statement signed by the property valuer, and a tampered copy of the deposit statement).
  const wallet = await samWallet(issuers);

  const nbStore = new PurposeBoundStore(
    NORTH.party,
    lenderInternalRoles(),
    now,
    scenarioPolicyEngine(),
  );
  const payments = new SyntheticPaymentRail();
  const sam = await cast.runtime(
    "sam",
    [
      new ConsumerMortgageHandler(wallet, {
        ...SAM_POLICY,
        requireProhibited: [...SAM_POLICY.requireProhibited],
        allowedOnward: [...SAM_POLICY.allowedOnward],
      }),
      new ConsumerValuationHandler(),
    ],
    [payments],
  );
  const nb = await cast.runtime("northbank-intake", [
    new LenderPrequalHandler({
      lender: NORTH.party,
      underwriter: UW.party,
      acceptedModels: [MODEL_MONTHLY],
      retentionDays: 90,
      store: nbStore,
    }),
    new LenderUnderwritingHandler(),
    new LenderValuationHandler(),
  ]);
  const vb = await cast.runtime("valleybank-intake", [
    new LenderPrequalHandler({
      lender: VALLEY.party,
      underwriter: UW.party,
      acceptedModels: [MODEL_ANNUAL],
      retentionDays: 90,
      store: new PurposeBoundStore(VALLEY.party, [], now, scenarioPolicyEngine()),
    }),
  ]);
  const uw = await cast.runtime("underwriter", [new UnderwriterHandler()]);
  const bus = new DirectBus().register(sam.runtime, nb.runtime, vb.runtime, uw.runtime);
  const obs: Record<string, unknown> = {};
  const application = applicationTermsFor(SAM.party, 450000, 380000);

  // 1. Comparison: Valley Bank accepts only an annual-income model; no silent mapping.
  const toValley = await sam.runtime.startNegotiation({
    peer: { actor: VALLEY.actor, party: VALLEY.party },
    operation: PREQUAL_OP,
    terms: application,
    models: [MODEL_MONTHLY],
  });
  bus.send(sam.runtime, toValley);
  await bus.run();
  const vConv = sam.runtime.conversation(toValley.conversation as string);
  obs.valley = { phase: vConv?.phase, reason: vConv?.closedReason };

  // 2. Application to North Bank → bounded evidence request (counter) → approval needed.
  const toNorth = await sam.runtime.startNegotiation({
    peer: { actor: NORTH.actor, party: NORTH.party },
    operation: PREQUAL_OP,
    terms: application,
    models: [MODEL_MONTHLY],
  });
  const conv = toNorth.conversation as string;
  bus.send(sam.runtime, toNorth);
  await bus.run();
  const pending = sam.runtime.pendingApprovals();
  obs.pendingApproval = pending.map((x) => ({
    action: x.intent.action,
    target: x.intent.target,
    recipient: x.intent.recipient,
    purpose: x.intent.purpose,
  }));
  obs.phaseBeforeApproval = sam.runtime.conversation(conv)?.phase;

  // 2a. An approval for different terms (e.g. longer retention) does not release this action.
  const pendingDigest = pending[0]?.actionDigest as string;
  const differentIntent = {
    ...(pending[0]?.intent as ActionIntent),
    parameters: { ...(pending[0]?.intent.parameters as JsonObject), retentionDays: 365 },
  };
  const stale = await sam.runtime.submitApproval(
    await cast.approval("sam", digestOf(differentIntent), conv),
  );
  obs.staleApprovalReleased = stale.outbound.length > 0;

  // 3. Sam approves the exact action → accept → deliver (relayed issuer statements).
  const approved = await sam.runtime.submitApproval(
    await cast.approval("sam", pendingDigest, conv),
  );
  bus.send(sam.runtime, approved);
  await bus.run();
  const intakeReceipt = sam.runtime.domainState(
    `${PREQUAL_OP.id}@${PREQUAL_OP.version}:application-state:${conv}`,
  ) as JsonObject | undefined;
  obs.intakeReceipt = intakeReceipt;

  // 4. Internal purpose-limited use at North Bank's enforcement point.
  const stored = nbStore.ids();
  const derivedId = stored.find((id) => id.endsWith("#annualised")) as string;
  const depositId = "urn:awp:evidence:deposit-2026-09";
  const assessment = nbStore.request({
    agent: NB_ASSESS,
    action: "read",
    items: [derivedId, depositId],
    purpose: PURPOSE.creditChecking,
  });
  const marketing = nbStore.request({
    agent: NB_MARKETING,
    action: "read",
    items: [derivedId],
    purpose: PURPOSE.marketing,
  });
  const marketingRelabelled = nbStore.request({
    agent: NB_MARKETING,
    action: "read",
    items: [derivedId],
    purpose: PURPOSE.creditChecking,
  });
  const broker = nbStore.request({
    agent: NORTH.actor,
    action: "distribute",
    items: [derivedId],
    purpose: PURPOSE.creditChecking,
    recipient: DATA_BROKER,
  });
  const onward = nbStore.request({
    agent: NORTH.actor,
    action: "distribute",
    items: [derivedId, depositId],
    purpose: PURPOSE.creditChecking,
    recipient: UW.party,
  });
  obs.pep = {
    assessment: assessment.decision,
    marketing: { decision: marketing.decision, reason: marketing.reason },
    marketingRelabelled: {
      decision: marketingRelabelled.decision,
      reason: marketingRelabelled.reason,
    },
    brokerOnward: broker.decision,
    underwriterOnward: onward.decision,
  };
  const annualData = assessment.items?.find((i) => i.id === derivedId)?.data as { value: number };
  const depositData = assessment.items?.find((i) => i.id === depositId)?.data as {
    balance: number;
  };
  const annual = annualData.value;
  const depositValue = depositData.balance;
  const indicative =
    380000 / annual <= 4.5 && depositValue >= 450000 - 380000
      ? "indicatively-eligible"
      : "not-eligible";

  // 5. Organisation-to-organisation underwriting under an attenuated, distinct grant.
  const agreementId = sam.runtime.conversation(conv)?.agreement as Iri;
  const uwTerms = underwritingTermsFor({
    applicationRef: `${conv}#application`,
    annualGrossIncome: annual,
    derivedFrom: [derivedId],
    depositBalance: depositValue,
    loanAmount: 380000,
    propertyPrice: 450000,
    consumerAgreement: agreementId,
    onwardRule: `${agreementId}#onward-0`,
    lender: NORTH.party,
  });
  const toUw = await nb.runtime.startNegotiation({
    peer: { actor: UW.actor, party: UW.party },
    operation: UNDERWRITING_OP,
    terms: uwTerms as unknown as JsonObject,
    models: [UW_MODEL],
  });
  bus.send(nb.runtime, toUw);
  await bus.run();
  const uwConv = toUw.conversation as string;
  const uwResult = nb.runtime.domainState(
    `${UNDERWRITING_OP.id}@${UNDERWRITING_OP.version}:uw-result:${uwConv}`,
  ) as JsonObject | undefined;
  obs.underwriting = {
    lenderPhase: nb.runtime.conversation(uwConv)?.phase,
    underwriterPhase: uw.runtime.conversation(uwConv)?.phase,
    result: uwResult?.result,
    sourceAuthority: uwResult?.sourceAuthority,
  };

  // 6. Final application-state receipt to Sam (received / checked / decided, not approval).
  const final = await nb.runtime.sendReceipt(conv, {
    activity: `${conv}#decision`,
    outcome: "completed",
    final: true,
    observed: {
      stage: "decided",
      received: intakeReceipt?.received ?? 0,
      checked: intakeReceipt?.checked ?? [],
      decided: {
        status: indicative,
        by: NORTH.party,
        basis: "synthetic prequalification rule; indicative only",
      },
      underwriting: { result: uwResult?.result ?? "none", by: UW.party },
      notClaimed: ["loan approval", "truth of evidence", "complete financial picture"],
    },
  });
  bus.send(nb.runtime, final);
  await bus.run();
  obs.finalState = {
    samPhase: sam.runtime.conversation(conv)?.phase,
    lenderPhase: nb.runtime.conversation(conv)?.phase,
    decided: indicative,
  };

  // 7. Valuation branch: a fee is a payment action; scheduling permission cannot cover it.
  const aliceLikeMandate = schedulingMandate([NORTH.party])({
    owner: SAM.party,
    actor: SAM.actor,
    validFrom: now().toISOString(),
    validUntil: new Date(now().getTime() + 86_400_000).toISOString(),
  });
  const feeIntentProbe: ActionIntent = {
    operation: VALUATION_OP.id,
    action: "compensate",
    target: PAYMENT_OP,
    purpose: PURPOSE.mortgagePrequalification,
    recipient: NORTH.party,
    parameters: { amount: 450, currency: "USD" },
    conversation: "urn:awp:probe",
  };
  const underSchedulingOnly = evaluateIntent({
    loaded: {
      mandate: aliceLikeMandate,
      digest: digestOf(aliceLikeMandate),
      verification: {
        type: "verification",
        protectedObject: "n/a",
        property: "integrity-and-key-attribution",
        mechanism: "probe",
        verifier: SAM.actor,
        at: now().toISOString(),
        outcome: "valid",
        limitations: ["probe of policy semantics only"],
      },
    },
    intent: feeIntentProbe,
    decider: SAM.actor,
    at: now().toISOString(),
    ...(scenarioPolicyEngine() ? { engine: scenarioPolicyEngine() } : {}),
  });
  const toSamValuation = await nb.runtime.startNegotiation({
    peer: { actor: SAM.actor, party: SAM.party },
    operation: VALUATION_OP,
    terms: valuationTermsFor(`${conv}#application`, VALUER, 450),
    models: [VALUATION_MODEL],
  });
  const vconv = toSamValuation.conversation as string;
  bus.send(nb.runtime, toSamValuation);
  await bus.run();
  const feePending = sam.runtime.pendingApprovals().find((x) => x.conversation === vconv);
  const feeApproved = feePending
    ? await sam.runtime.submitApproval(await cast.approval("sam", feePending.actionDigest, vconv))
    : undefined;
  if (feeApproved) bus.send(sam.runtime, feeApproved);
  await bus.run();
  const fulfilment = nb.ledger
    .entries()
    .find((e) => e.record.type === "fulfilment-assessment")?.record;
  obs.valuation = {
    underSchedulingOnlyMandate: underSchedulingOnly.outcome,
    samDecisionBeforeApproval: feePending ? "approval-required" : "none",
    instruction: [...payments.instructions.values()][0]?.status,
    settlement: [...payments.instructions.values()][0]?.settlement,
    fulfilmentConclusion: fulfilment?.conclusion,
    samPhase: sam.runtime.conversation(vconv)?.phase,
  };

  // 8. Retention period ends: the same internal read is now refused.
  clock.advance(91 * 86_400_000);
  obs.afterRetention = nbStore.request({
    agent: NB_ASSESS,
    action: "read",
    items: [derivedId],
    purpose: PURPOSE.creditChecking,
  }).decision;

  obs.ledgers = {
    sam: verifyLedger(sam.ledger.entries()).ok,
    northbank: verifyLedger(nb.ledger.entries()).ok,
    underwriter: verifyLedger(uw.ledger.entries()).ok,
    northbankPep: verifyLedger(nbStore.auditEntries()).ok,
  };
  obs.pepAudit = nbStore.audit().map((e) => e.record);
  return {
    obs,
    trace: bus.trace,
    conversations: {
      sam: sam.runtime.conversations(),
      northbank: nb.runtime.conversations(),
      underwriter: uw.runtime.conversations(),
    },
  };
}
