/**
 * Domain adapter: UC-05 industrial maintenance data exchange (synthetic companies, asset
 * and telemetry; no real data space, connector or programme membership).
 *
 * Kept as separate states and records: participant eligibility (programme credential),
 * internal delegation (org-signed representation scope + the authority agent's mandate),
 * the user's third-party access authorisation, the offer, the agreement (exact terms
 * digest), transfer attempts, the diagnostic recommendation (a modelled assertion), its
 * acceptance, the work order, and synthetic performance.
 */
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { z } from "zod";
import { digestOf, newUrn } from "../core/canonical.js";
import { iso } from "../core/schema.js";
import type {
  ActionIntent,
  Agreement,
  DeliverBody,
  EvidenceItem,
  InvokeBody,
  Iri,
  JsonObject,
  ProposeBody,
} from "../core/types.js";
import type { SigningKey } from "../mechanisms/jws.js";
import { signStatement, TYP } from "../mechanisms/statements.js";
import type { OperationDescription } from "../profile/description.js";
import { AWP, FIXTURE, PURPOSE } from "../profile/vocabulary.js";
import type {
  AgreementPlan,
  EffectAdapter,
  EffectResult,
  HandlerContext,
  HandlerReply,
  OperationHandler,
} from "../runtime/operations.js";
import { PURPOSE_STORE_RELEASE_CONDITION, type PurposeBoundStore } from "./purpose-store.js";

export const INTERNAL_TPA_OP = {
  id: `${AWP}op/internal-third-party-access-request`,
  version: "0.1",
} as const;
export const DATA_OFFER_OP = { id: `${AWP}op/data-offer-agreement`, version: "0.1" } as const;
export const TRANSFER_OP = { id: `${AWP}op/telemetry-transfer`, version: "0.1" } as const;
export const RECOMMENDATION_OP = {
  id: `${AWP}op/maintenance-recommendation`,
  version: "0.1",
} as const;
/** NordWerk-internal: an internal agent asks the organisation's enforcement point for data. */
export const DATASET_READ_OP = { id: `${AWP}op/internal-dataset-read`, version: "0.1" } as const;
export const TPA_TARGET = `${AWP}op/issue-third-party-access-authorisation`;
export const EQUIPMENT_HEALTH = { id: `${FIXTURE}EquipmentHealth`, version: "1.2" } as const;
export const EQUIPMENT_HEALTH_OLD = { id: `${FIXTURE}EquipmentHealth`, version: "1.1" } as const;
export const REQUEST_MODEL = {
  id: `${AWP}model/third-party-access-request`,
  version: "0.1",
} as const;
export const RECOMMENDATION_MODEL = {
  id: `${AWP}model/maintenance-recommendation`,
  version: "0.1",
} as const;
export const ASSET = "urn:orbis:asset:PRESS-204";
export const OFFER_ID = "urn:orbis:offer:press-204-telemetry";
export const CLAIM_TPA = "data-access.third-party-authorisation";

const window = z.strictObject({ start: iso, end: iso });

export const participantCredentialSchema = z
  .object({
    type: z.literal("ParticipantCredential"),
    id: z.string().max(512),
    issuer: z.string().max(512),
    subject: z.string().max(512),
    programme: z.string().max(256),
    issuedAt: iso,
    validUntil: iso,
  })
  .strict();
export const tpaSchema = z
  .object({
    type: z.literal("ThirdPartyAccessAuthorisation"),
    id: z.string().max(512),
    issuer: z.string().max(512),
    user: z.string().max(512),
    requestedBy: z.string().max(512),
    dataHolder: z.string().max(512),
    recipient: z.string().max(512),
    asset: z.string().max(512),
    window,
    purpose: z.string().max(512),
    retentionDays: z.number().int().min(1).max(365),
    issuedAt: iso,
    validUntil: iso,
  })
  .strict();
export type ThirdPartyAccessAuthorisation = z.infer<typeof tpaSchema>;

