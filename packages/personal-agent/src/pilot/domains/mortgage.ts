/**
 * Domain adapter: UC-01 mortgage prequalification (synthetic; no real lending, account or
 * institutional membership). One negotiation per relationship, on the shared runtime:
 *
 *   consumer ──propose(application: price, loan)──▶ lender intake
 *   consumer ◀─propose(counter: bounded evidence request + use terms)── lender
 *   consumer ──accept (owner approval bound to the exact terms)──▶ lender   → agreement
 *   consumer ──deliver(issuer-signed evidence, relayed)──▶ lender
 *   lender: verify each statement (pinned issuer keys) → source authority (scoped rules)
 *           → subject/period/currency checks → accepted derivation (12-month series →
 *           annual gross) → store under the grant derived from the agreed terms
 *   lender ──receipt(received / checked / derived; non-final)──▶ consumer
 *   [lender internal: assessment agent permitted, marketing agent denied at the PEP]
 *   lender ──propose(underwriting check, attenuated fields)──▶ underwriter (org→org)
 *   underwriter ──accept──▶ ──deliver(result)──▶ lender ──receipt──▶
 *   lender ──receipt(final application state)──▶ consumer
 *   valuation branch: fee → consumer `compensate` action → approval → instruction
 *   submitted; settlement unknown ⇒ obligation fulfilment unresolved.
 */
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { iso } from "../core/schema.js";
import type {
  ActionIntent,
  Agreement,
  DeliverBody,
  EvidenceItem,
  Iri,
  JsonObject,
  ProposeBody,
} from "../core/types.js";
import { TYP } from "../mechanisms/statements.js";
import type { OperationDescription } from "../profile/description.js";
import { AWP, PURPOSE } from "../profile/vocabulary.js";
import type {
  AgreementPlan,
  EffectAdapter,
  EffectResult,
  HandlerContext,
  HandlerReply,
  OperationHandler,
} from "../runtime/operations.js";
import type { PurposeBoundStore } from "./purpose-store.js";
import { PAYMENT_OP } from "./scheduling.js";

export const PREQUAL_OP = { id: `${AWP}op/mortgage-prequalification`, version: "0.1" } as const;
export const UNDERWRITING_OP = { id: `${AWP}op/underwriting-check`, version: "0.1" } as const;
export const VALUATION_OP = { id: `${AWP}op/valuation-order`, version: "0.1" } as const;
export const DISCLOSURE_TARGET = `${AWP}op/evidence-disclosure`;
export const MODEL_MONTHLY = {
  id: `${AWP}model/mortgage-evidence-monthly-series`,
  version: "0.1",
} as const;
export const MODEL_ANNUAL = {
  id: `${AWP}model/mortgage-evidence-annual-income`,
  version: "0.1",
} as const;
export const UW_MODEL = { id: `${AWP}model/underwriting-check`, version: "0.1" } as const;
export const VALUATION_MODEL = { id: `${AWP}model/valuation-order`, version: "0.1" } as const;
export const DERIVATION_RULE = {
  id: `${AWP}rule/annualise-12-consecutive-months`,
  version: "1",
} as const;

export const CLAIM = {
  incomeMonthly: "income.gross.monthly-series",
  depositBalance: "deposit.balance",
  consentBasis: "mortgage.consent-basis",
  applicationFacts: "mortgage.application.derived",
} as const;

// ------------------------------------------------------------------ evidence statements

export const evidenceSchema = z
  .object({
    type: z.literal("EvidenceStatement"),
    id: z.string().max(512),
    issuer: z.string().max(512),
    subject: z.string().max(512),
    claimType: z.string().max(128),
    version: z.number().int().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    period: z
      .object({ start: z.string().regex(/^\d{4}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}$/) })
      .strict(),
    monthly: z
      .array(
        z
          .object({ month: z.string().regex(/^\d{4}-\d{2}$/), gross: z.number().min(0).max(1e7) })
          .strict(),
      )
      .max(36)
      .optional(),
    balance: z.number().min(0).max(1e9).optional(),
    asOf: iso.optional(),
    issuedAt: iso,
    synthetic: z.literal(true),
  })
  .strict();
export type EvidenceStatement = z.infer<typeof evidenceSchema>;

// ------------------------------------------------------------------ terms

const applicationTerms = z.strictObject({
  model: z.literal(`${AWP}model/mortgage-application`),
  propertyPrice: z.number().int().min(1000).max(1e9),
  loanAmount: z.number().int().min(1000).max(1e9),
  currency: z.literal("USD"),
  applicant: z.string().max(512),
  synthetic: z.literal(true),
});

