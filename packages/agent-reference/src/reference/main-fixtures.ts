// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * The extra parties and fixtures of `mortgage-main`: the mortgage product index, Harbour Bank
 * running as an agent, a stand-in identity provider, the identity framework register, and the
 * lenders' signed product records. Every party, figure and key is fictional; keys are fixed
 * test keys (see keys.ts).
 */
import type { ActionIntent, DeliverBody, Iri, JsonObject } from "../core/types.js";
import { PREQUAL_OP, VALUATION_OP } from "../domains/mortgage.js";
import { NORTH, SAM, samMortgageMandate } from "../fixtures/mortgage.js";
import type { OperationDescription } from "../profile/description.js";
import { AWP, PURPOSE } from "../profile/vocabulary.js";
import type { HandlerContext, HandlerReply, OperationHandler } from "../runtime/operations.js";
import type { Ids } from "../scenarios/common.js";
import { mandateOf, permit } from "../scenarios/common.js";
import type { Register, RegisterEntry, TrustRoot } from "../trust/resolver.js";
import { DECISION_CLAIM, HARBOUR } from "./fixtures.js";

export const INDEX = {
  name: "product-index",
  party: "https://mortgage-index.example/#org",
  actor: "https://mortgage-index.example/agents/search#agent",
  operator: "https://mortgage-index.example/#org",
};
export const HARBOUR_AGENT = {
  name: "harbourbank",
  party: HARBOUR,
  actor: "https://harbourbank.example/agents/statements#agent",
  operator: HARBOUR,
};
export const IDP = "https://id-provider.example/#org";

export const PRODUCT_SEARCH_OP = {
  id: `${AWP}op/mortgage-product-search`,
  version: "0.1",
} as const;
export const BALANCE_OP = { id: `${AWP}op/balance-statement`, version: "0.1" } as const;
export const PRODUCT_MODEL = { id: `${AWP}model/mortgage-product-record`, version: "0.1" } as const;
export const BALANCE_MODEL = { id: `${AWP}model/balance-statement`, version: "0.1" } as const;
export const PRODUCT_CLAIM = "mortgage.product";
export const APPROVAL_CLAIM = "identity.approval";
/** The approval level Harbour Bank asks for before it releases a statement to an agent. */
export const FACE_CHECK = `${AWP}assurance/certified-face-check`;

/** The query Sam's agent sends: what kind of product, nothing about Sam. */
export const PRODUCT_QUERY: JsonObject = { propertyUse: "residential", rateType: "fixed" };

/** Sam's loan as a share of the price; used by his core to shortlist (never sent). */
export const SAM_LOAN = { price: 450000, borrowing: 380000 } as const;

/** Sam's mandate for the full journey: the core mandate plus a product search and his bank. */
export function samMainMandate() {
  const base = samMortgageMandate();
  const extra = mandateOf("mortgage-main-extra", [
    permit("use", PRODUCT_SEARCH_OP.id, [PURPOSE.productSearch], [INDEX.party], "#product-search"),
    permit("use", BALANCE_OP.id, [PURPOSE.mortgageApplication], [HARBOUR], "#own-bank-statement"),
  ]);
  return (ids: Ids) => {
    const m = base(ids);
    const more = extra(ids).autonomous.permissions ?? [];
    return {
      ...m,
      autonomous: { ...m.autonomous, permissions: [...(m.autonomous.permissions ?? []), ...more] },
    };
  };
}

/** Harbour Bank's mandate for its statements agent: release statements to account holders. */
export function harbourMandate() {
  return mandateOf("harbour-statements", [
    permit("distribute", BALANCE_OP.id, [PURPOSE.mortgageApplication], undefined, "#statements"),
  ]);
}

/** The index's mandate: it answers public product searches and does nothing else. */
export function indexMandate() {
  return mandateOf("product-index", [
    permit("distribute", PRODUCT_SEARCH_OP.id, [PURPOSE.productSearch], undefined, "#answers"),
  ]);
}

/** A lender's published product record (signed by the lender, not by the index). */
export function productRecord(input: {
  lender: Iri;
  slug: string;
  name: string;
  ratePercent: number;
  fixedYears: number;
  maxLoanToValuePercent: number;
}): JsonObject {
  return {
    type: "MortgageProduct",
    id: `urn:awp:product:${input.slug}`,
    issuer: input.lender,
    claimType: PRODUCT_CLAIM,
    terms: {
      policy: {
        id: `urn:awp:product-terms:${input.slug}`,
        permissions: ["use", "distribute"].map((action) => ({
          type: "permission",
          action,
          target: `urn:awp:product:${input.slug}`,
          constraints: [
            { leftOperand: "purpose", operator: "eq", rightOperand: PURPOSE.productSearch },
          ],
        })),
      },
    },
    method: "published-by-lender",
    issuedAt: "2026-11-01T09:00:00Z",
    product: {
      name: input.name,
      propertyUse: "residential",
      rateType: "fixed",
      ratePercent: input.ratePercent,
      fixedYears: input.fixedYears,
      maxLoanToValuePercent: input.maxLoanToValuePercent,
    },
    synthetic: true,
  };
}