const tpaRequest = z.strictObject({
  model: z.literal(REQUEST_MODEL.id),
  asset: z.string().max(512),
  dataHolder: z.string().max(512),
  recipient: z.string().max(512),
  window,
  purpose: z.string().max(512),
  retentionDays: z.number().int().min(1).max(365),
});
export const offerTerms = z.strictObject({
  model: z.literal(EQUIPMENT_HEALTH.id),
  modelVersion: z.string().max(16),
  offerId: z.string().max(512),
  asset: z.string().max(512),
  window,
  purpose: z.string().max(512),
  recipient: z.string().max(512),
  retentionDays: z.number().int().min(1).max(365),
  noRedistribution: z.literal(true),
  thirdPartyAuthorisation: z.string().max(512),
  synthetic: z.literal(true),
});
export type OfferTerms = z.infer<typeof offerTerms>;
const recommendationTerms = z.strictObject({
  model: z.literal(RECOMMENDATION_MODEL.id),
  asset: z.string().max(512),
  assertion: z.strictObject({
    risk: z.enum(["low", "medium", "high"]),
    confidence: z.number().min(0).max(1),
    basis: z.array(z.string().max(512)).max(8),
    limitations: z.array(z.string().max(256)).max(8),
  }),
  proposedAction: z.strictObject({
    kind: z.literal("inspect-bearing"),
    withinDays: z.number().int().min(1).max(60),
    cost: z.literal(0),
  }),
  dataset: z.string().max(512),
  synthetic: z.literal(true),
});

function desc(
  op: { id: string; version: string },
  label: string,
  pattern: "negotiate" | "invoke",
  roles: ("initiator" | "responder")[],
  models: { id: string; version: string }[],
): OperationDescription {
  return {
    id: op.id,
    version: op.version,
    label,
    pattern,
    access: "represented",
    roles,
    models,
    purposes: [PURPOSE.maintenance],
    effects: [],
    outcomes: [],
    limitations: [
      "synthetic organisations and data; no programme membership or Data Act conclusion implied",
    ],
  };
}

// ------------------------------------------------------------------ Alpine (data user)

export class AlpineAuthorityHandler implements OperationHandler {
  readonly description = desc(
    INTERNAL_TPA_OP,
    "Alpine internal: issue a third-party access authorisation",
    "invoke",
    ["responder"],
    [REQUEST_MODEL],
  );
  readonly inputSchema = tpaRequest as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  constructor(private readonly cfg: { user: Iri; issuer: Iri; issuerKey: SigningKey }) {}

  async onInvoke(ctx: HandlerContext, body: InvokeBody): Promise<HandlerReply> {
    const r = tpaRequest.parse(body.input);
    const intent: ActionIntent = {
      operation: INTERNAL_TPA_OP.id,
      action: "use",
      target: TPA_TARGET,
      purpose: r.purpose,
      recipient: r.recipient,
      parameters: { asset: r.asset, window: r.window, retentionDays: r.retentionDays },
      conversation: ctx.conversation.id,
    };
    const statement: ThirdPartyAccessAuthorisation = {
      type: "ThirdPartyAccessAuthorisation",
      id: newUrn(),
      issuer: this.cfg.issuer,
      user: this.cfg.user,
      requestedBy: ctx.peer.actor ?? "unknown",
      dataHolder: r.dataHolder,
      recipient: r.recipient,
      asset: r.asset,
      window: r.window,
      purpose: r.purpose,
      retentionDays: r.retentionDays,
      issuedAt: ctx.now,
      validUntil: new Date(Date.parse(ctx.now) + 7 * 86_400_000).toISOString(),
    };
    // Minted here, released only if the executor permits this deliver under Alpine's mandate.
    const jws = await signStatement(this.cfg.issuerKey, TYP.statement, statement);
    return { type: "deliver", output: { authorisation: jws, id: statement.id }, intent };
  }
}

export class AlpinePlannerHandler implements OperationHandler {
  readonly description: OperationDescription;
  readonly requiresRepresentation = true;
  authorisation?: string;
  readonly termsSchema = recommendationTerms as unknown as z.ZodType<JsonObject>;

  constructor(readonly op: typeof INTERNAL_TPA_OP | typeof RECOMMENDATION_OP) {
    this.description =
      op === INTERNAL_TPA_OP
        ? desc(op, "Alpine planner (requests access)", "invoke", ["initiator"], [REQUEST_MODEL])
        : desc(
            op,
            "Alpine planner (evaluates recommendations)",
            "negotiate",
            ["responder"],
            [RECOMMENDATION_MODEL],
          );
  }