const evidenceRequestTerms = z.strictObject({
  model: z.string().max(512),
  modelVersion: z.string().max(16),
  application: applicationTerms,
  applicationId: z.string().max(512),
  evidenceRequest: z
    .array(
      z.strictObject({
        claimType: z.string().max(128),
        periodMonths: z.number().int().min(1).max(36),
        currency: z.string().regex(/^[A-Z]{3}$/),
      }),
    )
    .min(1)
    .max(8),
  purpose: z.string().max(512),
  recipients: z.array(z.string().max(512)).min(1).max(4),
  onward: z
    .array(
      z.strictObject({
        recipient: z.string().max(512),
        purpose: z.string().max(512),
        fields: z.array(z.string().max(64)).max(8),
      }),
    )
    .max(4),
  retentionDays: z.number().int().min(1).max(3650),
  prohibitedPurposes: z.array(z.string().max(512)).max(8),
  fee: z.strictObject({ amount: z.literal(0) }),
  synthetic: z.literal(true),
});
export type EvidenceRequestTerms = z.infer<typeof evidenceRequestTerms>;

const prequalTerms = z.union([applicationTerms, evidenceRequestTerms]);

const underwritingTerms = z.strictObject({
  model: z.literal(UW_MODEL.id),
  applicationRef: z.string().max(512),
  fields: z.strictObject({
    annualGrossIncome: z.strictObject({
      value: z.number().min(0),
      currency: z.literal("USD"),
      derivation: z.string().max(512),
      derivedFrom: z.array(z.string().max(512)).max(8),
    }),
    depositBalance: z.strictObject({ value: z.number().min(0), currency: z.literal("USD") }),
    loanAmount: z.number().int().min(0),
    propertyPrice: z.number().int().min(0),
  }),
  purpose: z.string().max(512),
  basis: z.strictObject({
    consumerAgreement: z.string().max(512),
    onwardRule: z.string().max(512),
    attestedBy: z.string().max(512),
  }),
  retentionDays: z.number().int().min(1).max(365),
  noRedistribution: z.literal(true),
  synthetic: z.literal(true),
});
export type UnderwritingTerms = z.infer<typeof underwritingTerms>;

const valuationTerms = z.strictObject({
  model: z.literal(VALUATION_MODEL.id),
  applicationRef: z.string().max(512),
  valuer: z.string().max(512),
  fee: z.strictObject({
    amount: z.number().min(0).max(100000),
    currency: z.literal("USD"),
    payableBy: z.literal("applicant"),
  }),
  synthetic: z.literal(true),
});

// ------------------------------------------------------------------ descriptions

export function prequalDescription(
  models: readonly { id: string; version: string }[],
  roles: ("initiator" | "responder")[],
): OperationDescription {
  return {
    id: PREQUAL_OP.id,
    version: PREQUAL_OP.version,
    label: "Mortgage prequalification with a bounded evidence request (synthetic)",
    pattern: "negotiate",
    access: "represented",
    roles,
    models,
    purposes: [PURPOSE.mortgagePrequalification, PURPOSE.creditChecking],
    effects: ["evidence disclosed under agreed terms", "indicative eligibility (not approval)"],
    outcomes: ["application-state receipt: received / checked / decided"],
    limitations: [
      "synthetic lender; indicative only; no credit decision or institutional approval",
    ],
  };
}

// ------------------------------------------------------------------ consumer side

export interface WalletItem {
  readonly jws: string;
  readonly statement: EvidenceStatement;
}

export interface ConsumerPolicy {
  /** Purposes the consumer requires to be prohibited in any evidence request. */
  readonly requireProhibited: readonly Iri[];
  readonly maxRetentionDays: number;
  /** Onward recipients the consumer tolerates (for credit checking only). */
  readonly allowedOnward: readonly Iri[];
}

export class ConsumerMortgageHandler implements OperationHandler {
  readonly description = prequalDescription([MODEL_MONTHLY], ["initiator"]);
  readonly termsSchema = prequalTerms as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  constructor(
    private readonly wallet: readonly WalletItem[],
    private readonly policy: ConsumerPolicy,
  ) {}

