// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * `mortgage-main`: the worked example end to end under the baseline configuration. Sam's agent
 * finds products through a public index (public read configuration), looks North Bank up on
 * the register chain, gets a signed balance statement from Harbour Bank after a challenge for
 * a stronger approval, and applies. As in the other reference runs the driver only routes
 * messages, labels steps and plays the scripted principal, cores and stand-in services; every
 * agent event comes from a runtime and its gates.
 */
import type { Iri, JsonObject } from "../core/types.js";
import {
  applicationTermsFor,
  ConsumerMortgageHandler,
  LenderPrequalHandler,
  MODEL_MONTHLY,
  PREQUAL_OP,
  SyntheticPaymentRail,
  VALUATION_OP,
} from "../domains/mortgage.js";
import { PurposeBoundStore } from "../domains/purpose-store.js";
import {
  lenderInternalRoles,
  lenderMandate,
  NB_ASSESS,
  NORTH,
  SAM,
  SAM_POLICY,
} from "../fixtures/mortgage.js";
import type { GateContext, PrincipalLimits } from "../gates/common.js";
import { TrustStore } from "../mechanisms/trust.js";
import { CONFIG_ED25519, CONFIG_PUBLIC } from "../profile/configurations.js";
import { AWP, PURPOSE } from "../profile/vocabulary.js";
import type { AgentRuntime, OutboundMessage } from "../runtime/agent.js";
import { Cast, signClaim } from "../scenarios/common.js";
import { BASELINE, baselineRegistry } from "../suites/baseline.js";
import { PUBLIC_READ, withPublicRead } from "../suites/public-read.js";
import type { Configuration } from "../suites/registry.js";
import { TraceRecorder } from "../trace/recorder.js";
import { TRACE_SCHEMA, type TraceAgent, type TraceFile } from "../trace/types.js";
import { type OwnListEntry, TrustResolver } from "../trust/resolver.js";
import {
  claimLabel,
  DEPOSIT_ID,
  decisionInPrinciple,
  HARBOUR,
  MORTGAGE_CONTENT,
  MORTGAGE_RELIANCE,
  PAYWELL,
  referenceLenderRules,
  referenceWallet,
  samSourceRules,
  tellSam,
} from "./fixtures.js";
import { idSource, testKey } from "./keys.js";
import {
  BALANCE_MODEL,
  BALANCE_OP,
  BalanceRequestHandler,
  BalanceStatementHandler,
  FACE_CHECK,
  faceCheckAttestation,
  HARBOUR_AGENT,
  harbourMandate,
  IDP,
  INDEX,
  indexMandate,
  mainTrustRoot,
  PRODUCT_MODEL,
  PRODUCT_QUERY,
  PRODUCT_SEARCH_OP,
  ProductIndexHandler,
  ProductSearchHandler,
  productRecord,
  samMainMandate,
} from "./main-fixtures.js";
import {
  deliver,
  name,
  REFERENCE_START,
  SAM_LIMITS,
  SCENARIOS,
  STEP_TITLES,
  stepOf,
  stepsIn,
  taskLabel,
} from "./mortgage.js";

export const MAIN_AGENTS: readonly TraceAgent[] = [
  { id: "sams-agent", name: "Sam's agent", actsFor: "sam", role: "Personal agent" },
  {
    id: "index",
    name: "Mortgage product index",
    actsFor: "index",
    role: "Aggregates lenders' signed product records",
  },
  { id: "lender", name: "North Bank", actsFor: "lender", role: "Lender" },
  {
    id: "bank",
    name: "Harbour Bank",
    actsFor: "bank",
    role: "Sam's own bank; authority for balances",
  },
];

/** Step titles for this run (built on call: this module and mortgage.ts import each other). */
const mainTitles = (): Readonly<Record<number, string>> => ({
  ...STEP_TITLES,
  3: "Sam's agent finds lenders through the index and looks North Bank up on the register",
});