  intentForInvoke(ctx: HandlerContext, input: JsonObject): ActionIntent {
    return {
      operation: INTERNAL_TPA_OP.id,
      action: "use",
      target: INTERNAL_TPA_OP.id,
      purpose: String(input.purpose),
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: { asset: String(input.asset) },
      conversation: ctx.conversation.id,
    };
  }

  onDeliver(_ctx: HandlerContext, body: DeliverBody): HandlerReply {
    this.authorisation = String(body.output.authorisation ?? "");
    return { type: "none" };
  }

  onProposal(ctx: HandlerContext, body: ProposeBody): HandlerReply {
    const t = recommendationTerms.parse(body.terms);
    if (t.asset !== ASSET)
      return { type: "refuse", reason: "invalid-terms", detail: "unknown asset" };
    if (t.assertion.risk !== "high" || t.assertion.confidence < 0.6)
      return {
        type: "refuse",
        reason: "invalid-terms",
        detail: "recommendation does not meet the acceptance rule (high risk, confidence ≥ 0.6)",
      };
    return {
      type: "accept",
      intent: {
        operation: RECOMMENDATION_OP.id,
        action: "use",
        target: RECOMMENDATION_OP.id,
        purpose: PURPOSE.maintenance,
        ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
        parameters: { termsDigest: body.termsDigest },
        conversation: ctx.conversation.id,
      },
    };
  }

  onAgreement(ctx: HandlerContext, agreement: Agreement): AgreementPlan {
    const t = recommendationTerms.parse(agreement.terms);
    return {
      requiredOutcomes: ["self"],
      effects: [
        {
          adapter: "workorder.create",
          key: `${agreement.id}#work-order`,
          params: {
            asset: t.asset,
            action: t.proposedAction.kind,
            withinDays: t.proposedAction.withinDays,
          },
          intent: {
            operation: RECOMMENDATION_OP.id,
            action: "use",
            target: RECOMMENDATION_OP.id,
            purpose: PURPOSE.maintenance,
            ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
            parameters: { termsDigest: agreement.termsDigest },
            conversation: ctx.conversation.id,
          },
          activityType: `${AWP}CreateWorkOrder`,
          receipt: { final: true },
        },
      ],
    };
  }
}

export interface WorkOrder {
  id: string;
  status: "open" | "completed-synthetic";
}

export class SyntheticWorkOrders implements EffectAdapter {
  readonly id = "workorder.create";
  readonly orders: Map<string, WorkOrder>;
  /** `persist` (durable roles): orders are loaded once and saved BEFORE execute returns. */
  constructor(
    private readonly persist?: {
      load(): Record<string, WorkOrder>;
      save(orders: Record<string, WorkOrder>): void;
    },
  ) {
    this.orders = new Map(Object.entries(persist?.load() ?? {}));
  }
  async execute(key: string): Promise<EffectResult> {
    const o = this.orders.get(key) ?? { id: `WO-${this.orders.size + 1}`, status: "open" as const };
    this.orders.set(key, o);
    this.persist?.save(Object.fromEntries(this.orders));
    return {
      conclusion: "completed",
      observed: {
        workOrder: o.id,
        status: o.status,
        note: "creation of a synthetic work order; not performance",
      },
    };
  }
  async reconcile(key: string): Promise<EffectResult> {
    const o = this.orders.get(key);
    return o
      ? { conclusion: "completed", observed: { workOrder: o.id, status: o.status } }
      : { conclusion: "not-executed", reason: "no work order" };
  }
}

// ------------------------------------------------------------------ Orbis (data holder)

export interface TelemetrySample {
  readonly t: string;
  readonly vibrationRms: number;
  readonly temperatureC: number;
}

export function syntheticTelemetry(end: Date, hours = 72): TelemetrySample[] {
  return Array.from({ length: hours }, (_, i) => {
    const t = new Date(end.getTime() - (hours - 1 - i) * 3_600_000);
    const recent = i >= hours - 24;
    return {
      t: t.toISOString(),
      vibrationRms: recent ? 4.2 + (i % 3) * 0.1 : 2.0 + (i % 4) * 0.05,
      temperatureC: recent ? 61 : 55,
    };
  });
}