  intentForProposal(ctx: HandlerContext, terms: JsonObject): ActionIntent {
    return {
      operation: PREQUAL_OP.id,
      action: "use",
      target: PREQUAL_OP.id,
      purpose: PURPOSE.mortgagePrequalification,
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: { termsDigest: digestOf(terms), disclosed: ["propertyPrice", "loanAmount"] },
      conversation: ctx.conversation.id,
    };
  }

  private disclosureIntent(
    ctx: HandlerContext,
    t: EvidenceRequestTerms,
    termsDigest: string,
  ): ActionIntent {
    return {
      operation: PREQUAL_OP.id,
      action: "distribute",
      target: DISCLOSURE_TARGET,
      purpose: t.purpose,
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: {
        termsDigest,
        evidence: this.matching(t)
          .map((w) => w.statement.id)
          .sort(),
        onward: t.onward.map((o) => o.recipient).sort(),
        retentionDays: t.retentionDays,
      },
      conversation: ctx.conversation.id,
    };
  }

  private matching(t: EvidenceRequestTerms): WalletItem[] {
    return this.wallet.filter((w) =>
      t.evidenceRequest.some(
        (r) => r.claimType === w.statement.claimType && r.currency === w.statement.currency,
      ),
    );
  }

  onProposal(ctx: HandlerContext, body: ProposeBody): HandlerReply {
    const parsed = evidenceRequestTerms.safeParse(body.terms);
    if (!parsed.success)
      return { type: "refuse", reason: "invalid-terms", detail: "expected an evidence request" };
    const t = parsed.data;
    if (t.application.applicant !== ctx.self.party)
      return {
        type: "refuse",
        reason: "invalid-terms",
        detail: "application is for a different applicant",
      };
    for (const p of this.policy.requireProhibited) {
      if (!t.prohibitedPurposes.includes(p))
        return {
          type: "refuse",
          reason: "purpose-not-permitted",
          detail: `terms must prohibit ${p}`,
        };
    }
    if (t.retentionDays > this.policy.maxRetentionDays)
      return { type: "refuse", reason: "excessive-scope", detail: "retention too long" };
    if (t.recipients.some((r) => r !== ctx.peer.party))
      return { type: "refuse", reason: "excessive-scope", detail: "unexpected direct recipients" };
    if (
      t.onward.some(
        (o) => !this.policy.allowedOnward.includes(o.recipient) || o.purpose !== t.purpose,
      )
    ) {
      return {
        type: "refuse",
        reason: "excessive-scope",
        detail: "onward disclosure outside tolerated recipients/purpose",
      };
    }
    const missing = t.evidenceRequest.filter(
      (r) => !this.wallet.some((w) => w.statement.claimType === r.claimType),
    );
    if (missing.length > 0)
      return {
        type: "refuse",
        reason: "invalid-terms",
        detail: `no evidence for ${missing.map((m) => m.claimType).join(", ")}`,
      };
    return { type: "accept", intent: this.disclosureIntent(ctx, t, body.termsDigest) };
  }

  onAgreement(ctx: HandlerContext, agreement: Agreement): AgreementPlan {
    const t = evidenceRequestTerms.parse(agreement.terms);
    const items = this.matching(t);
    return {
      requiredOutcomes: ["peer"],
      messages: [
        {
          kind: "deliver",
          body: {
            ref: agreement.id,
            basis: { kind: "agreement", agreement: agreement.id },
            operation: PREQUAL_OP,
            output: {
              evidenceCount: items.length,
              note: "issuer-signed statements relayed in evidence; the consumer's agent is not their author",
            },
          },
          intent: this.disclosureIntent(ctx, t, agreement.termsDigest),
          evidence: items.map(
            (w): EvidenceItem => ({ role: "credential", format: "jws-compact", value: w.jws }),
          ),
        },
      ],
    };
  }

  onReceipt(ctx: HandlerContext, body: { observed?: JsonObject; final?: boolean }): HandlerReply {
    ctx.setState(`application-state:${ctx.conversation.id}`, (body.observed ?? {}) as JsonObject);
    return { type: "none" };
  }
}

// ------------------------------------------------------------------ lender intake

export interface LenderConfig {
  readonly lender: Iri;
  readonly underwriter: Iri;
  readonly acceptedModels: readonly { id: string; version: string }[];
  readonly retentionDays: number;
  readonly store: PurposeBoundStore;
}

function monthIndex(ym: string): number {
  const [y, m] = ym.split("-").map((x) => Number.parseInt(x, 10));
  return (y ?? 0) * 12 + (m ?? 1) - 1;
}

