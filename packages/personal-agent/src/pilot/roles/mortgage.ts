/**
 * SYNTHETIC mortgage roles for persistent, independently initialised agents: consumer, lender
 * intake and underwriter. Each role composes the EXISTING mortgage handlers
 * (`domains/mortgage.ts`) with durable local state; the runtime's generic verification, source
 * authority, policy (the recorded module, SPARQ by default), approvals, replay protection and
 * effects apply unchanged. Nothing here is a real lender, credit process or payment rail.
 *
 * Durable state per role (all under the agent directory, single-host, single-writer):
 *  - consumer: `wallet.json` — issuer-signed synthetic evidence the consumer relays;
 *  - lender: `data-store.json` + `data-store-ledger.jsonl` — evidence stored under the
 *    data-use grant derived from the agreed terms, and the enforcement point's own ledger;
 *    `mortgage-workflow.json` — which application has an underwriting request / decision;
 *  - underwriter: nothing beyond the runtime state.
 * Conversation, agreement, pending-approval, effect and replay state are the runtime's own.
 *
 * Not part of this durable slice: the valuation/fee branch (a synthetic payment instruction
 * with unknown settlement) remains an in-process fixture demonstration only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { newUrn } from "../core/canonical.js";
import type { Iri, JsonObject } from "../core/types.js";
import {
  applicationTermsFor,
  ConsumerMortgageHandler,
  evidenceSchema,
  LenderPrequalHandler,
  LenderUnderwritingHandler,
  MODEL_MONTHLY,
  PREQUAL_OP,
  UNDERWRITING_OP,
  UnderwriterHandler,
  UW_MODEL,
  underwritingTermsFor,
  type WalletItem,
} from "../domains/mortgage.js";
import { MAX_PURGE_PER_CALL, PurposeBoundStore } from "../domains/purpose-store.js";
import {
  lenderInternalRoles,
  lenderMandate,
  lenderSourceRules,
  NB_ASSESS,
  NORTH,
  SAM,
  SAM_POLICY,
  samMortgageMandate,
  UW,
  underwriterMandate,
  underwriterSourceRules,
} from "../fixtures/mortgage.js";
import type { TrustStoreData } from "../mechanisms/trust.js";
import { PURPOSE } from "../profile/vocabulary.js";
import { NOT_SENT_NOTICE, summariseStep } from "../service.js";
import { addSourceRule } from "../setup.js";
import { pinIssuersFromFiles, writeAtomic } from "./common.js";
import type { OperatorOperation, RoleDefinition } from "./types.js";

export const WALLET_FILE = "wallet.json";
export const DATA_STORE_FILE = "data-store.json";
export const DATA_STORE_LEDGER_FILE = "data-store-ledger.jsonl";
export const WORKFLOW_FILE = "mortgage-workflow.json";

const scoped = (op: { id: string; version: string }, key: string) =>
  `${op.id}@${op.version}:${key}`;

const walletFile = z.strictObject({
  version: z.literal(1),
  items: z
    .array(z.strictObject({ jws: z.string().max(64 * 1024), statement: evidenceSchema }))
    .max(32),
});

function sourceRuleHorizon(now: Date): string {
  return new Date(now.getTime() + 365 * 86_400_000).toISOString();
}

// ------------------------------------------------------------------ consumer

export const MORTGAGE_CONSUMER_ROLE: RoleDefinition = {
  id: "mortgage-consumer",
  label: "Synthetic mortgage consumer (Sam) — relays issuer-signed evidence under agreed terms",
  synthetic: true,
  identity: { party: SAM.party, actor: SAM.actor, operator: SAM.operator },
  mandate: samMortgageMandate,
  representationOperations: [PREQUAL_OP.id],
  async init({ trust, options }) {
    if (!options.wallet)
      throw new Error("mortgage-consumer init needs --wallet FILE (synthetic issuance)");
    const wallet = walletFile.parse(JSON.parse(readFileSync(options.wallet, "utf8")));
    if (wallet.items.some((i) => i.statement.subject !== SAM.party))
      throw new Error("wallet contains statements about a different subject");
    return { trust, files: { [WALLET_FILE]: wallet } };
  },
  build(ctx) {
    const wallet = walletFile.parse(JSON.parse(readFileSync(join(ctx.dir, WALLET_FILE), "utf8")))
      .items as WalletItem[];
    const policy = {
      requireProhibited: [...SAM_POLICY.requireProhibited],
      maxRetentionDays: SAM_POLICY.maxRetentionDays,
      allowedOnward: [...SAM_POLICY.allowedOnward],
    };
    return {
      handlers: [new ConsumerMortgageHandler(wallet, policy)],
      effects: [],
      operations: (op): OperatorOperation[] => [
        {
          name: "start_prequalification",
          title: "Start a synthetic mortgage prequalification",
          description:
            "Propose an application (price, loan) to a PINNED lender actor. Evidence is disclosed only after the lender's " +
            "bounded request is agreed and the owner approves the exact disclosure (sign-approval + submit_approval).",
          input: {
            lenderActor: z.string().min(8).max(512),
            propertyPrice: z.number().int().min(1000).max(1e9),
            loanAmount: z.number().int().min(1000).max(1e9),
          },
          async run(raw) {
            const args = raw as { lenderActor: string; propertyPrice: number; loanAmount: number };
            const peer = op.pinnedPeer(args.lenderActor);
            const step = await op.rt.startNegotiation({
              peer,
              operation: PREQUAL_OP,
              terms: applicationTermsFor(ctx.party, args.propertyPrice, args.loanAmount),
              models: [MODEL_MONTHLY],
            });
            const items = await op.prepare(step.outbound);
            return { step: summariseStep(step), outbound: op.show(items), notice: NOT_SENT_NOTICE };
          },
        },
      ],
      status: () => ({
        wallet: wallet.map((w) => ({
          id: w.statement.id,
          issuer: w.statement.issuer,
          claimType: w.statement.claimType,
        })),
      }),
    };
  },
};

// ------------------------------------------------------------------ lender intake

/**
 * Once-only lender steps with recoverable intent. An INTENT naming what the runtime will create
 * is written BEFORE the runtime call (the underwriting conversation id is chosen here; the
 * decision receipt is identified by its activity `<application>#decision`), and the confirmed
 * result after it. A retry after an interruption or an exception RECONCILES from the runtime's
 * own state instead of guessing: if that conversation / receipt exists in the runtime, the step
 * happened (it is confirmed and never repeated); if it provably does not, the intent is cleared
 * and the step may run. An exception alone never clears an intent. Markers written by phase 6
 * (`…RequestedAt` without an intent) cannot be reconciled and stay refused with instructions.
 */