export class OrbisProviderHandler implements OperationHandler {
  readonly description: OperationDescription;
  readonly termsSchema = offerTerms as unknown as z.ZodType<JsonObject>;
  readonly inputSchema = z.strictObject({
    dataset: z.literal("vibration-temperature"),
  }) as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;
  failNextTransfer = false;
  readonly transfers: Array<{ agreement: Iri; outcome: string }> = [];
  /** The data model version this provider offers (default: the current EquipmentHealth). */
  private readonly model: { id: string; version: string };

  constructor(
    private readonly op: typeof DATA_OFFER_OP | typeof TRANSFER_OP,
    private readonly cfg: {
      holder: Iri;
      programmeIssuer: Iri;
      userIssuer: Iri;
      telemetry: () => TelemetrySample[];
      shared: { agreements: Map<Iri, OfferTerms>; delivered: Map<Iri, string> };
      model?: { id: string; version: string };
    },
  ) {
    this.model = cfg.model ?? EQUIPMENT_HEALTH;
    this.description =
      op === DATA_OFFER_OP
        ? desc(op, "Orbis restricted telemetry offer", "negotiate", ["responder"], [this.model])
        : desc(
            op,
            "Orbis telemetry transfer (after agreement only)",
            "invoke",
            ["responder"],
            [this.model],
          );
  }

  private async membership(
    ctx: HandlerContext,
    evidence: readonly EvidenceItem[],
    party: Iri | undefined,
  ): Promise<boolean> {
    for (const e of evidence.filter((x) => x.role === "membership")) {
      const v = await ctx.verify(e.value, {
        typ: TYP.statement,
        role: "issuer",
        schema: participantCredentialSchema,
      });
      const c = v.payload;
      if (
        c &&
        v.verification.outcome === "valid" &&
        v.signer?.subject === this.cfg.programmeIssuer &&
        c.issuer === this.cfg.programmeIssuer &&
        c.subject === party &&
        Date.parse(c.validUntil) > Date.parse(ctx.now)
      ) {
        ctx.record({
          type: "participant-eligibility",
          party,
          credential: c.id,
          outcome: "eligible",
          note: "identifies a programme participant; says nothing about which internal agent may bind it",
        });
        return true;
      }
    }
    ctx.record({
      type: "participant-eligibility",
      party: party ?? "unknown",
      outcome: "not-shown",
    });
    return false;
  }

  async describeFor(
    ctx: HandlerContext,
    evidence: readonly EvidenceItem[],
  ): Promise<JsonObject | undefined> {
    if (this.op !== DATA_OFFER_OP) return undefined;
    const eligible = await this.membership(ctx, evidence, ctx.message?.from.onBehalfOf);
    return {
      catalogue: eligible
        ? [
            {
              offerId: OFFER_ID,
              asset: ASSET,
              model: this.model as unknown as JsonObject,
              allowedPurposes: [PURPOSE.maintenance],
              maxRetentionDays: 30,
              requiresNoRedistribution: true,
              source: { sensors: ["VIB-1", "TMP-1"], lastCalibration: "2026-06-01" },
            },
          ]
        : [],
      restricted: !eligible,
    };
  }