/** Accepted derivation: 12 consecutive monthly gross values, one currency → annual gross. */
export function annualise(
  s: EvidenceStatement,
): { value: number; months: number } | { problem: string } {
  const rows = [...(s.monthly ?? [])].sort((a, b) => monthIndex(a.month) - monthIndex(b.month));
  if (rows.length !== 12)
    return { problem: `rule ${DERIVATION_RULE.id} needs exactly 12 months, got ${rows.length}` };
  for (let i = 1; i < rows.length; i++) {
    if (
      monthIndex((rows[i] as { month: string }).month) !==
      monthIndex((rows[i - 1] as { month: string }).month) + 1
    ) {
      return { problem: "months are not consecutive" };
    }
  }
  return { value: rows.reduce((sum, r) => sum + r.gross, 0), months: 12 };
}

/** The data-use grant derived from agreed evidence-request terms (ODRL, pilot subset). */
export function grantFromTerms(
  agreement: Agreement,
  t: EvidenceRequestTerms,
  consumer: Iri,
  lender: Iri,
): { target: Iri; policy: OdrlPolicy } {
  const target = `${agreement.id}#evidence`;
  return {
    target,
    policy: {
      id: `${agreement.id}#grant`,
      type: "Agreement",
      assigner: consumer,
      assignee: lender,
      conflict: "prohibit",
      permissions: [
        {
          id: `${agreement.id}#read-for-purpose`,
          type: "permission",
          action: "read",
          target,
          constraints: [{ leftOperand: "purpose", operator: "isAnyOf", rightOperand: [t.purpose] }],
        },
        ...t.onward.map((o, i) => ({
          id: `${agreement.id}#onward-${i}`,
          type: "permission" as const,
          action: "distribute" as const,
          target,
          constraints: [
            {
              leftOperand: "purpose" as const,
              operator: "isAnyOf" as const,
              rightOperand: [o.purpose],
            },
            {
              leftOperand: "recipient" as const,
              operator: "isAnyOf" as const,
              rightOperand: [o.recipient],
            },
          ],
        })),
      ],
      prohibitions: t.prohibitedPurposes.map((p, i) => ({
        id: `${agreement.id}#prohibited-${i}`,
        type: "prohibition" as const,
        action: "use" as const,
        target,
        constraints: [
          { leftOperand: "purpose" as const, operator: "isAnyOf" as const, rightOperand: [p] },
        ],
      })),
    },
  };
}

export class LenderPrequalHandler implements OperationHandler {
  readonly description: OperationDescription;
  readonly termsSchema = prequalTerms as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  constructor(private readonly cfg: LenderConfig) {
    this.description = prequalDescription(cfg.acceptedModels, ["responder"]);
  }

  onProposal(ctx: HandlerContext, body: ProposeBody): HandlerReply {
    const app = applicationTerms.safeParse(body.terms);
    if (!app.success)
      return { type: "refuse", reason: "invalid-terms", detail: "expected an application" };
    if (app.data.applicant !== ctx.peer.party)
      return {
        type: "refuse",
        reason: "invalid-terms",
        detail: "applicant is not the represented party",
      };
    if (app.data.loanAmount >= app.data.propertyPrice)
      return { type: "refuse", reason: "invalid-terms", detail: "loan must be below price" };
    const model = this.cfg.acceptedModels[0] ?? MODEL_MONTHLY;
    const terms: EvidenceRequestTerms = {
      model: model.id,
      modelVersion: model.version,
      application: app.data,
      applicationId: `${ctx.conversation.id}#application`,
      evidenceRequest: [
        { claimType: CLAIM.incomeMonthly, periodMonths: 12, currency: "USD" },
        { claimType: CLAIM.depositBalance, periodMonths: 1, currency: "USD" },
      ],
      purpose: PURPOSE.creditChecking,
      recipients: [this.cfg.lender],
      onward: [
        {
          recipient: this.cfg.underwriter,
          purpose: PURPOSE.creditChecking,
          fields: ["annualGrossIncome", "depositBalance"],
        },
      ],
      retentionDays: this.cfg.retentionDays,
      prohibitedPurposes: [PURPOSE.marketing],
      fee: { amount: 0 },
      synthetic: true,
    };
    return {
      type: "counter",
      terms: terms as unknown as JsonObject,
      intent: {
        operation: PREQUAL_OP.id,
        action: "use",
        target: PREQUAL_OP.id,
        purpose: PURPOSE.creditChecking,
        ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
        parameters: { termsDigest: digestOf(terms) },
        conversation: ctx.conversation.id,
      },
    };
  }

