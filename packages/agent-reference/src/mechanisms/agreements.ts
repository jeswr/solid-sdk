// AUTHORED-BY Codex GPT-6
/** Durable multi-principal completion. Local holds and confirmation share one atomic snapshot. */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { id, iso } from "../core/schema.js";
import type { Json, ReasonCode } from "../core/types.js";
import type { ItemTerms } from "../gates/common.js";
import { claimSchema } from "../gates/inbound.js";
import { evaluateItemTerms } from "../gates/quality.js";
import type { StateStore } from "../store/state.js";
import type { SigningKey } from "./jws.js";
import { type ServiceContext, ServiceGate } from "./service-gate.js";
import { signStatement, TYP } from "./statements.js";

export const agreementDefinitionSchema = z.strictObject({
  id,
  coordinator: id,
  parties: z.array(id).min(2),
  required: z.array(id).min(1),
  terms: z.strictObject({
    asset: id,
    purpose: id,
    validFrom: iso,
    validUntil: iso,
    clauses: z.record(z.string(), z.json()).optional(),
    useBy: z.array(id).min(1).optional(),
  }),
  conditions: z
    .array(
      z.strictObject({
        kind: z.string(),
        source: id,
        subject: id,
        equals: z.record(z.string(), z.json()).optional(),
      }),
    )
    .default([]),
  reservations: z
    .array(
      z.strictObject({
        id,
        provider: id,
        amount: z.number().nonnegative().multipleOf(0.01),
        currency: z.string().regex(/^[A-Z]{3}$/),
      }),
    )
    .default([]),
  budget: z
    .strictObject({
      amount: z.number().nonnegative().multipleOf(0.01),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .optional(),
});
export type AgreementDefinition = z.infer<typeof agreementDefinitionSchema>;
function validDefinition(d: AgreementDefinition): boolean {
  return (
    d.parties.includes(d.coordinator) &&
    new Set(d.parties).size === d.parties.length &&
    new Set(d.required).size === d.required.length &&
    d.required.every((p) => d.parties.includes(p)) &&
    (!d.terms.useBy || d.terms.useBy.every((p) => d.parties.includes(p))) &&
    new Set(d.reservations.map((r) => r.id)).size === d.reservations.length &&
    d.reservations.every(
      (r) => d.parties.includes(r.provider) && Number.isSafeInteger(Math.round(r.amount * 100)),
    ) &&
    (!d.budget || Number.isSafeInteger(Math.round(d.budget.amount * 100))) &&
    Date.parse(d.terms.validUntil) > Date.parse(d.terms.validFrom)
  );
}
export const agreementRequestSchema = z.strictObject({
  type: z.literal("AgreementRequest"),
  id,
  agreement: id,
  actor: id,
  party: id,
  representation: z.string(),
  at: iso,
  operation: z.enum(["hold", "accept", "complete", "collect", "withdraw", "end", "replace"]),
  termsDigest: z.string(),
  evidence: z.array(z.string()).default([]),
});
export interface AgreementState {
  definitionDigest: string;
  status: "pending" | "complete" | "void" | "ended" | "replaced";
  signatures: Record<string, string>;
  holds: Record<string, "held" | "released" | "confirmed">;
  step?: string;
  reason?: ReasonCode;
}
export interface AgreementCredential {
  definition: AgreementDefinition;
  signatures: string[];
  status: { ref: string; id: string };
}
export const agreementPresentationSchema = z.strictObject({
  type: z.literal("AgreementPresentation"),
  actor: id,
  party: id,
  at: iso,
  representation: z.string(),
  credentialDigest: z.string(),
  audience: id,
  request: z.strictObject({
    asset: id,
    purpose: id,
    at: iso,
    period: z.strictObject({ start: iso, end: iso }).optional(),
  }),
});
const statusSchema = z.strictObject({
  type: z.literal("AgreementStatus"),
  issuer: id,
  agreement: id,
  definitionDigest: z.string(),
  status: z.enum(["pending", "complete", "void", "ended", "replaced"]),
  at: iso,
});
export class LocalAgreementCoordinator {
  readonly gate: ServiceGate;
  readonly definition: AgreementDefinition;
  constructor(
    readonly options: ServiceContext & {
      key: SigningKey;
      store: StateStore;
      definition: AgreementDefinition;
      mandateActive: (actor: string) => boolean;
    },
  ) {
    this.gate = new ServiceGate(options);
    this.definition = agreementDefinitionSchema.parse(structuredClone(options.definition));
    const d = this.definition;
    if (d.coordinator !== options.identity || !validDefinition(d))
      throw new Error("invalid agreement definition");
    const stored = this.state();
    if (stored.definitionDigest !== digestOf(d))
      throw new Error("agreement definition changed across restart");
  }
  state(): AgreementState {
    const s = this.options.store.load().domain[`agreement:${this.definition.id}`];
    return s
      ? (structuredClone(s) as unknown as AgreementState)
      : {
          definitionDigest: digestOf(this.definition),
          status: "pending",
          signatures: {},
          holds: {},
        };
  }
  private save(s: AgreementState) {
    const state = this.options.store.load();
    state.domain[`agreement:${this.definition.id}`] = s as unknown as Json;
    this.options.store.save(state);
    this.gate.record("agreement-transition", { agreement: this.definition.id, ...s });
  }
  private abort(s: AgreementState, step: string, reason: ReasonCode) {
    if (this.state().status !== "pending") return this.gate.fail("no-agreement");
    s.status = "void";
    s.step = step;
    s.reason = reason;
    for (const key of Object.keys(s.holds)) s.holds[key] = "released";
    this.save(s);
    return this.gate.fail(reason, step === "condition" ? "fitness" : "authority");
  }
  async request(jws: string) {
    const admitted = await this.gate.request(
      jws,
      "awp-agreement-request+jws",
      agreementRequestSchema,
      "urn:op:agreement",
    );
    if (!admitted.ok) return admitted;
    const r = admitted.request,
      d = this.definition;
    if (r.agreement !== d.id || !d.parties.includes(r.party))
      return this.gate.fail("not-authorised");
    if (r.termsDigest !== digestOf(d)) return this.gate.fail("terms-digest-mismatch", "terms");
    // The host resolves current authority, independently of the request and core.
    const active = this.options.mandateActive(r.actor);
    const prior = this.state();
    if (!active && prior.status === "pending")
      return this.abort(prior, "mandate", "mandate-withdrawn");
    if (!active) return this.gate.fail("mandate-withdrawn");
    if (r.operation === "collect")
      return prior.status === "complete" ? this.answer(prior) : this.gate.fail("no-agreement");
    if (["end", "replace"].includes(r.operation)) {
      if (prior.status !== "complete") return this.gate.fail("no-agreement");
      prior.status = r.operation === "end" ? "ended" : "replaced";
      this.save(prior);
      return this.answer(prior);
    }
    if (prior.status === "complete" && r.operation === "accept" && !prior.signatures[r.party]) {
      prior.signatures[r.party] = jws;
      this.save(prior);
      return this.answer(prior);
    }
    if (prior.status !== "pending") return this.gate.fail("no-agreement");
    if (Date.parse(d.terms.validUntil) <= Date.parse(this.options.now()))
      return this.abort(prior, "expiry", "expired");
    if (r.operation === "withdraw") return this.abort(prior, "withdrawal", "mandate-withdrawn");
    if (r.operation === "hold") {
      if (r.party !== d.coordinator) return this.gate.fail("not-authorised");
      const total = d.reservations.reduce((n, h) => n + Math.round(h.amount * 100), 0);
      if (!Number.isSafeInteger(total)) return this.abort(prior, "budget", "limit-exceeded");
      if (
        d.budget &&
        (d.reservations.some((h) => h.currency !== d.budget?.currency) ||
          total > Math.round(d.budget.amount * 100))
      )
        return this.abort(prior, "budget", "limit-exceeded");
      for (const h of d.reservations) prior.holds[h.id] = "held";
      prior.step = "holds";
      this.save(prior);
      return this.answer(prior);
    }
    if (r.operation === "accept") {
      if (d.reservations.some((h) => prior.holds[h.id] !== "held"))
        return this.abort(prior, "acceptance-before-holds", "no-agreement");
      prior.signatures[r.party] = jws;
      prior.step = `accepted:${r.party}`;
      this.save(prior);
      return this.answer(prior);
    }
    if (r.party !== d.coordinator) return this.gate.fail("not-authorised");
    const conditionEvidence = [...r.evidence];
    if (d.conditions.some((c) => c.kind === "funds.held" && c.source === d.coordinator))
      conditionEvidence.push(await this.fundsHeldStatement());
    for (const c of d.conditions) {
      let met = false;
      for (const evidence of conditionEvidence) {
        const checked = await this.gate.verify(evidence, TYP.statement, claimSchema, "issuer");
        const claim = checked.payload;
        if (!claim || checked.signer?.subject !== claim.issuer) continue;
        if (claim.issuer !== c.source || claim.subject !== c.subject || claim.claimType !== c.kind)
          continue;
        const source = this.options.trust.assessSource({
          evaluator: this.options.identity,
          source: c.source,
          claimType: c.kind,
          subject: c.subject,
          at: this.options.now(),
        });
        if (
          source.outcome !== "accepted" ||
          claim.method !== "recorded-by-authority" ||
          !claim.asOf ||
          Date.parse(this.options.now()) - Date.parse(String(claim.asOf)) > 60_000 ||
          Date.parse(String(claim.asOf)) > Date.parse(this.options.now()) ||
          (claim.validUntil &&
            Date.parse(String(claim.validUntil)) <= Date.parse(this.options.now()))
        )
          continue;
        if (
          evaluateItemTerms(claim.terms as ItemTerms | undefined, {
            agent: d.coordinator,
            action: "use",
            target: claim.id ?? "",
            purpose: d.terms.purpose,
            at: this.options.now(),
          }).verdict !== "pass"
        )
          continue;
        if (
          c.equals &&
          !Object.entries(c.equals).every(
            ([k, v]) => Object.hasOwn(claim, k) && digestOf(claim[k]) === digestOf(v),
          )
        )
          continue;
        met = true;
      }
      if (!met) return this.abort(this.state(), "condition", "evidence-missing");
    }
    const current = this.state();
    const acceptedActors: string[] = [];
    for (const party of d.required) {
      const proof = current.signatures[party];
      if (!proof) return this.abort(current, "acceptance", "terms-not-acceptable");
      const checked = await this.gate.request(
        proof,
        "awp-agreement-request+jws",
        agreementRequestSchema,
        "urn:op:agreement",
        true,
      );
      if (!checked.ok || !this.options.mandateActive(checked.request.actor))
        return this.abort(this.state(), "mandate", "mandate-withdrawn");
      acceptedActors.push(checked.request.actor);
    }
    // Reload after awaits: a concurrent withdrawal must win. Single-writer save is atomic.
    const final = this.state();
    if (final.status !== "pending") return this.gate.fail("no-agreement");
    if (acceptedActors.some((actor) => !this.options.mandateActive(actor)))
      return this.abort(final, "mandate", "mandate-withdrawn");
    if (d.reservations.some((h) => final.holds[h.id] !== "held"))
      return this.abort(final, "holds", "no-agreement");
    final.status = "complete";
    final.step = "release";
    for (const h of d.reservations) final.holds[h.id] = "confirmed";
    this.save(final);
    return this.answer(final);
  }
  private fundsHeldStatement() {
    const d = this.definition,
      state = this.state();
    const currency = d.reservations[0]?.currency ?? d.budget?.currency ?? "GBP";
    const total = d.reservations.reduce((n, h) => n + Math.round(h.amount * 100), 0);
    const held =
      state.status === "pending" &&
      d.reservations.length > 0 &&
      Number.isSafeInteger(total) &&
      d.reservations.every((h) => h.currency === currency && state.holds[h.id] === "held");
    const id = `urn:funds-held:${digestOf(d.id).slice(8)}`;
    const statement = {
      id,
      issuer: d.coordinator,
      subject: d.terms.asset,
      claimType: "funds.held",
      method: "recorded-by-authority",
      asOf: this.options.now(),
      value: held,
      amount: held ? total / 100 : 0,
      currency,
      plan: d.id,
      terms: {
        policy: {
          id: `${id}:terms`,
          permissions: [
            {
              type: "permission",
              action: "use",
              target: id,
              constraints: [
                { leftOperand: "purpose", operator: "eq", rightOperand: d.terms.purpose },
              ],
            },
          ],
        },
      },
    };
    this.gate.record("escrow-hold-statement", { statement });
    return signStatement(this.options.key, TYP.statement, statement);
  }
  private async answer(s: AgreementState) {
    this.gate.check("authority");
    this.gate.check("terms");
    this.gate.check("fitness");
    this.gate.decision();
    return {
      ok: true as const,
      status: s.status,
      credential:
        s.status === "complete" && this.definition.parties.every((p) => s.signatures[p])
          ? this.credential()
          : null,
      jws: await this.status(),
    };
  }
  credential(): AgreementCredential {
    const s = this.state();
    if (s.status !== "complete") throw new Error("agreement is incomplete");
    return {
      definition: structuredClone(this.definition),
      signatures: this.definition.parties.map((p) => {
        const proof = s.signatures[p];
        if (!proof) throw new Error("credential needs every party signature");
        return proof;
      }),
      status: { ref: this.options.identity, id: this.definition.id },
    };
  }
  status() {
    const s = this.state();
    return signStatement(this.options.key, "awp-agreement-status+jws", {
      type: "AgreementStatus",
      issuer: this.options.identity,
      agreement: this.definition.id,
      definitionDigest: s.definitionDigest,
      status: s.status,
      at: this.options.now(),
    });
  }
}

/** A new receiver checks every proof and resolves status fresh; it need not share conversation state. */
export async function verifyAgreementCredential(
  credential: AgreementCredential,
  options: ServiceContext & {
    presenter: string;
    request: {
      asset: string;
      purpose: string;
      at: string;
      period?: { start: string; end: string };
    };
    presentation: string;
    resolve: (ref: string, id: string) => Promise<string | undefined>;
  },
) {
  const gate = new ServiceGate(options);
  const parsed = agreementDefinitionSchema.safeParse(credential.definition);
  if (!parsed.success) return gate.fail("malformed", "integrity");
  const d = parsed.data,
    now = options.now();
  if (!validDefinition(d)) return gate.fail("malformed", "integrity");
  const presentation = await gate.request(
    options.presentation,
    "awp-agreement-presentation+jws",
    agreementPresentationSchema,
    "urn:op:agreement",
  );
  if (!presentation.ok) return presentation;
  if (
    presentation.request.audience !== options.identity ||
    presentation.request.party !== options.presenter ||
    presentation.request.credentialDigest !== digestOf(credential) ||
    digestOf(presentation.request.request) !== digestOf(options.request)
  )
    return gate.fail("not-authorised");
  if (!d.parties.includes(options.presenter)) return gate.fail("not-authorised");
  if (options.request.asset !== d.terms.asset || options.request.purpose !== d.terms.purpose)
    return gate.fail("terms-not-acceptable", "terms");
  if (d.terms.useBy && !d.terms.useBy.includes(options.presenter))
    return gate.fail("terms-not-acceptable", "terms");
  if (
    Date.parse(options.request.at) < Date.parse(d.terms.validFrom) ||
    Date.parse(options.request.at) >= Date.parse(d.terms.validUntil) ||
    Date.parse(now) >= Date.parse(d.terms.validUntil)
  )
    return gate.fail("expired", "terms");
  const period = options.request.period;
  if (
    period &&
    (Date.parse(period.start) < Date.parse(d.terms.validFrom) ||
      Date.parse(period.end) > Date.parse(d.terms.validUntil) ||
      Date.parse(period.end) <= Date.parse(period.start))
  )
    return gate.fail("expired", "terms");
  const seen = new Set<string>();
  for (const proof of credential.signatures) {
    const p = await gate.request(
      proof,
      "awp-agreement-request+jws",
      agreementRequestSchema,
      "urn:op:agreement",
      true,
    );
    if (!p.ok) return p;
    if (
      p.request.operation !== "accept" ||
      p.request.agreement !== d.id ||
      p.request.termsDigest !== digestOf(d) ||
      !d.parties.includes(p.request.party)
    )
      return gate.fail("terms-digest-mismatch", "terms");
    seen.add(p.request.party);
  }
  if (!d.parties.every((p) => seen.has(p))) return gate.fail("terms-not-acceptable", "terms");
  if (credential.status.ref !== d.coordinator || credential.status.id !== d.id)
    return gate.fail("terms-not-acceptable", "terms");
  let status: string | undefined;
  try {
    status = await options.resolve(credential.status.ref, credential.status.id);
  } catch {}
  if (!status) return gate.fail("lookup-failed");
  const checked = await gate.verify(status, "awp-agreement-status+jws", statusSchema, "issuer");
  const s = checked.payload;
  if (
    !s ||
    checked.signer?.subject !== d.coordinator ||
    s.issuer !== d.coordinator ||
    s.agreement !== d.id ||
    s.definitionDigest !== digestOf(d)
  )
    return gate.fail("bad-signature", "integrity");
  if (Math.abs(Date.parse(now) - Date.parse(s.at)) > 60_000) return gate.fail("lookup-failed");
  if (s.status !== "complete") return gate.fail("terms-not-acceptable", "terms");
  gate.check("terms");
  gate.check("fitness");
  gate.decision();
  return { ok: true as const, definition: d };
}