/** The identity provider's attestation that Sam approved one exact action with a face check. */
export function faceCheckAttestation(input: {
  at: string;
  actionDigest: string;
  operation: Iri;
  challenge?: JsonObject;
}): JsonObject {
  const id = `urn:awp:attestation:face-check:${input.actionDigest.slice(0, 16)}`;
  return {
    type: "ApprovalAttestation",
    id,
    terms: {
      policy: {
        id: `${id}:terms`,
        permissions: ["use", "distribute"].map((action) => ({
          type: "permission",
          action,
          target: id,
          constraints: [
            { leftOperand: "purpose", operator: "eq", rightOperand: PURPOSE.mortgageApplication },
            ...(action === "distribute"
              ? [{ leftOperand: "recipient", operator: "eq", rightOperand: HARBOUR }]
              : []),
          ],
        })),
      },
    },
    issuer: IDP,
    claimType: APPROVAL_CLAIM,
    subject: SAM.party,
    method: "certified-face-check",
    level: FACE_CHECK,
    approves: {
      actor: SAM.actor,
      operation: input.operation,
      actionDigest: input.actionDigest,
      ...(input.challenge ? { challenge: input.challenge } : {}),
    },
    issuedAt: input.at,
    validUntil: new Date(Date.parse(input.at) + 3_600_000).toISOString(),
    synthetic: true,
  };
}

/**
 * The national trust root for the main run: the sector register for lenders, and the
 * identity framework register for identity providers.
 */
export function mainTrustRoot(at: string): TrustRoot {
  const day = at.slice(0, 10);
  const lender = (party: Iri, slug: string, authorizedFor: Iri[], claimTypes: string[]) =>
    ({
      party,
      authorizedFor,
      claimTypes,
      status: "authorized",
      id: `${AWP}fixture/sector-register/${slug}#${day}`,
    }) satisfies RegisterEntry;
  const sector: Register = {
    id: `${AWP}fixture/sector-register`,
    name: "Sector register",
    answersFor: "lenders",
    answerTtlMs: 86_400_000,
    entries: [
      lender(
        NORTH.party,
        "north-bank",
        [PREQUAL_OP.id, VALUATION_OP.id],
        [DECISION_CLAIM, PRODUCT_CLAIM],
      ),
      // OPEN-DESIGN: Harbour Bank is Sam's own bank in the model; here it also lends, so the
      // index has a second lender's record to verify and the shortlist has something to drop.
      lender(HARBOUR, "harbour-bank", [PREQUAL_OP.id], [PRODUCT_CLAIM]),
    ],
  };
  const identity: Register = {
    id: `${AWP}fixture/identity-framework-register`,
    name: "Identity framework register",
    answersFor: "identity providers",
    answerTtlMs: 86_400_000,
    entries: [
      {
        party: IDP,
        authorizedFor: [],
        claimTypes: ["identity.*"],
        status: "authorized",
        id: `${AWP}fixture/identity-framework-register/id-provider#${day}`,
      },
    ],
  };
  return {
    id: `${AWP}fixture/national-trust-root`,
    name: "National trust root",
    delegates: [sector, identity],
  };
}

// ------------------------------------------------------------------ the index

function searchDescription(roles: ("initiator" | "responder")[]): OperationDescription {
  return {
    id: PRODUCT_SEARCH_OP.id,
    version: PRODUCT_SEARCH_OP.version,
    label: "Search lenders' published mortgage products (synthetic)",
    pattern: "invoke",
    access: "public",
    roles,
    models: [PRODUCT_MODEL],
    purposes: [PURPOSE.productSearch],
    effects: ["none (read-only)"],
    outcomes: ["matching product records, each signed by its lender"],
    limitations: ["synthetic lenders and products"],
  };
}

/** The index: serves the lenders' signed records that match a query, to anyone, unchanged. */
export class ProductIndexHandler implements OperationHandler {
  readonly description = searchDescription(["responder"]);
  readonly requiresRepresentation = false;

  constructor(
    private readonly records: readonly { jws: string; format?: string; record: JsonObject }[],
  ) {}