  onAgreement(ctx: HandlerContext, agreement: Agreement): AgreementPlan {
    ctx.setState(`agreement:${ctx.conversation.id}`, agreement.id);
    ctx.setState(`terms:${agreement.id}`, agreement.terms);
    return { requiredOutcomes: ["self"] };
  }

  async onDeliver(
    ctx: HandlerContext,
    body: DeliverBody,
    evidence: readonly EvidenceItem[],
  ): Promise<HandlerReply> {
    const agreementId = body.basis.kind === "agreement" ? body.basis.agreement : undefined;
    const agreement = agreementId
      ? ctx.getState<string>(`agreement:${ctx.conversation.id}`) === agreementId
        ? agreementId
        : undefined
      : undefined;
    if (!agreement)
      return {
        type: "refuse",
        reason: "no-agreement",
        detail: "delivery is not under the agreed terms",
      };
    const terms = evidenceRequestTerms.parse(ctx.getState<JsonObject>(`terms:${agreement}`) ?? {});
    const subject = ctx.peer.party;
    const checked: JsonObject[] = [];
    const accepted: Array<{ s: EvidenceStatement; digest: string }> = [];
    for (const item of evidence.filter((e) => e.role === "credential")) {
      const v = await ctx.verify(item.value, {
        typ: TYP.statement,
        role: "issuer",
        schema: evidenceSchema,
      });
      const s = v.payload;
      const entry: JsonObject = {
        integrity: v.verification.outcome,
        protectedObject: v.verification.protectedObject,
      };
      if (!s || v.verification.outcome !== "valid") {
        checked.push({ ...entry, accepted: false, reason: "integrity check failed" });
        continue;
      }
      entry.id = s.id;
      entry.claimType = s.claimType;
      entry.issuer = s.issuer;
      if (v.signer?.subject !== s.issuer) {
        checked.push({
          ...entry,
          accepted: false,
          reason: "issuer field does not match the pinned signer",
        });
        continue;
      }
      const authority = ctx.assessSource({
        source: s.issuer,
        claimType: s.claimType,
        ...(subject ? { subject } : {}),
      });
      entry.sourceAuthority = authority.outcome;
      if (authority.outcome !== "accepted") {
        checked.push({
          ...entry,
          accepted: false,
          reason: `source not accepted for ${s.claimType}`,
        });
        continue;
      }
      if (s.subject !== subject) {
        checked.push({
          ...entry,
          accepted: false,
          reason: "evidence is about a different subject",
        });
        continue;
      }
      const requested = terms.evidenceRequest.find(
        (r) => r.claimType === s.claimType && r.currency === s.currency,
      );
      if (!requested) {
        checked.push({
          ...entry,
          accepted: false,
          reason: "not requested (excess disclosure ignored)",
        });
        continue;
      }
      checked.push({ ...entry, accepted: true });
      accepted.push({ s, digest: v.verification.protectedObject });
    }
    const grant = grantFromTerms(
      { id: agreement } as Agreement,
      terms,
      subject ?? "unknown",
      this.cfg.lender,
    );
    const validUntil = new Date(
      Date.parse(ctx.now) + terms.retentionDays * 86_400_000,
    ).toISOString();
    const stored: string[] = [];
    let derived: JsonObject | undefined;
    for (const { s } of accepted) {
      this.cfg.store.put({
        id: s.id,
        claimType: s.claimType,
        subject: s.subject,
        source: s.issuer,
        data: s as unknown as JsonObject,
        grant: {
          id: grant.policy.id,
          target: grant.target,
          policy: grant.policy,
          assignee: this.cfg.lender,
          validUntil,
        },
      });
      stored.push(s.id);
      if (s.claimType === CLAIM.incomeMonthly) {
        const a = annualise(s);
        ctx.record({
          type: "content-appraisal",
          subject: s.id,
          rule: DERIVATION_RULE,
          outcome: "value" in a ? "derived" : "rejected",
          ...("value" in a ? { value: a.value, currency: s.currency } : { problem: a.problem }),
        });
        if ("value" in a) {
          const id = `${s.id}#annualised`;
          this.cfg.store.put({
            id,
            claimType: "income.gross.annual.derived",
            subject: s.subject,
            source: this.cfg.lender,
            data: { value: a.value, currency: s.currency, rule: DERIVATION_RULE.id },
            grant: {
              id: grant.policy.id,
              target: grant.target,
              policy: grant.policy,
              assignee: this.cfg.lender,
              validUntil,
            },
            derivedFrom: [s.id],
          });
          stored.push(id);
          derived = {
            annualGrossIncome: a.value,
            currency: s.currency,
            rule: DERIVATION_RULE.id,
            derivedFrom: s.id,
          };
        }
      }
    }
    const missing = terms.evidenceRequest
      .filter((r) => !accepted.some((a) => a.s.claimType === r.claimType))
      .map((r) => r.claimType);
    ctx.setState(`stored:${ctx.conversation.id}`, stored);
    ctx.setState(`application:${ctx.conversation.id}`, terms.application as unknown as JsonObject);
    return {
      type: "receipt",
      activity: `${ctx.conversation.id}#intake-check`,
      outcome: "completed",
      final: false,
      observed: {
        stage: "received-and-checked",
        received: evidence.length,
        checked,
        ...(derived ? { derived } : {}),
        missing,
        completeness: missing.length === 0 ? "all requested evidence types accepted" : "incomplete",
        notClaimed: [
          "approval",
          "truth of the income figures",
          "completeness of the applicant's finances",
        ],
      },
    };
  }
}