  async onProposal(ctx: HandlerContext, body: ProposeBody): Promise<HandlerReply> {
    const t = offerTerms.parse(body.terms);
    const evidence = ctx.message?.evidence ?? [];
    if (!(await this.membership(ctx, evidence, ctx.peer.party)))
      return {
        type: "refuse",
        reason: "not-authorised",
        detail: "no valid participant credential",
      };
    if (t.offerId !== OFFER_ID || t.asset !== ASSET || t.modelVersion !== this.model.version)
      return {
        type: "refuse",
        reason: "invalid-terms",
        detail: "unknown offer/asset/model version",
      };
    if (t.retentionDays > 30)
      return { type: "refuse", reason: "excessive-scope", detail: "retention above offer maximum" };
    const item = evidence.find((e) => e.role === "authorisation");
    if (!item)
      return {
        type: "refuse",
        reason: "not-authorised",
        detail: "no third-party access authorisation from the user",
      };
    const v = await ctx.verify(item.value, {
      typ: TYP.statement,
      role: "issuer",
      schema: tpaSchema,
    });
    const a = v.payload;
    if (
      !a ||
      v.verification.outcome !== "valid" ||
      v.signer?.subject !== this.cfg.userIssuer ||
      a.issuer !== this.cfg.userIssuer
    )
      return { type: "refuse", reason: "not-authorised", detail: "authorisation not verified" };
    const authority = ctx.assessSource({
      source: a.issuer,
      claimType: CLAIM_TPA,
      subject: a.asset,
    });
    if (authority.outcome !== "accepted")
      return {
        type: "refuse",
        reason: "source-not-authoritative",
        detail: "issuer not accepted for third-party access to this asset",
      };
    if (
      a.dataHolder !== this.cfg.holder ||
      a.recipient !== ctx.peer.party ||
      a.asset !== t.asset ||
      a.id !== t.thirdPartyAuthorisation
    )
      return {
        type: "refuse",
        reason: "not-authorised",
        detail: "authorisation is for another holder/recipient/asset",
      };
    if (a.purpose !== t.purpose)
      return {
        type: "refuse",
        reason: "purpose-not-permitted",
        detail: "purpose differs from the user's authorisation",
      };
    if (
      Date.parse(t.window.start) < Date.parse(a.window.start) ||
      Date.parse(t.window.end) > Date.parse(a.window.end) ||
      t.retentionDays > a.retentionDays
    )
      return {
        type: "refuse",
        reason: "excessive-scope",
        detail: "window or retention exceeds the authorisation",
      };
    if (Date.parse(a.validUntil) <= Date.parse(ctx.now))
      return { type: "refuse", reason: "grant-expired", detail: "authorisation expired" };
    return {
      type: "accept",
      intent: {
        operation: DATA_OFFER_OP.id,
        action: "use",
        target: DATA_OFFER_OP.id,
        purpose: t.purpose,
        ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
        parameters: { termsDigest: body.termsDigest },
        conversation: ctx.conversation.id,
      },
    };
  }

  onAgreement(_ctx: HandlerContext, agreement: Agreement): AgreementPlan {
    this.cfg.shared.agreements.set(agreement.id, offerTerms.parse(agreement.terms));
    return { requiredOutcomes: ["peer"] };
  }

  onInvoke(ctx: HandlerContext, body: InvokeBody): HandlerReply {
    if (body.basis.kind !== "agreement") return { type: "refuse", reason: "no-agreement" };
    const t = this.cfg.shared.agreements.get(body.basis.agreement);
    if (!t) return { type: "refuse", reason: "no-agreement", detail: "no agreement with that id" };
    if (this.failNextTransfer) {
      this.failNextTransfer = false;
      this.transfers.push({ agreement: body.basis.agreement, outcome: "not-executed" });
      return {
        type: "receipt",
        activity: `${body.basis.agreement}#transfer-${this.transfers.length}`,
        outcome: "not-executed",
        final: false,
        observed: {
          state: "agreement accepted; data not yet delivered",
          cause: "synthetic connector failure",
        },
      };
    }
    const samples = this.cfg
      .telemetry()
      .filter(
        (s) =>
          Date.parse(s.t) >= Date.parse(t.window.start) &&
          Date.parse(s.t) <= Date.parse(t.window.end),
      );
    const datasetId =
      this.cfg.shared.delivered.get(body.basis.agreement) ??
      `urn:orbis:dataset:${digestOf({ agreement: body.basis.agreement }).slice(9, 25)}`;
    const repeat = this.cfg.shared.delivered.has(body.basis.agreement);
    this.cfg.shared.delivered.set(body.basis.agreement, datasetId);
    this.transfers.push({
      agreement: body.basis.agreement,
      outcome: repeat ? "repeat-same-dataset" : "delivered",
    });
    ctx.record({
      type: "transfer",
      agreement: body.basis.agreement,
      dataset: datasetId,
      samples: samples.length,
      repeat,
    });
    return {
      type: "deliver",
      output: {
        dataset: datasetId,
        repeat,
        model: this.model as unknown as JsonObject,
        asset: t.asset,
        source: {
          holder: this.cfg.holder,
          sensors: ["VIB-1", "TMP-1"],
          lastCalibration: "2026-06-01",
        },
        samples: samples as unknown as JsonObject[],
      },
    };
  }
}

