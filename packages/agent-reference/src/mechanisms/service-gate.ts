// AUTHORED-BY Codex GPT-6
/** Common admission for separately keyed local capability services. No core chooses verdicts. */
import type { z } from "zod";
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { Json, ReasonCode } from "../core/types.js";
import type { EvidenceLedger } from "../store/ledger.js";
import type { TraceEventInput } from "../trace/types.js";
import { representationSchema, TYP, verifyStatement } from "./statements.js";
import type { TrustStore } from "./trust.js";

export interface ServiceContext {
  identity: string;
  trust: TrustStore;
  ledger: EvidenceLedger;
  now: () => string;
  sink?: (event: TraceEventInput) => void;
}
export class ServiceGate {
  constructor(readonly context: ServiceContext) {}
  check(check: "integrity" | "source" | "authority" | "terms" | "fitness", reason?: ReasonCode) {
    const success = {
      integrity: "intact",
      source: "source-accepted",
      authority: "authority-valid",
      terms: "terms-acceptable",
      fitness: "fit-for-use",
    } as const;
    const event: TraceEventInput = {
      part: "inbound-gate",
      kind: "check",
      check,
      verdict: reason ? "fail" : "pass",
      reason: reason ?? success[check],
      caption: `The service checks ${check}${reason ? `: ${reason}` : "."}`,
    };
    this.context.ledger.append({ type: "service-check", ...event }, this.context.now());
    this.context.sink?.(event);
  }
  decision(reason?: ReasonCode) {
    const event: TraceEventInput = {
      part: "inbound-gate",
      kind: "decision",
      outcome: reason ? "refuse" : "admit",
      reason: reason ?? "authority-valid",
      caption: reason
        ? `The service refuses: ${reason}.`
        : "The service admits the signed request.",
    };
    this.context.ledger.append({ type: "service-decision", ...event }, this.context.now());
    this.context.sink?.(event);
  }
  fail(
    reason: ReasonCode,
    check: "integrity" | "source" | "authority" | "terms" | "fitness" = "authority",
  ) {
    this.check(check, reason);
    this.decision(reason);
    return { ok: false as const, reason };
  }
  async verify<T>(
    jws: string,
    typ: string,
    schema: z.ZodType<T>,
    role: "actor" | "party" | "issuer",
  ) {
    let checked = await verifyStatement(jws, {
      trust: this.context.trust,
      typ,
      schema,
      role,
      limits: DEFAULT_LIMITS,
      at: this.context.now(),
      verifier: this.context.identity,
    });
    if (role === "issuer" && checked.verification.outcome === "unknown-key")
      checked = await verifyStatement(jws, {
        trust: this.context.trust,
        typ,
        schema,
        role: "party",
        limits: DEFAULT_LIMITS,
        at: this.context.now(),
        verifier: this.context.identity,
      });
    this.context.ledger.append(checked.verification, this.context.now());
    return checked;
  }
  async request<T extends { actor: string; party: string; at: string; representation: string }>(
    jws: string,
    typ: string,
    schema: z.ZodType<T>,
    operation: string,
    historical = false,
  ) {
    const checked = await this.verify(jws, typ, schema, "actor");
    const r = checked.payload;
    if (!r || checked.signer?.subject !== r.actor || checked.signer.party !== r.party)
      return this.fail("bad-signature", "integrity");
    this.check("integrity");
    if (historical && Date.parse(r.at) > Date.parse(this.context.now()))
      return this.fail("not-yet-valid", "fitness");
    if (!historical && Math.abs(Date.parse(this.context.now()) - Date.parse(r.at)) > 60_000)
      return this.fail("expired", "fitness");
    const rep = await this.verify(
      r.representation,
      TYP.representation,
      representationSchema,
      "party",
    );
    const p = rep.payload;
    if (
      !p ||
      rep.signer?.subject !== r.party ||
      p.party !== r.party ||
      p.actor !== r.actor ||
      p.actorKid !== checked.signer.kid
    )
      return this.fail("representation-invalid");
    if (
      Date.parse(p.validFrom) > Date.parse(historical ? r.at : this.context.now()) ||
      Date.parse(p.validUntil) <= Date.parse(historical ? r.at : this.context.now())
    )
      return this.fail("representation-expired");
    if (!p.operations.includes(operation)) return this.fail("representation-out-of-scope");
    this.check("source");
    return { ok: true as const, request: r };
  }
  record(type: string, value: Record<string, unknown>) {
    this.context.ledger.append(
      { type, ...value } as { type: string; [key: string]: Json },
      this.context.now(),
    );
  }
}