// ------------------------------------------------------------------ lender → underwriter

export class LenderUnderwritingHandler implements OperationHandler {
  readonly description: OperationDescription = {
    id: UNDERWRITING_OP.id,
    version: UNDERWRITING_OP.version,
    label: "Organisation-to-organisation underwriting check (synthetic)",
    pattern: "negotiate",
    access: "represented",
    roles: ["initiator"],
    models: [UW_MODEL],
    purposes: [PURPOSE.creditChecking],
    effects: ["attenuated fields disclosed to the underwriter"],
    outcomes: ["pass | refer"],
  };
  readonly termsSchema = underwritingTerms as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  intentForProposal(ctx: HandlerContext, terms: JsonObject): ActionIntent {
    const t = underwritingTerms.parse(terms);
    return {
      operation: UNDERWRITING_OP.id,
      action: "distribute",
      target: UNDERWRITING_OP.id,
      purpose: t.purpose,
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: { termsDigest: digestOf(terms), fields: Object.keys(t.fields).sort() },
      conversation: ctx.conversation.id,
    };
  }

  onAgreement(): AgreementPlan {
    return { requiredOutcomes: ["self"] };
  }

  onDeliver(ctx: HandlerContext, body: DeliverBody): HandlerReply {
    const result = z
      .object({ result: z.enum(["pass", "refer"]) })
      .passthrough()
      .safeParse(body.output);
    if (!result.success)
      return {
        type: "refuse",
        reason: "invalid-terms",
        detail: "unrecognised underwriting result",
      };
    const authority = ctx.assessSource({
      source: ctx.peer.party ?? "unknown",
      claimType: "underwriting.result",
    });
    ctx.setState(`uw-result:${ctx.conversation.id}`, {
      ...body.output,
      sourceAuthority: authority.outcome,
    } as JsonObject);
    return {
      type: "receipt",
      activity: `${ctx.conversation.id}#result-received`,
      outcome: "completed",
      final: true,
      observed: { stage: "underwriting-result-received", sourceAuthority: authority.outcome },
    };
  }
}

export class UnderwriterHandler implements OperationHandler {
  readonly description: OperationDescription = {
    id: UNDERWRITING_OP.id,
    version: UNDERWRITING_OP.version,
    label: "Underwriting check on attenuated application facts (synthetic)",
    pattern: "negotiate",
    access: "represented",
    roles: ["responder"],
    models: [UW_MODEL],
    purposes: [PURPOSE.creditChecking],
    effects: ["deterministic check; result delivered to the lender"],
    outcomes: ["pass | refer (not a lending decision)"],
  };
  readonly termsSchema = underwritingTerms as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  constructor(private readonly maxRetentionDays = 30) {}