export async function runMain(
  opts: { commit?: string; configuration?: Configuration } = {},
): Promise<TraceFile> {
  const configuration = opts.configuration ?? BASELINE;
  const registry = withPublicRead(baselineRegistry());
  if (registry.check(configuration).length > 0)
    throw new Error(`configuration ${configuration.id} is not runnable here`);
  let t = Date.parse(REFERENCE_START);
  const now = () => new Date(t);
  const recorder = new TraceRecorder();
  const cast = new Cast(now, {
    keys: async (agent) => ({
      owner: await testKey(`${agent}/owner`),
      actor: await testKey(`${agent}/actor`),
    }),
    ids: idSource("main"),
  });
  await cast.add(SAM, samMainMandate(), [PREQUAL_OP.id, VALUATION_OP.id, BALANCE_OP.id]);
  await cast.add(NORTH, lenderMandate(), [PREQUAL_OP.id, VALUATION_OP.id]);
  await cast.add(HARBOUR_AGENT, harbourMandate(), []);
  await cast.add(INDEX, indexMandate(), []);
  cast.introduce("sam", "northbank-intake");
  cast.introduce("sam", "harbourbank");
  // A public client pins the service's published key; the index never learns who asked.
  cast.pin("sam", "product-index");
  const issuers = {
    paywell: await testKey("paywell/issuer"),
    // Harbour Bank runs as an agent here, so its statements carry its organization key.
    harbour: cast.get("harbourbank").ownerKey,
    north: cast.get("northbank-intake").ownerKey,
    idp: await testKey("id-provider/issuer"),
  };
  for (const who of ["sam", "northbank-intake"])
    cast.pinIssuer(who, PAYWELL, issuers.paywell, "synthetic issuer pinned at onboarding");
  // Sam's agent knows Harbour Bank's and North Bank's keys from their introductions.
  cast.pinIssuer(
    "northbank-intake",
    HARBOUR,
    issuers.harbour,
    "synthetic issuer pinned at onboarding",
  );
  // OPEN-DESIGN: under the pinned-key identity suite the lenders' record keys are their
  // organization keys, pinned at introduction; whether the register should publish them is
  // left to the identity layer.
  cast.pinIssuer("harbourbank", IDP, issuers.idp, "identity provider's attestation key");
  cast.pinIssuer("sam", IDP, issuers.idp, "identity provider's attestation key");
  cast.pinIssuer(
    "product-index",
    NORTH.party,
    issuers.north,
    "lender identity key introduced to the index",
  );
  cast.pinIssuer(
    "product-index",
    HARBOUR,
    issuers.harbour,
    "lender identity key introduced to the index",
  );
  const until = new Date(t + 365 * 86_400_000).toISOString();
  for (const rule of samSourceRules(until)) cast.rule("sam", rule);
  for (const rule of referenceLenderRules(until)) cast.rule("northbank-intake", rule);
  const wallet = await referenceWallet(issuers);
  const [income, deposit] = wallet as [(typeof wallet)[0], (typeof wallet)[0]];
  const root = mainTrustRoot(REFERENCE_START);
  const products = [
    productRecord({
      lender: NORTH.party,
      slug: "northbank-fixed-5",
      name: "5-year fixed",
      ratePercent: 4.1,
      fixedYears: 5,
      maxLoanToValuePercent: 90,
    }),
    productRecord({
      lender: HARBOUR,
      slug: "harbourbank-fixed-2",
      name: "2-year fixed",
      ratePercent: 3.8,
      fixedYears: 2,
      maxLoanToValuePercent: 80,
    }),
  ];
  const records = [
    {
      record: products[0] as JsonObject,
      jws: await signClaim(issuers.north, products[0] as JsonObject),
    },
    {
      record: products[1] as JsonObject,
      jws: await signClaim(issuers.harbour, products[1] as JsonObject),
    },
  ];

  // Sam's own list: the services he chose, each for named tasks. North Bank is not on it.
  const samOwnList: OwnListEntry[] = [
    { party: INDEX.party, tasks: [PRODUCT_SEARCH_OP.id], note: "chosen product index" },
    { party: HARBOUR, tasks: [BALANCE_OP.id], note: "Sam's own bank" },
  ];
  const gates = async (
    who: string,
    sink: string,
    principal: string,
    extra: {
      limits?: PrincipalLimits;
      ownList?: OwnListEntry[];
      configuration?: Configuration;
    } = {},
  ): Promise<GateContext> => {
    const trust = await TrustStore.load(cast.trust.get(who));
    return {
      sink: recorder.sink(sink),
      configuration: extra.configuration ?? configuration,
      configurations: { [CONFIG_PUBLIC]: PUBLIC_READ },
      name,
      taskLabel,
      claimLabel: (st) => claimLabel(st, name),
      ...MORTGAGE_CONTENT,
      reliance: MORTGAGE_RELIANCE,
      tellPrincipal: tellSam,
      resolver: new TrustResolver({
        principal,
        trust,
        root,
        name,
        ...(extra.ownList ? { ownList: extra.ownList } : {}),
      }),
      ...(extra.limits ? { principalLimits: extra.limits } : {}),
    };
  };
  const nbStore = new PurposeBoundStore(NORTH.party, lenderInternalRoles(), now);
  const payments = new SyntheticPaymentRail();
  const sam = await cast.runtime(
    "sam",
    [
      new ConsumerMortgageHandler(wallet, {
        requireProhibited: [...SAM_POLICY.requireProhibited],
        maxRetentionDays: 3650,
        allowedOnward: [...SAM_POLICY.allowedOnward],
      }),
      new ProductSearchHandler(),
      new BalanceRequestHandler(),
    ],
    [payments],
    [CONFIG_ED25519, CONFIG_PUBLIC],
    { gates: await gates("sam", "sams-agent", "Sam", { limits: SAM_LIMITS, ownList: samOwnList }) },
  );
  const nb = await cast.runtime(
    "northbank-intake",
    [
      new LenderPrequalHandler({
        lender: NORTH.party,
        underwriter: "https://underwriter.example/#org",
        acceptedModels: [MODEL_MONTHLY],
        retentionDays: 60,
        store: nbStore,
      }),
    ],
    [],
    undefined,
    { gates: await gates("northbank-intake", "lender", "North Bank") },
  );
  const harbour = await cast.runtime(
    "harbourbank",
    [
      new BalanceStatementHandler(
        { id: DEPOSIT_ID, jws: deposit.jws, label: "Harbour Bank's balance at October 31, 2026" },
        {
          id: `${AWP}terms/harbourbank-deposit`,
          text: "use and share only for a mortgage application or credit assessment, never for marketing, delete within 90 days, share only with a regulated lender.",
        },
      ),
    ],
    [],
    undefined,
    { gates: await gates("harbourbank", "bank", "Harbour Bank") },
  );
  const index = await cast.runtime(
    "product-index",
    [new ProductIndexHandler(records)],
    [],
    [CONFIG_PUBLIC],
    { gates: await gates("product-index", "index", "the index", { configuration: PUBLIC_READ }) },
  );
  const byActor = new Map<Iri, AgentRuntime>([
    [SAM.actor, sam.runtime],
    [NORTH.actor, nb.runtime],
    [HARBOUR_AGENT.actor, harbour.runtime],
    [INDEX.actor, index.runtime],
  ]);
  const queue: Array<{ out: OutboundMessage }> = [];
  const none = () => undefined;

  // 1. Sam's signed mandate is loaded; every later check reads it.
  recorder.step(1);
  sam.runtime.showMandate();
  // 2. Sam asks in chat.
  recorder.step(2);
  sam.runtime.instruct(
    "I'd like a mortgage in principle for a flat: price $450,000, borrowing $380,000.",
  );
  // 3. Find products: an anonymous query to the index (public read), nothing about Sam in
  // it. Each record comes back signed by its lender and passes Sam's inbound gate.
  recorder.step(3);
  await index.runtime.admitStatements(
    records.map((record) => ({ jws: record.jws })),
    {
      task: "a product search",
      purpose: PURPOSE.productSearch,
    },
  );
  const search = await sam.runtime.startInvocation({
    peer: { actor: INDEX.actor, party: INDEX.party },
    operation: PRODUCT_SEARCH_OP,
    input: PRODUCT_QUERY,
    basis: { kind: "public" },
    purpose: PURPOSE.productSearch,
    models: [PRODUCT_MODEL],
    discover: false,
    configuration: CONFIG_PUBLIC,
  });
  for (const out of search.outbound) queue.push({ out });
  await deliver(recorder, byActor, queue, none, undefined, sam.runtime);
  // The scripted core takes the shortlisted lender (North Bank); the recipient is looked up
  // on the register chain before anything is sent.
  const start = await sam.runtime.startNegotiation({
    peer: { actor: NORTH.actor, party: NORTH.party },
    operation: PREQUAL_OP,
    terms: applicationTermsFor(SAM.party, 450000, 380000),
    models: [MODEL_MONTHLY],
  });
  const conv = start.conversation as Iri;
  for (const out of start.outbound) queue.push({ out });

  // 4, 5. Describe, settle, apply; North Bank answers with its evidence request. Before the
  // core reads it, the agent gets the statements it needs: 6 to 9 at Harbour Bank, 10 in its
  // own gate.
  let fetched = false;
  await deliver(recorder, byActor, queue, stepOf, async (out) => {
    if (fetched || out.toActor !== SAM.actor || out.message.kind !== "propose") return;
    fetched = true;
    const ask = {
      peer: { actor: HARBOUR_AGENT.actor, party: HARBOUR },
      operation: BALANCE_OP,
      input: { account: "current account", asOf: "2026-10-31" },
      basis: { kind: "represented" },
      purpose: PURPOSE.mortgageApplication,
      models: [BALANCE_MODEL],
      discover: false,
      configuration: CONFIG_ED25519,
    };
    // 6. Ask Sam's bank, presenting the mandate's representation statement.
    recorder.step(6);
    const first = await sam.runtime.startInvocation(ask);
    // 7. Harbour Bank's gate: the mandate is valid, but a statement needs a face check.
    recorder.step(7);
    await deliver(
      recorder,
      byActor,
      first.outbound.map((o) => ({ out: o })),
      none,
    );
    // 8. The agent sends the request again; its gate asks Sam for the approval Harbour Bank
    // named. Sam does a face check with the identity provider (a stand-in service), which
    // attests it, and approves the exact action.
    recorder.step(8);
    const again = await sam.runtime.retryChallenge(first.conversation as Iri);
    const pending = sam.runtime
      .pendingApprovals()
      .find((p) => p.conversation === again.conversation);
    if (!pending) throw new Error("the gate did not ask Sam for the stronger approval");
    t += 60_000;
    const attestation = await signClaim(
      issuers.idp,
      faceCheckAttestation({
        at: now().toISOString(),
        actionDigest: pending.actionDigest,
        operation: BALANCE_OP.id,
        challenge: pending.intent.parameters.challenge as JsonObject,
      }),
    );
    await sam.runtime.admitStatements([{ jws: attestation }], {
      subject: SAM.party,
      task: "a mortgage application",
      purpose: PURPOSE.mortgageApplication,
    });
    const answered = await sam.runtime.submitApproval(
      await cast.approval(
        "sam",
        pending.actionDigest,
        again.conversation as Iri,
        "approve",
        "Done: I did the face check with my identity provider. Yes, ask Harbour Bank.",
      ),
      { evidence: [{ role: "credential", format: "jws-compact", value: attestation }] },
    );
    // 9. Harbour Bank's outbound gate releases the statement with its terms; 10. Sam's
    // inbound gate checks it, then the payroll statement the agent already holds.
    recorder.label((agent, e, step) =>
      step === 8 && agent === "bank" && (e.part === "core" || e.part === "outbound-gate")
        ? 9
        : step,
    );
    await deliver(
      recorder,
      byActor,
      answered.outbound.map((o) => ({ out: o })),
      (o) => (o.message.kind === "deliver" ? 10 : undefined),
    );
    recorder.label(undefined);
    recorder.step(10);
    await sam.runtime.admitStatements([income], {
      subject: SAM.party,
      task: "a mortgage application",
      purpose: PURPOSE.mortgageApplication,
    });
  });

  const pending = sam.runtime.pendingApprovals().find((p) => p.conversation === conv);
  if (pending) {
    // 11. Sam answers the request the gate built.
    recorder.step(11);
    t += 60_000;
    const answer = await sam.runtime.submitApproval(
      await cast.approval(
        "sam",
        pending.actionDigest,
        conv,
        "approve",
        "Yes, share them with North Bank for the credit check.",
      ),
    );
    for (const out of answer.outbound) queue.push({ out });
    await deliver(recorder, byActor, queue, stepOf);
  }

  // 13. North Bank's assessment agent reads the admitted data for credit assessment only, and
  // its intake agent returns the signed decision in principle.
  t += 60_000;
  const stored = nbStore.ids();
  const derivedId = stored.find((id) => id.endsWith("#annualised")) as string;
  const depositId = stored.find((id) => id.includes("deposit")) as string;
  const read = nbStore.request({
    agent: NB_ASSESS,
    action: "read",
    items: [derivedId, depositId],
    purpose: PURPOSE.creditAssessment,
  });
  const data = (id: string) => (read.items ?? []).find((i) => i.id === id)?.data as JsonObject;
  const annual = Number(data(derivedId)?.value ?? 0);
  const balance = Number(data(depositId)?.balance ?? 0);
  const eligible = 380000 / annual <= 4.5 && balance >= 450000 - 380000;
  recorder.step(13);
  const decision = decisionInPrinciple({
    id: await nb.runtime.mintIdentifier(),
    amount: eligible ? 380000 : 0,
    at: now().toISOString(),
    conversation: conv,
  });
  const requested = await sam.runtime.invokeUnderAgreement({
    conversation: conv,
    operation: PREQUAL_OP,
    input: { request: "decision-in-principle" },
    purpose: PURPOSE.mortgageApplication,
  });
  await deliver(
    recorder,
    byActor,
    requested.outbound.map((out) => ({ out })),
    stepOf,
  );
  const request = requested.outbound[0];
  if (!request) throw new Error("decision request did not leave the outbound gate");
  const returned = await nb.runtime.sendMessage(conv, {
    kind: "deliver",
    body: {
      ref: request.id,
      basis: { kind: "agreement", agreement: nb.runtime.conversation(conv)?.agreement as Iri },
      operation: PREQUAL_OP,
      output: { statement: decision.id as string },
    },
    intent: {
      operation: PREQUAL_OP.id,
      action: "use",
      target: PREQUAL_OP.id,
      purpose: PURPOSE.creditAssessment,
      recipient: SAM.party,
      conversation: conv,
      parameters: {},
    },
    evidence: [
      {
        role: "credential",
        format: "jws-compact",
        value: await signClaim(cast.get("northbank-intake").ownerKey, decision),
      },
    ],
  });
  await deliver(
    recorder,
    byActor,
    returned.outbound.map((out) => ({ out })),
    stepOf,
  );
  const final = await nb.runtime.sendReceipt(conv, {
    activity: await nb.runtime.mintIdentifier(),
    outcome: "completed",
    final: true,
    observed: {
      stage: "decided",
      decided: {
        status: eligible ? "indicatively-eligible" : "not-eligible",
        by: NORTH.party,
        basis: "synthetic-decision-in-principle",
      },
      notClaimed: ["loan-approval", "truth-of-evidence", "complete-financial-picture"],
    },
  });
  for (const out of final.outbound) queue.push({ out });
  await deliver(recorder, byActor, queue, stepOf);

  // 14. Each side checks its own record.
  recorder.step(14);
  sam.runtime.checkRecord(sam.ledger.entries());
  index.runtime.checkRecord(index.ledger.entries());
  nb.runtime.checkRecord(nb.ledger.entries());
  harbour.runtime.checkRecord(harbour.ledger.entries());

  return {
    schema: TRACE_SCHEMA,
    scenario: {
      id: "mortgage-main",
      title: SCENARIOS["mortgage-main"],
      steps: stepsIn(recorder, mainTitles()),
    },
    configuration: { id: configuration.id, layers: { ...configuration.layers } },
    agents: MAIN_AGENTS,
    generated: { commit: opts.commit ?? "unknown", core: "scripted" },
    events: recorder.events(),
  };
}

export { FACE_CHECK };