// ------------------------------------------------------------------ NordWerk (recipient)

export function consumerGrant(
  agreement: Agreement,
  t: OfferTerms,
  holder: Iri,
  recipient: Iri,
): { target: Iri; policy: OdrlPolicy } {
  const target = `${agreement.id}#dataset`;
  return {
    target,
    policy: {
      id: `${agreement.id}#usage-policy`,
      type: "Agreement",
      assigner: holder,
      assignee: recipient,
      conflict: "prohibit",
      permissions: [
        {
          id: `${agreement.id}#use-for-purpose`,
          type: "permission",
          action: "read",
          target,
          constraints: [{ leftOperand: "purpose", operator: "isAnyOf", rightOperand: [t.purpose] }],
        },
      ],
      prohibitions: [
        {
          id: `${agreement.id}#no-redistribution`,
          type: "prohibition",
          action: "distribute",
          target,
        },
        {
          id: `${agreement.id}#no-other-purpose`,
          type: "prohibition",
          action: "use",
          target,
          constraints: [
            { leftOperand: "purpose", operator: "isNoneOf", rightOperand: [t.purpose] },
          ],
        },
      ],
    },
  };
}

export class NordWerkContractHandler implements OperationHandler {
  readonly description: OperationDescription;
  readonly termsSchema = offerTerms as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;
  readonly datasets: Array<{ id: string; storedAs: string }> = [];

  constructor(
    private readonly op: typeof DATA_OFFER_OP | typeof TRANSFER_OP,
    private readonly cfg: {
      holder: Iri;
      recipient: Iri;
      store: PurposeBoundStore;
      acceptedModels: readonly { id: string; version: string }[];
    },
  ) {
    this.description = desc(
      op,
      "NordWerk data consumer",
      op === DATA_OFFER_OP ? "negotiate" : "invoke",
      ["initiator"],
      [...cfg.acceptedModels],
    );
  }

  vetDescription(_ctx: HandlerContext, description: JsonObject) {
    if (this.op !== DATA_OFFER_OP) return undefined;
    const catalogue = (description.extensions as JsonObject | undefined)?.catalogue;
    const offer = Array.isArray(catalogue)
      ? (catalogue as JsonObject[]).find((o) => o.offerId === OFFER_ID)
      : undefined;
    if (!offer)
      return {
        reason: "unsupported-operation" as const,
        detail: "offer not visible (restricted catalogue)",
      };
    const model = offer.model as { id?: string; version?: string };
    if (!this.cfg.acceptedModels.some((m) => m.id === model.id && m.version === model.version)) {
      return {
        reason: "unsupported-term" as const,
        detail: `offer model ${model.version} not accepted and no accepted mapping`,
      };
    }
    return undefined;
  }

  intentForProposal(ctx: HandlerContext, terms: JsonObject): ActionIntent {
    return {
      operation: DATA_OFFER_OP.id,
      action: "use",
      target: DATA_OFFER_OP.id,
      purpose: String(terms.purpose),
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: { termsDigest: digestOf(terms) },
      conversation: ctx.conversation.id,
    };
  }

  intentForInvoke(ctx: HandlerContext): ActionIntent {
    return {
      operation: TRANSFER_OP.id,
      action: "use",
      target: TRANSFER_OP.id,
      purpose: PURPOSE.maintenance,
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: { agreement: ctx.conversation.agreement ?? "none" },
      conversation: ctx.conversation.id,
    };
  }

  onAgreement(ctx: HandlerContext, agreement: Agreement): AgreementPlan {
    ctx.setState(`terms:${agreement.id}`, agreement.terms);
    return { requiredOutcomes: ["self"] };
  }