  onProposal(ctx: HandlerContext, body: ProposeBody): HandlerReply {
    const t = underwritingTerms.parse(body.terms);
    if (t.purpose !== PURPOSE.creditChecking)
      return { type: "refuse", reason: "purpose-not-permitted" };
    if (t.retentionDays > this.maxRetentionDays)
      return { type: "refuse", reason: "excessive-scope", detail: "retention above policy" };
    // The underwriter cannot verify the consumer's grant itself; it relies on the lender's
    // attestation ONLY if its rules accept the lender for that claim type (scoped authority).
    const basis = ctx.assessSource({ source: t.basis.attestedBy, claimType: CLAIM.consentBasis });
    if (basis.outcome !== "accepted" || t.basis.attestedBy !== ctx.peer.party) {
      return {
        type: "refuse",
        reason: "source-not-authoritative",
        detail: "consent basis not attested by an accepted source",
      };
    }
    const facts = ctx.assessSource({
      source: t.basis.attestedBy,
      claimType: CLAIM.applicationFacts,
    });
    if (facts.outcome !== "accepted")
      return {
        type: "refuse",
        reason: "source-not-authoritative",
        detail: "lender not accepted for derived facts",
      };
    return {
      type: "accept",
      intent: {
        operation: UNDERWRITING_OP.id,
        action: "use",
        target: UNDERWRITING_OP.id,
        purpose: t.purpose,
        ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
        parameters: { termsDigest: body.termsDigest },
        conversation: ctx.conversation.id,
      },
    };
  }

  onAgreement(ctx: HandlerContext, agreement: Agreement): AgreementPlan {
    const t = underwritingTerms.parse(agreement.terms);
    const f = t.fields;
    const ltv = f.loanAmount / f.propertyPrice;
    const multiple =
      f.annualGrossIncome.value > 0
        ? f.loanAmount / f.annualGrossIncome.value
        : Number.POSITIVE_INFINITY;
    const depositOk = f.depositBalance.value >= f.propertyPrice - f.loanAmount;
    const pass = ltv <= 0.95 && multiple <= 4.5 && depositOk;
    const output: JsonObject = {
      result: pass ? "pass" : "refer",
      ratios: {
        loanToValue: Math.round(ltv * 1000) / 1000,
        incomeMultiple: Math.round(multiple * 100) / 100,
        depositCoversGap: depositOk,
      },
      rule: `${AWP}rule/synthetic-underwriting-thresholds/1`,
      limitations: [
        "synthetic thresholds",
        "relies on the lender's attested derived income",
        "not a lending decision",
      ],
    };
    return {
      requiredOutcomes: ["peer"],
      messages: [
        {
          kind: "deliver",
          body: {
            ref: agreement.id,
            basis: { kind: "agreement", agreement: agreement.id },
            operation: UNDERWRITING_OP,
            output,
          },
          intent: {
            operation: UNDERWRITING_OP.id,
            action: "distribute",
            target: `${AWP}op/underwriting-result`,
            purpose: t.purpose,
            ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
            parameters: { agreement: agreement.id },
            conversation: ctx.conversation.id,
          },
        },
      ],
    };
  }
}

// ------------------------------------------------------------------ valuation fee branch

export class SyntheticPaymentRail implements EffectAdapter {
  readonly id = "payment.instruction";
  readonly instructions = new Map<
    string,
    { amount: number; currency: string; status: "submitted"; settlement: "unknown" }
  >();

  async execute(key: string, params: JsonObject): Promise<EffectResult> {
    const existing = this.instructions.get(key);
    const rec = existing ?? {
      amount: Number(params.amount),
      currency: String(params.currency),
      status: "submitted" as const,
      settlement: "unknown" as const,
    };
    this.instructions.set(key, rec);
    return {
      conclusion: "completed",
      observed: {
        activity: "payment instruction submission",
        instructionKey: key,
        instructionStatus: rec.status,
        settlement: rec.settlement,
        amount: rec.amount,
        currency: rec.currency,
      },
    };
  }

  async reconcile(key: string): Promise<EffectResult> {
    const rec = this.instructions.get(key);
    return rec
      ? {
          conclusion: "completed",
          observed: {
            instructionKey: key,
            instructionStatus: rec.status,
            settlement: rec.settlement,
          },
        }
      : { conclusion: "not-executed", reason: "no instruction for key" };
  }
}

export function valuationDescription(roles: ("initiator" | "responder")[]): OperationDescription {
  return {
    id: VALUATION_OP.id,
    version: VALUATION_OP.version,
    label: "Valuation order with an applicant-paid fee (synthetic)",
    pattern: "negotiate",
    access: "represented",
    roles,
    models: [VALUATION_MODEL],
    purposes: [PURPOSE.mortgagePrequalification],
    effects: ["payment instruction submitted (synthetic rail; settlement not observed)"],
    outcomes: [
      "quote accepted",
      "instruction submitted",
      "settlement unknown ⇒ obligation not shown fulfilled",
    ],
  };
}

