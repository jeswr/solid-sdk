// AUTHORED-BY Codex GPT-6
/** A separately keyed local register. State is committed before any signed success leaves. */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { id, iso } from "../core/schema.js";
import type { Json, ReasonCode } from "../core/types.js";
import type { ItemTerms } from "../gates/common.js";
import { claimSchema } from "../gates/inbound.js";
import { evaluateItemTerms } from "../gates/quality.js";
import type { EvidenceLedger } from "../store/ledger.js";
import type { StateStore } from "../store/state.js";
import type { TraceEventInput } from "../trace/types.js";
import { currentStatus } from "./current-status.js";
import type { SigningKey } from "./jws.js";
import type { DocumentResolver } from "./organizations.js";
import { signStatement, TYP, verifyStatement } from "./statements.js";
import type { TrustStore } from "./trust.js";

export const registerRequestSchema = z.strictObject({
  type: z.literal("SingleUseRequest"),
  id,
  actor: id,
  party: id,
  item: id,
  operation: z.enum(["status", "reserve", "redeem", "release"]),
  at: iso,
  purpose: id,
  for: z.string(),
  until: iso.optional(),
  evidence: z.array(z.string()).default([]),
  acceptances: z.array(z.string()).default([]),
});
const acceptanceSchema = z.strictObject({
  type: z.literal("EscrowAcceptance"),
  issuer: id,
  item: id,
  termsDigest: z.string(),
  issuedAt: iso,
  validUntil: iso,
});
export const singleUseStatusSchema = z.strictObject({
  id,
  issuer: id,
  subject: id,
  claimType: z.literal("single-use.status"),
  method: z.literal("recorded-by-authority"),
  asOf: iso,
  status: z.enum(["active", "reserved", "redeemed", "withdrawn"]),
  redeemedBy: id.optional(),
  redeemedAt: iso.optional(),
  for: z.string().optional(),
  reservation: z.strictObject({ actor: id, until: iso }).optional(),
});
export interface SingleUseItem {
  id: string;
  state: "active" | "withdrawn";
  issuer: string;
  redeemers: string[];
  purposes: string[];
  role?: { jws: string; source: string; claimType: string };
  escrow?: {
    parties: string[];
    termsDigest: string;
    conditions: {
      kind: string;
      issuer: string;
      subject: string;
      completeFor?: string;
      equals?: Record<string, Json>;
    }[];
  };
}
interface StoredItem {
  status: "active" | "reserved" | "redeemed" | "withdrawn";
  reservation?: { actor: string; until: string };
  redeemedBy?: string;
  redeemedAt?: string;
  for?: string;
}
export type RegisterResult = { ok: true; jws: string } | { ok: false; reason: ReasonCode };
export interface SingleUseRegister {
  identity: string;
  request(jws: string): Promise<RegisterResult>;
}
export class LocalSingleUseRegister implements SingleUseRegister {
  readonly identity: string;
  constructor(
    private readonly options: {
      identity: string;
      key: SigningKey;
      trust: TrustStore;
      store: StateStore;
      ledger: EvidenceLedger;
      items: SingleUseItem[];
      now: () => string;
      maxAgeSeconds: number;
      resolver: DocumentResolver;
      sink?: (event: TraceEventInput) => void;
    },
  ) {
    this.identity = options.identity;
    this.options = { ...options, items: structuredClone(options.items) };
  }
  private event(
    check: "integrity" | "source" | "authority" | "terms" | "fitness",
    reason?: ReasonCode,
  ) {
    this.options.sink?.({
      part: "inbound-gate",
      kind: "check",
      check,
      verdict: reason ? "fail" : "pass",
      reason:
        reason ??
        (
          {
            integrity: "intact",
            source: "source-accepted",
            authority: "authority-valid",
            terms: "terms-acceptable",
            fitness: "fit-for-use",
          } as const
        )[check],
      caption: `The single-use register checks ${check}${reason ? `: ${reason}` : ""}.`,
    });
  }
  async withdraw(jws: string): Promise<RegisterResult> {
    const at = this.options.now();
    const schema = z.strictObject({
      type: z.literal("SingleUseWithdrawal"),
      id,
      issuer: id,
      item: id,
      at: iso,
    });
    const args = {
      trust: this.options.trust,
      typ: "awp-single-use-withdrawal+jws",
      schema,
      limits: DEFAULT_LIMITS,
      at,
      verifier: this.identity,
    };
    let checked = await verifyStatement(jws, { ...args, role: "issuer" });
    if (checked.verification.outcome === "unknown-key")
      checked = await verifyStatement(jws, { ...args, role: "party" });
    this.options.ledger.append(checked.verification, at);
    const request = checked.payload;
    const item = this.options.items.find((i) => i.id === request?.item);
    if (
      !request ||
      !item ||
      checked.signer?.subject !== request.issuer ||
      request.issuer !== item.issuer
    ) {
      this.event("authority", "not-authorised");
      return { ok: false, reason: "not-authorised" };
    }
    if (Math.abs(Date.parse(at) - Date.parse(request.at)) > this.options.maxAgeSeconds * 1000)
      return { ok: false, reason: "lookup-failed" };
    const state = this.options.store.load();
    const key = `single-use:${item.id}`;
    const stored = structuredClone(
      state.domain[key] ?? { status: item.state },
    ) as unknown as StoredItem;
    if (stored.status === "redeemed") return { ok: false, reason: "status-withdrawn" };
    stored.status = "withdrawn";
    delete stored.reservation;
    state.domain[key] = stored as unknown as Json;
    this.options.store.save(state);
    const status = {
      id: `urn:single-use:withdrawal:${digestOf(request).slice(8)}`,
      issuer: this.identity,
      subject: item.id,
      claimType: "single-use.status",
      method: "recorded-by-authority",
      asOf: at,
      ...stored,
    };
    this.options.ledger.append(
      {
        type: "single-use-withdrawn",
        item: item.id,
        issuer: request.issuer,
        requestDigest: digestOf(request),
      },
      at,
    );
    this.event("authority");
    return { ok: true, jws: await signStatement(this.options.key, TYP.statement, status) };
  }