  onDeliver(ctx: HandlerContext, body: DeliverBody): HandlerReply {
    const agreementId = body.basis.kind === "agreement" ? body.basis.agreement : "";
    const t = offerTerms.parse(ctx.getState<JsonObject>(`terms:${agreementId}`) ?? {});
    const out = body.output as {
      dataset?: string;
      model?: { id?: string; version?: string };
      samples?: TelemetrySample[];
      asset?: string;
    };
    if (out.model?.id !== EQUIPMENT_HEALTH.id || out.model.version !== EQUIPMENT_HEALTH.version)
      return {
        type: "refuse",
        reason: "unsupported-term",
        detail: "delivered model version differs from the agreement",
      };
    const authority = ctx.assessSource({
      source: this.cfg.holder,
      claimType: "telemetry.vibration",
      subject: out.asset ?? "",
    });
    const grant = consumerGrant(
      { id: agreementId } as Agreement,
      t,
      this.cfg.holder,
      this.cfg.recipient,
    );
    const storedAs = `${out.dataset}`;
    if (!this.cfg.store.has(storedAs)) {
      this.cfg.store.put({
        id: storedAs,
        claimType: "telemetry.vibration-temperature",
        subject: out.asset ?? "",
        source: this.cfg.holder,
        data: {
          samples: (out.samples ?? []) as unknown as JsonObject[],
          sourceAuthority: authority.outcome,
        },
        grant: {
          id: grant.policy.id,
          target: grant.target,
          policy: grant.policy,
          assignee: this.cfg.recipient,
          validUntil: new Date(Date.parse(ctx.now) + t.retentionDays * 86_400_000).toISOString(),
        },
      });
      this.datasets.push({ id: out.dataset ?? "", storedAs });
    }
    return {
      type: "receipt",
      activity: `${agreementId}#received`,
      outcome: "completed",
      final: true,
      observed: {
        dataset: out.dataset ?? "",
        samples: (out.samples ?? []).length,
        sourceAuthority: authority.outcome,
      },
    };
  }

  onReceipt(ctx: HandlerContext, body: { outcome: string; observed?: JsonObject }): HandlerReply {
    ctx.record({
      type: "transfer-status",
      reported: body.outcome,
      state: body.observed?.state ?? "n/a",
    });
    return { type: "none" };
  }
}

export class NordWerkDiagnosticHandler implements OperationHandler {
  readonly description = desc(
    RECOMMENDATION_OP,
    "NordWerk diagnostic recommendation",
    "negotiate",
    ["initiator"],
    [RECOMMENDATION_MODEL],
  );
  readonly termsSchema = recommendationTerms as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  intentForProposal(ctx: HandlerContext, terms: JsonObject): ActionIntent {
    return {
      operation: RECOMMENDATION_OP.id,
      action: "use",
      target: RECOMMENDATION_OP.id,
      purpose: PURPOSE.maintenance,
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: { termsDigest: digestOf(terms) },
      conversation: ctx.conversation.id,
    };
  }

  onAgreement(): AgreementPlan {
    return { requiredOutcomes: ["peer"] };
  }
}

// ------------------------------------------------------------------ NordWerk internal data access

const datasetReadInput = z.strictObject({
  dataset: z.string().min(8).max(512),
  purpose: z.string().max(512),
});

/**
 * NordWerk's enforcement point, served by the contracting agent that holds the received data:
 * another NordWerk agent asks for a stored dataset for a purpose. The REQUESTING AGENT is the
 * verified signer of the message (`ctx.message.from.actor`, checked by the runtime against its
 * pinned key, and represented by NordWerk for this operation) — never a value in the input. The
 * store's internal roles and the agreed data-use grant decide; every decision is in the store's
 * own ledger. Organisation membership alone grants nothing.
 */
export class NordWerkDatasetHandler implements OperationHandler {
  readonly description = desc(
    DATASET_READ_OP,
    "NordWerk internal: read a stored dataset through the organisation's enforcement point",
    "invoke",
    ["responder"],
    [EQUIPMENT_HEALTH],
  );
  readonly inputSchema = datasetReadInput as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  constructor(private readonly cfg: { organisation: Iri; store: PurposeBoundStore }) {}