export class ConsumerValuationHandler implements OperationHandler {
  readonly description = valuationDescription(["responder"]);
  readonly termsSchema = valuationTerms as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  private feeIntent(ctx: HandlerContext, terms: JsonObject, termsDigest: string): ActionIntent {
    const t = valuationTerms.parse(terms);
    return {
      operation: VALUATION_OP.id,
      action: "compensate",
      target: PAYMENT_OP,
      purpose: PURPOSE.mortgagePrequalification,
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: { termsDigest, amount: t.fee.amount, currency: t.fee.currency },
      conversation: ctx.conversation.id,
    };
  }

  onProposal(ctx: HandlerContext, body: ProposeBody): HandlerReply {
    return { type: "accept", intent: this.feeIntent(ctx, body.terms, body.termsDigest) };
  }

  onAgreement(ctx: HandlerContext, agreement: Agreement): AgreementPlan {
    const t = valuationTerms.parse(agreement.terms);
    return {
      requiredOutcomes: ["self"],
      effects: [
        {
          adapter: "payment.instruction",
          key: `${agreement.id}#fee`,
          params: {
            amount: t.fee.amount,
            currency: t.fee.currency,
            payee: ctx.peer.party ?? "unknown",
          },
          intent: this.feeIntent(ctx, agreement.terms, agreement.termsDigest),
          activityType: `${AWP}PaymentInstructionSubmission`,
          receipt: { final: true },
        },
      ],
    };
  }
}

export class LenderValuationHandler implements OperationHandler {
  readonly description = valuationDescription(["initiator"]);
  readonly termsSchema = valuationTerms as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  intentForProposal(ctx: HandlerContext, terms: JsonObject): ActionIntent {
    return {
      operation: VALUATION_OP.id,
      action: "use",
      target: VALUATION_OP.id,
      purpose: PURPOSE.mortgagePrequalification,
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: { termsDigest: digestOf(terms) },
      conversation: ctx.conversation.id,
    };
  }

  onAgreement(): AgreementPlan {
    return { requiredOutcomes: ["peer"] };
  }

  onReceipt(ctx: HandlerContext, body: { observed?: JsonObject; final?: boolean }): HandlerReply {
    const settlement = body.observed?.settlement;
    ctx.record({
      type: "fulfilment-assessment",
      obligation: `${ctx.conversation.agreement ?? ctx.conversation.id}#fee`,
      evaluator: ctx.self.actor,
      instruction: body.observed?.instructionStatus ?? "unknown",
      settlement: settlement ?? "unknown",
      conclusion: settlement === "settled" ? "fulfilled" : "unresolved",
      note: "a submitted instruction is not settlement; the fee obligation is not reported fulfilled",
    });
    return { type: "none" };
  }
}

export function valuationTermsFor(applicationRef: Iri, valuer: Iri, amount: number): JsonObject {
  return {
    model: VALUATION_MODEL.id,
    applicationRef,
    valuer,
    fee: { amount, currency: "USD", payableBy: "applicant" },
    synthetic: true,
  };
}

export function applicationTermsFor(
  applicant: Iri,
  propertyPrice: number,
  loanAmount: number,
): JsonObject {
  return {
    model: `${AWP}model/mortgage-application`,
    propertyPrice,
    loanAmount,
    currency: "USD",
    applicant,
    synthetic: true,
  };
}

/** Terms builder used by the lender's workflow once the PEP has permitted the onward read. */
export function underwritingTermsFor(input: {
  applicationRef: Iri;
  annualGrossIncome: number;
  derivedFrom: readonly Iri[];
  depositBalance: number;
  loanAmount: number;
  propertyPrice: number;
  consumerAgreement: Iri;
  onwardRule: Iri;
  lender: Iri;
}): UnderwritingTerms {
  return {
    model: UW_MODEL.id,
    applicationRef: input.applicationRef,
    fields: {
      annualGrossIncome: {
        value: input.annualGrossIncome,
        currency: "USD",
        derivation: DERIVATION_RULE.id,
        derivedFrom: [...input.derivedFrom],
      },
      depositBalance: { value: input.depositBalance, currency: "USD" },
      loanAmount: input.loanAmount,
      propertyPrice: input.propertyPrice,
    },
    purpose: PURPOSE.creditChecking,
    basis: {
      consumerAgreement: input.consumerAgreement,
      onwardRule: input.onwardRule,
      attestedBy: input.lender,
    },
    retentionDays: 30,
    noRedistribution: true,
    synthetic: true,
  };
}