  async request(jws: string): Promise<RegisterResult> {
    const at = this.options.now();
    const record = (r: { type: string }) => this.options.ledger.append(r, at);
    const fail = (
      reason: ReasonCode,
      check: "integrity" | "source" | "authority" | "terms" | "fitness" = "authority",
    ): RegisterResult => {
      this.event(check, reason);
      record({ type: "single-use-refusal", reason } as { type: string });
      this.options.sink?.({
        part: "inbound-gate",
        kind: "decision",
        outcome: "refuse",
        reason,
        caption: `The register refuses ${reason}.`,
      });
      return { ok: false, reason };
    };
    const verified = await verifyStatement(jws, {
      trust: this.options.trust,
      typ: "awp-single-use-request+jws",
      role: "actor",
      schema: registerRequestSchema,
      limits: DEFAULT_LIMITS,
      at,
      verifier: this.identity,
    });
    record(verified.verification);
    const request = verified.payload;
    if (
      !request ||
      verified.signer?.subject !== request.actor ||
      verified.signer.party !== request.party
    )
      return fail("bad-signature", "integrity");
    this.event("integrity");
    if (Math.abs(Date.parse(at) - Date.parse(request.at)) > this.options.maxAgeSeconds * 1000)
      return fail("stale-data", "fitness");
    this.event("source");
    const item = this.options.items.find((i) => i.id === request.item);
    if (!item) return fail("lookup-failed");
    if (!item.redeemers.includes(request.party)) return fail("not-authorised");
    if (!item.purposes.includes(request.purpose)) return fail("purpose-not-permitted", "terms");
    if (item.role) {
      const checked = await verifyStatement(item.role.jws, {
        trust: this.options.trust,
        typ: TYP.statement,
        role: "issuer",
        schema: claimSchema,
        limits: DEFAULT_LIMITS,
        at,
        verifier: this.identity,
      });
      record(checked.verification);
      const role = checked.payload;
      if (
        !role ||
        checked.signer?.subject !== item.role.source ||
        role.issuer !== item.role.source ||
        role.subject !== item.issuer ||
        role.claimType !== item.role.claimType
      )
        return fail("source-not-authoritative", "source");
      if (role.validUntil && Date.parse(role.validUntil) <= Date.parse(at))
        return fail("status-withdrawn", "source");
      const status = role.status as { ref: string; id: string } | undefined;
      if (!status || typeof status.ref !== "string" || typeof status.id !== "string")
        return fail("lookup-failed", "source");
      const standing = await currentStatus({
        issuer: role.issuer,
        reference: status,
        resolver: this.options.resolver,
        trust: this.options.trust,
        now: at,
        verifier: this.identity,
        maxAgeSeconds: this.options.maxAgeSeconds,
        record,
      });
      if (!standing.ok) return fail(standing.reason, "source");
    }
    if (item.escrow && request.operation === "release") {
      const admitted: string[] = [];
      const admittedClaims: import("../core/types.js").JsonObject[] = [];
      for (const evidence of request.evidence) {
        const checked = await verifyStatement(evidence, {
          trust: this.options.trust,
          typ: TYP.statement,
          role: "issuer",
          schema: claimSchema,
          limits: DEFAULT_LIMITS,
          at,
          verifier: this.identity,
        });
        record(checked.verification);
        const claim = checked.payload;
        const condition = item.escrow.conditions.find(
          (c) =>
            c.kind === claim?.claimType && c.issuer === claim.issuer && c.subject === claim.subject,
        );
        if (!claim || checked.signer?.subject !== claim.issuer || !condition)
          return fail("source-not-authoritative", "source");
        const age = Date.parse(at) - Date.parse(String(claim.asOf));
        if (age < 0 || age > this.options.maxAgeSeconds * 1000)
          return fail("stale-data", "fitness");
        if (
          condition.completeFor &&
          (claim.complete !== true || claim.forClaim !== condition.completeFor)
        )
          return fail("completeness-not-established", "fitness");
        if (claim.method !== "recorded-by-authority") return fail("method-not-accepted", "fitness");
        const terms = evaluateItemTerms(claim.terms as ItemTerms | undefined, {
          agent: this.identity,
          action: "use",
          target: claim.id ?? "",
          purpose: request.purpose,
          at,
        });
        if (terms.verdict !== "pass") return fail("terms-not-acceptable", "terms");
        if (
          condition.equals &&
          !Object.entries(condition.equals).every(
            ([key, value]) => Object.hasOwn(claim, key) && digestOf(claim[key]) === digestOf(value),
          )
        )
          return fail("evidence-invalid", "fitness");
        admitted.push(claim.claimType);
        admittedClaims.push(claim as import("../core/types.js").JsonObject);
      }
      if (!item.escrow.conditions.every((c) => admitted.includes(c.kind)))
        return fail("evidence-missing", "fitness");
      for (const condition of item.escrow.conditions)
        if (condition.completeFor) {
          const complete = admittedClaims.find(
            (c) =>
              c.claimType === condition.kind &&
              c.issuer === condition.issuer &&
              c.subject === condition.subject,
          );
          const search = admittedClaims.find(
            (c) => c.claimType === condition.completeFor && c.subject === condition.subject,
          );
          if (
            !complete ||
            !search ||
            digestOf(complete.period ?? null) !== digestOf(search.period ?? null)
          )
            return fail("completeness-not-established", "fitness");
        }
      const accepted = new Set<string>();
      for (const acceptance of request.acceptances) {
        const checked = await verifyStatement(acceptance, {
          trust: this.options.trust,
          typ: "awp-escrow-acceptance+jws",
          role: "party",
          schema: acceptanceSchema,
          limits: DEFAULT_LIMITS,
          at,
          verifier: this.identity,
        });
        record(checked.verification);
        const payload = checked.payload;
        if (
          !payload ||
          checked.signer?.subject !== payload.issuer ||
          payload.item !== item.id ||
          payload.termsDigest !== item.escrow.termsDigest ||
          Date.parse(payload.issuedAt) > Date.parse(at) ||
          Date.parse(payload.validUntil) <= Date.parse(at)
        )
          return fail("terms-digest-mismatch", "terms");
        accepted.add(payload.issuer);
      }
      if (!item.escrow.parties.every((p) => accepted.has(p)))
        return fail("terms-not-acceptable", "terms");
    } else if (item.escrow && request.operation === "redeem")
      return fail("evidence-missing", "terms");
    this.event("terms");
    this.event("fitness");
    // No await between this read and save. A file store has an exclusive process lock.
    const state = this.options.store.load();
    const key = `single-use:${item.id}`;
    const stored = structuredClone(
      state.domain[key] ?? { status: item.state },
    ) as unknown as StoredItem;
    if (stored.reservation && Date.parse(stored.reservation.until) <= Date.parse(at)) {
      stored.status = "active";
      delete stored.reservation;
    }
    if (request.operation !== "status") {
      if (["redeemed", "withdrawn"].includes(stored.status)) return fail("status-withdrawn");
      if (stored.reservation && stored.reservation.actor !== request.actor)
        return fail("status-withdrawn");
      if (request.operation === "reserve") {
        if (!request.until || Date.parse(request.until) <= Date.parse(at)) return fail("expired");
        stored.status = "reserved";
        stored.reservation = { actor: request.actor, until: request.until };
      } else if (request.operation === "release" && !item.escrow) {
        stored.status = "active";
        delete stored.reservation;
      } else {
        stored.status = "redeemed";
        delete stored.reservation;
        stored.redeemedBy = request.party;
        stored.redeemedAt = at;
        stored.for = request.for;
      }
    }
    state.domain[key] = stored as unknown as Json;
    this.options.store.save(state);
    const status = {
      id: `urn:single-use:answer:${digestOf({ request, stored }).slice(8)}`,
      issuer: this.identity,
      subject: item.id,
      claimType: "single-use.status",
      method: "recorded-by-authority",
      asOf: at,
      ...stored,
    };
    record({ type: "single-use-transition", requestDigest: digestOf(request), ...status } as {
      type: string;
    });
    this.event("authority");
    this.options.sink?.({
      part: "inbound-gate",
      kind: "decision",
      outcome: "admit",
      reason: "authority-valid",
      caption: `The register records ${request.operation} before releasing its signed answer.`,
    });
    return { ok: true, jws: await signStatement(this.options.key, TYP.statement, status) };
  }
}