  onInvoke(ctx: HandlerContext, body: { input: JsonObject }): HandlerReply {
    const q = body.input;
    const hits = this.records.filter((r) => {
      const p = r.record.product as JsonObject;
      return p.propertyUse === q.propertyUse && p.rateType === q.rateType;
    });
    ctx.record({
      type: "public-access-served",
      operation: PRODUCT_SEARCH_OP.id,
      requesterIdentified: Boolean(ctx.message?.from.actor),
      note: "no identity, consent or credential requested",
    });
    return {
      type: "deliver",
      output: {
        query: q,
        aggregatedAt: ctx.now,
        // Provenance: who published each record and when; the records themselves travel as
        // evidence, signed by their lenders, so the asker can check each against its lender.
        products: hits.map((r) => ({
          id: String(r.record.id),
          lender: String(r.record.issuer),
          publishedAt: String(r.record.issuedAt),
          retrievedFrom: String(r.record.issuer),
        })),
      },
      evidence: hits.map((r) => ({
        role: "credential",
        format: r.format ?? "jws-compact",
        value: r.jws,
      })),
    };
  }
}

/** Sam's agent's side of the search: a query with nothing about Sam; results go to the gate. */
export class ProductSearchHandler implements OperationHandler {
  readonly description = searchDescription(["initiator"]);
  readonly requiresRepresentation = false;
  /** The ids of the records the index returned (the gate decides which are admitted). */
  readonly returned: string[] = [];

  intentForInvoke(ctx: HandlerContext, input: JsonObject): ActionIntent {
    return {
      operation: PRODUCT_SEARCH_OP.id,
      action: "use",
      target: PRODUCT_SEARCH_OP.id,
      purpose: PURPOSE.productSearch,
      recipient: ctx.peer.party ?? INDEX.party,
      parameters: { query: input },
      conversation: ctx.conversation.id,
    };
  }

  onDeliver(_ctx: HandlerContext, body: DeliverBody): HandlerReply {
    for (const p of (body.output.products as JsonObject[] | undefined) ?? [])
      this.returned.push(String(p.id));
    return { type: "none" };
  }
}

// ------------------------------------------------------------------ Harbour Bank

function statementDescription(roles: ("initiator" | "responder")[]): OperationDescription {
  return {
    id: BALANCE_OP.id,
    version: BALANCE_OP.version,
    label: "A signed balance statement for the account holder's agent (synthetic)",
    pattern: "invoke",
    access: "represented",
    roles,
    models: [BALANCE_MODEL],
    purposes: [PURPOSE.mortgageApplication],
    effects: ["none (read-only)"],
    outcomes: ["a balance statement signed by the bank, with its terms"],
    limitations: ["synthetic bank and account"],
  };
}

/**
 * Harbour Bank's statements agent. It releases a statement only to an agent acting for the
 * account holder, and only on an approval at the face-check level (CORE-IN-8).
 */
export class BalanceStatementHandler implements OperationHandler {
  get contentProfile() {
    return { vocabulary: {}, identifiers: [this.statement.id] };
  }
  readonly description = statementDescription(["responder"]);
  readonly requiresRepresentation = true;
  readonly requiredApproval = {
    level: FACE_CHECK,
    label: "a certified face check",
    claimType: APPROVAL_CLAIM,
  };

  constructor(
    private readonly statement: { id: string; jws: string; label: string },
    private readonly terms: { id: string; text: string },
    private readonly accountHolder: string = SAM.party,
  ) {}

  onInvoke(ctx: HandlerContext): HandlerReply {
    const holder = ctx.representation?.party;
    if (holder !== this.accountHolder)
      return { type: "refuse", reason: "not-authorised", detail: "not the account holder" };
    return {
      type: "deliver",
      output: { statement: this.statement.id, accountHolder: holder },
      intent: {
        operation: BALANCE_OP.id,
        action: "distribute",
        target: BALANCE_OP.id,
        purpose: PURPOSE.mortgageApplication,
        recipient: holder,
        parameters: {
          disclosed: ["account balance", "as-of date"],
          attachedTerms: this.terms.text,
          termsId: this.terms.id,
        },
        conversation: ctx.conversation.id,
      },
      evidence: [{ role: "credential", format: "jws-compact", value: this.statement.jws }],
    };
  }
}

/** Sam's agent's side: ask his own bank for the statement, on his behalf. */
export class BalanceRequestHandler implements OperationHandler {
  readonly description = statementDescription(["initiator"]);
  readonly requiresRepresentation = false;

  intentForInvoke(ctx: HandlerContext): ActionIntent {
    return {
      operation: BALANCE_OP.id,
      action: "use",
      target: BALANCE_OP.id,
      purpose: PURPOSE.mortgageApplication,
      recipient: ctx.peer.party ?? HARBOUR,
      parameters: {},
      conversation: ctx.conversation.id,
    };
  }

  onDeliver(): HandlerReply {
    return { type: "none" };
  }
}