interface WorkflowEntry {
  underwritingIntent?: { conversation: Iri; at: string };
  underwriting?: Iri;
  underwritingRecovered?: true;
  decisionIntent?: { activity: Iri; at: string };
  decisionSentAt?: string;
  decisionRecovered?: true;
  /** Phase-6 markers (no correlation id). */
  underwritingRequestedAt?: string;
  decisionRequestedAt?: string;
}
interface Workflow {
  applications: Record<string, WorkflowEntry>;
}

/**
 * SYNTHETIC FAULT INJECTION at the lender's commit boundaries (tests and the separate-process
 * workflow only): with AWP_SYNTHETIC_FAULT=lender-<point> the step throws at that point, as if
 * the process had died there. Ignored otherwise.
 */
export type LenderFaultPoint =
  | "underwriting-after-intent"
  | "underwriting-after-commit"
  | "decision-after-intent"
  | "decision-after-commit";
function lenderFault(point: LenderFaultPoint): void {
  if (process.env.AWP_SYNTHETIC_FAULT === `lender-${point}`)
    throw new Error(`synthetic fault injected: lender-${point}`);
}

const UNRECONCILABLE =
  "a phase-6 marker without a correlation id shows this step was started but not confirmed; it " +
  "cannot be reconciled automatically and is not repeated. Inspect get_status (conversations, " +
  "undelivered outbound) and get_evidence (message-out records) to establish what happened.";