  onInvoke(ctx: HandlerContext, body: InvokeBody): HandlerReply {
    const input = datasetReadInput.parse(body.input);
    const agent = ctx.message?.from.actor;
    if (!agent || ctx.message?.from.onBehalfOf !== this.cfg.organisation)
      return { type: "refuse", reason: "not-authorised", detail: "internal operation" };
    const d = this.cfg.store.request({
      agent,
      action: "read",
      items: [input.dataset],
      purpose: input.purpose,
    });
    if (d.decision !== "permit")
      return {
        type: "refuse",
        reason:
          d.decision === "indeterminate"
            ? "indeterminate-policy"
            : / expired|erased/.test(d.reason)
              ? "grant-expired"
              : d.reason.startsWith("grant ")
                ? "purpose-not-permitted"
                : "not-authorised",
        detail: d.reason,
      };
    const item = d.items?.[0];
    const revision = this.cfg.store.revisionOf(input.dataset);
    return {
      type: "deliver",
      output: {
        dataset: input.dataset,
        source: item?.source ?? "",
        asset: item?.subject ?? "",
        grant: item?.grant.id ?? "",
        samples: ((item?.data as { samples?: JsonObject[] })?.samples ?? []) as JsonObject[],
        released: "for this purpose only; copies outside the enforcement point are not controlled",
      },
      // PROTECTED payload: leaves only if the enforcement point still permits this release (same
      // verified agent, action, item revision and purpose) at transmission time.
      conditions: [
        {
          kind: PURPOSE_STORE_RELEASE_CONDITION,
          ref: {
            agent,
            action: "read",
            items: [input.dataset],
            purpose: input.purpose,
            ...(revision ? { revisions: { [input.dataset]: revision } } : {}),
          },
        },
      ],
    };
  }
}

/**
 * The diagnostic agent's side of the internal read: it derives a MODELLED assertion from the
 * released samples at once and keeps only that assertion, the dataset id and the sample count
 * (not the raw telemetry).
 */
export class DiagnosticReaderHandler implements OperationHandler {
  readonly description = desc(
    DATASET_READ_OP,
    "NordWerk diagnostic: request a dataset for diagnosis",
    "invoke",
    ["initiator"],
    [EQUIPMENT_HEALTH],
  );
  readonly requiresRepresentation = false;
  readonly diagnoses: Array<{
    dataset: string;
    grant: string;
    source: string;
    samples: number;
    at: string;
    result: JsonObject;
  }> = [];

  intentForInvoke(ctx: HandlerContext, input: JsonObject): ActionIntent {
    return {
      operation: DATASET_READ_OP.id,
      action: "use",
      target: DATASET_READ_OP.id,
      purpose: String(input.purpose),
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: { dataset: String(input.dataset) },
      conversation: ctx.conversation.id,
    };
  }

  onDeliver(ctx: HandlerContext, body: DeliverBody): HandlerReply {
    const out = body.output as {
      dataset?: string;
      grant?: string;
      source?: string;
      samples?: TelemetrySample[];
    };
    const samples = out.samples ?? [];
    this.diagnoses.push({
      dataset: out.dataset ?? "",
      grant: out.grant ?? "",
      source: out.source ?? "",
      samples: samples.length,
      at: ctx.now,
      result: diagnose(samples, ctx.now) as unknown as JsonObject,
    });
    return { type: "none" };
  }
}

/** Deterministic diagnosis over PEP-released samples. Returns a modelled assertion. */
export function diagnose(
  samples: readonly TelemetrySample[],
  now: string,
):
  | { risk: "low" | "medium" | "high"; confidence: number; limitations: string[] }
  | { stale: true; detail: string } {
  if (samples.length === 0) return { stale: true, detail: "no samples" };
  const latest = Math.max(...samples.map((s) => Date.parse(s.t)));
  if (Date.parse(now) - latest > 6 * 3_600_000)
    return { stale: true, detail: "latest sample older than 6 hours" };
  const recent = samples.filter((s) => Date.parse(s.t) > latest - 24 * 3_600_000);
  const baseline = samples.filter((s) => Date.parse(s.t) <= latest - 24 * 3_600_000);
  const mean = (xs: readonly TelemetrySample[]) =>
    xs.reduce((a, s) => a + s.vibrationRms, 0) / Math.max(1, xs.length);
  const ratio = mean(recent) / Math.max(0.01, mean(baseline));
  const completeness = Math.min(1, samples.length / 72);
  const risk = ratio > 1.8 ? "high" : ratio > 1.3 ? "medium" : "low";
  return {
    risk,
    confidence: Math.round(Math.min(0.9, 0.5 + 0.4 * completeness) * 100) / 100,
    limitations: [
      "synthetic telemetry",
      "calibration taken from source metadata, not verified",
      `vibration ratio ${ratio.toFixed(2)} vs 72h baseline`,
    ],
  };
}