export const MORTGAGE_LENDER_ROLE: RoleDefinition = {
  id: "mortgage-lender",
  label:
    "Synthetic lender intake (North Bank) — bounded evidence request, purpose-bound store, underwriting",
  synthetic: true,
  identity: { party: NORTH.party, actor: NORTH.actor, operator: NORTH.operator },
  mandate: lenderMandate,
  representationOperations: [PREQUAL_OP.id, UNDERWRITING_OP.id],
  async init({ trust, now, options }) {
    if (!options.issuers)
      throw new Error("mortgage-lender init needs --issuers FILE (synthetic issuer public keys)");
    // Local source-authority anchors: issuer keys pinned HERE, by the lender's own onboarding,
    // never learned from a channel or from metadata that arrives with evidence.
    let next: TrustStoreData = pinIssuersFromFiles(
      trust,
      options.issuers,
      "synthetic issuer pinned at the lender's provisioning",
    );
    for (const rule of lenderSourceRules(sourceRuleHorizon(now))) next = addSourceRule(next, rule);
    return { trust: next };
  },
  build(ctx) {
    const store = new PurposeBoundStore(NORTH.party, lenderInternalRoles(), ctx.now, ctx.engine, {
      path: join(ctx.dir, DATA_STORE_FILE),
      ledgerPath: join(ctx.dir, DATA_STORE_LEDGER_FILE),
    });
    const wfPath = join(ctx.dir, WORKFLOW_FILE);
    const workflow = (): Workflow =>
      existsSync(wfPath)
        ? (JSON.parse(readFileSync(wfPath, "utf8")) as Workflow)
        : { applications: {} };
    const handlers = [
      new LenderPrequalHandler({
        lender: NORTH.party,
        underwriter: UW.party,
        acceptedModels: [MODEL_MONTHLY],
        retentionDays: 90,
        store,
      }),
      new LenderUnderwritingHandler(),
    ];
    return {
      handlers,
      effects: [],
      status: () => ({
        dataStore: store.inventory(),
        erased: store.tombstones().map((t) => ({ id: t.id, grant: t.grant, erasedAt: t.erasedAt })),
        workflow: workflow().applications,
      }),
      operations: (op): OperatorOperation[] => {
        const storedFor = (application: string): string[] => {
          const ids = op.rt.domainState(scoped(PREQUAL_OP, `stored:${application}`));
          if (!Array.isArray(ids) || ids.length === 0)
            throw new Error("no evidence stored for this application yet");
          return ids as string[];
        };
        const keyItems = (application: string) => {
          const ids = storedFor(application);
          const inv = store.inventory().filter((i) => ids.includes(i.id));
          const derived = inv.find((i) => i.id.endsWith("#annualised"));
          const deposit = inv.find((i) => i.claimType.startsWith("deposit."));
          if (!derived || !deposit) throw new Error("derived income or deposit evidence missing");
          return { derived: derived.id, deposit: deposit.id };
        };
        const application = { application: z.string().min(8).max(512) };
        return [
          {
            name: "internal_access",
            title: "Internal access at the purpose-bound enforcement point",
            description:
              "A TRUSTED LOCAL OPERATOR selects a SIMULATED internal role (`agent`) and requests read/use/distribute of stored " +
              "evidence; decided by the internal delegation registry AND the consumer's data-use grant (policy module). Data " +
              "only when permitted. The role is named by the operator, not an authenticated enterprise identity.",
            input: {
              agent: z.string().min(8).max(512),
              action: z.enum(["read", "use", "distribute"]),
              purpose: z.string().min(8).max(512),
              recipient: z.string().min(8).max(512).optional(),
              application: z.string().min(8).max(512).optional(),
              items: z.array(z.string().min(3).max(512)).min(1).max(16).optional(),
            },
            async run(raw) {
              const a = raw as {
                agent: string;
                action: "read" | "use" | "distribute";
                purpose: string;
                recipient?: string;
                application?: string;
                items?: string[];
              };
              const items = a.items ?? (a.application ? storedFor(a.application) : undefined) ?? [];
              if (items.length === 0) throw new Error("name items or an application");
              const d = store.request({
                agent: a.agent,
                action: a.action,
                items,
                purpose: a.purpose,
                ...(a.recipient ? { recipient: a.recipient } : {}),
              });
              return {
                decision: d.decision,
                reason: d.reason,
                ...(d.items
                  ? {
                      items: d.items.map((i) => ({
                        id: i.id,
                        claimType: i.claimType,
                        data: i.data,
                      })),
                    }
                  : {}),
              };
            },
          },
          {
            name: "start_underwriting",
            title: "Request an underwriting check under attenuated terms",
            description:
              "For an application whose evidence is stored: the enforcement point must permit the onward distribution to the " +
              "pinned underwriter under the consumer's grant; only the attenuated fields are proposed. Once per application.",
            input: application,
            async run(raw) {
              const app = (raw as { application: string }).application;
              const wf = workflow();
              const entry: WorkflowEntry = wf.applications[app] ?? {};
              if (entry.underwriting)
                throw new Error(`underwriting already requested: ${entry.underwriting}`);
              if (entry.underwritingRequestedAt && !entry.underwritingIntent)
                throw new Error(`underwriting: ${UNRECONCILABLE}`);
              if (entry.underwritingIntent) {
                const conversation = entry.underwritingIntent.conversation;
                const { underwritingIntent: _i, ...rest } = entry;
                if (op.rt.conversation(conversation)) {
                  // The runtime started it before the interruption: confirm, never repeat.
                  wf.applications[app] = {
                    ...rest,
                    underwriting: conversation,
                    underwritingRecovered: true,
                  };
                  writeAtomic(wfPath, wf);
                  const pendingOut = op.rt
                    .undeliveredOutbound()
                    .filter((m) => m.conversation === conversation);
                  return {
                    recovered: true,
                    conversation,
                    note: "the underwriting request had been started before an interruption; confirmed from the runtime's state, not repeated",
                    outbound: op.show(await op.prepare(pendingOut)),
                    notice: NOT_SENT_NOTICE,
                  };
                }
                // Provably not started (no such conversation in the runtime): the step may run.
                wf.applications[app] = rest;
                writeAtomic(wfPath, wf);
              }
              const { derived, deposit } = keyItems(app);
              const onward = store.request({
                agent: NORTH.actor,
                action: "distribute",
                items: [derived, deposit],
                purpose: PURPOSE.creditChecking,
                recipient: UW.party,
              });
              if (onward.decision !== "permit" || !onward.items)
                throw new Error(`onward disclosure not permitted: ${onward.reason}`);
              const values = Object.fromEntries(
                onward.items.map((i) => [i.id, i.data as JsonObject]),
              );
              const appTerms = op.rt.domainState(scoped(PREQUAL_OP, `application:${app}`)) as
                | { loanAmount: number; propertyPrice: number }
                | undefined;
              const agreement = op.rt.conversation(app)?.agreement;
              if (!appTerms || !agreement)
                throw new Error("no agreed application for this conversation");
              const uwActor = op.trust.keys.find((k) => k.role === "actor" && k.party === UW.party);
              if (!uwActor) throw new Error("the underwriter is not pinned");
              const terms = underwritingTermsFor({
                applicationRef: `${app}#application`,
                annualGrossIncome: Number(values[derived]?.value),
                derivedFrom: [derived],
                depositBalance: Number(values[deposit]?.balance),
                loanAmount: appTerms.loanAmount,
                propertyPrice: appTerms.propertyPrice,
                consumerAgreement: agreement,
                onwardRule: `${agreement}#onward-0`,
                lender: NORTH.party,
              });
              const peer = op.pinnedPeer(uwActor.subject);
              // Intent first, naming the conversation the runtime will create.
              const conversation = newUrn();
              wf.applications[app] = {
                ...wf.applications[app],
                underwritingIntent: { conversation, at: op.now().toISOString() },
              };
              writeAtomic(wfPath, wf);
              lenderFault("underwriting-after-intent");
              // An exception here does NOT clear the intent: the runtime may have changed state.
              // The next call reconciles from the runtime (conversation present or not).
              const step = await op.rt.startNegotiation({
                peer,
                operation: UNDERWRITING_OP,
                terms: terms as unknown as JsonObject,
                models: [UW_MODEL],
                conversation,
              });
              lenderFault("underwriting-after-commit");
              const { underwritingIntent: _i, ...confirmed } = wf.applications[app] ?? {};
              wf.applications[app] = { ...confirmed, underwriting: conversation };
              writeAtomic(wfPath, wf);
              const items = await op.prepare(step.outbound);
              return {
                step: summariseStep(step),
                attenuatedFields: Object.keys(terms.fields),
                outbound: op.show(items),
                notice: NOT_SENT_NOTICE,
              };
            },
          },
          {
            name: "send_decision_receipt",
            title: "Send the final (indicative) application state to the consumer",
            description:
              "After the underwriting result is received: the assessment agent's permitted read yields an indicative, " +
              "synthetic eligibility; a final receipt (not an approval) is sent once per application.",
            input: application,
            async run(raw) {
              const app = (raw as { application: string }).application;
              const wf = workflow();
              let entry: WorkflowEntry = wf.applications[app] ?? {};
              if (entry.decisionSentAt) throw new Error("decision receipt already sent");
              if (entry.decisionRequestedAt && !entry.decisionIntent)
                throw new Error(`decision receipt: ${UNRECONCILABLE}`);
              const activity = `${app}#decision`;
              if (entry.decisionIntent) {
                const { decisionIntent: _i, ...rest } = entry;
                const emitted = op.rt
                  .outboxMessages(app)
                  .find(
                    (m) =>
                      m.kind === "receipt" &&
                      (m.message.body as { activity?: unknown }).activity === activity,
                  );
                if (emitted) {
                  // The runtime emitted it before the interruption: confirm, never repeat.
                  wf.applications[app] = {
                    ...rest,
                    decisionSentAt: emitted.message.createdAt,
                    decisionRecovered: true,
                  };
                  writeAtomic(wfPath, wf);
                  const stillPending = op.rt
                    .undeliveredOutbound()
                    .filter((m) => m.id === emitted.id);
                  return {
                    recovered: true,
                    receipt: emitted.id,
                    note: "the decision receipt had been emitted before an interruption; confirmed from the runtime's outbox, not repeated",
                    outbound: op.show(await op.prepare(stillPending)),
                    notice: NOT_SENT_NOTICE,
                  };
                }
                // Provably not emitted (no such receipt in the runtime's outbox): it may run.
                wf.applications[app] = rest;
                writeAtomic(wfPath, wf);
                entry = rest;
              }
              if (!entry.underwriting)
                throw new Error("no underwriting requested for this application");
              const result = op.rt.domainState(
                scoped(UNDERWRITING_OP, `uw-result:${entry.underwriting}`),
              ) as { result?: string } | undefined;
              if (!result?.result) throw new Error("underwriting result not yet received");
              const { derived, deposit } = keyItems(app);
              const read = store.request({
                agent: NB_ASSESS,
                action: "read",
                items: [derived, deposit],
                purpose: PURPOSE.creditChecking,
              });
              if (read.decision !== "permit" || !read.items)
                throw new Error(`assessment read not permitted: ${read.reason}`);
              const v = Object.fromEntries(read.items.map((i) => [i.id, i.data as JsonObject]));
              const appTerms = op.rt.domainState(scoped(PREQUAL_OP, `application:${app}`)) as {
                loanAmount: number;
                propertyPrice: number;
              };
              const annual = Number(v[derived]?.value);
              const balance = Number(v[deposit]?.balance);
              const indicative =
                appTerms.loanAmount / annual <= 4.5 &&
                balance >= appTerms.propertyPrice - appTerms.loanAmount
                  ? "indicatively-eligible"
                  : "not-eligible";
              wf.applications[app] = {
                ...entry,
                decisionIntent: { activity, at: op.now().toISOString() },
              };
              writeAtomic(wfPath, wf);
              lenderFault("decision-after-intent");
              // An exception here does NOT clear the intent (see start_underwriting).
              const step = await op.rt.sendReceipt(app, {
                activity,
                outcome: "completed",
                final: true,
                observed: {
                  stage: "decided",
                  decided: {
                    status: indicative,
                    by: NORTH.party,
                    basis: "synthetic prequalification rule; indicative only",
                  },
                  underwriting: { result: result.result, by: UW.party },
                  notClaimed: ["loan approval", "truth of evidence", "complete financial picture"],
                  synthetic: true,
                },
              });
              lenderFault("decision-after-commit");
              wf.applications[app] = { ...entry, decisionSentAt: op.now().toISOString() };
              writeAtomic(wfPath, wf);
              const items = await op.prepare(step.outbound);
              return {
                step: summariseStep(step),
                decided: indicative,
                outbound: op.show(items),
                notice: NOT_SENT_NOTICE,
              };
            },
          },
          {
            name: "purge_expired",
            title: "Retention: erase expired payloads from the purpose-bound store",
            description:
              `Erase (at most ${MAX_PURGE_PER_CALL} per call) the stored payloads whose data-use grant has expired; keep ` +
              "payload-free tombstones and log payload-free data-erased evidence. Erases THIS store's copy only — not runtime " +
              "transcripts, the consumer's wallet, the underwriter's copy of attenuated fields, reports or backups.",
            input: { limit: z.number().int().min(1).max(MAX_PURGE_PER_CALL).optional() },
            async run(raw) {
              const { limit } = raw as { limit?: number };
              const r = store.purgeExpired(limit);
              return {
                // Committed erasures by this call (payloads gone from the store file).
                erased: r.erased.map((t) => ({
                  id: t.id,
                  claimType: t.claimType,
                  grant: t.grant,
                  ...(t.revision ? { revision: t.revision } : {}),
                })),
                // Committed, but their data-erased evidence is not appended yet (repaired later).
                evidencePending: r.evidencePending,
                // Evidence for EARLIER interrupted commits, appended by this call first.
                repairedEvidence: r.repairedEvidence,
                remainingExpired: r.remainingExpired,
                scope: "this enforcement point's stored copy only",
              };
            },
          },
        ];
      },
    };
  },
};

// ------------------------------------------------------------------ underwriter

export const MORTGAGE_UNDERWRITER_ROLE: RoleDefinition = {
  id: "mortgage-underwriter",
  label: "Synthetic underwriting service — deterministic check on attenuated, attested facts",
  synthetic: true,
  identity: { party: UW.party, actor: UW.actor, operator: UW.operator },
  mandate: underwriterMandate,
  representationOperations: [UNDERWRITING_OP.id],
  async init({ trust, now }) {
    let next = trust;
    for (const rule of underwriterSourceRules(sourceRuleHorizon(now)))
      next = addSourceRule(next, rule);
    return { trust: next };
  },
  build() {
    return { handlers: [new UnderwriterHandler()], effects: [], operations: () => [] };
  },
};
