// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * The inbound gate. Every message is checked before the core sees it: integrity, source,
 * authority, terms, fitness, in that order. Each check returns its own verdict record and
 * emits its own trace event; the gate then admits, asks for more, or refuses.
 *
 * The runtime calls the gate at the points where the pilot already made these decisions,
 * so its behavior is unchanged: the integrity and authority code below is the pilot's own,
 * moved here; the source pre-check is new and observational (the pilot's domain handlers
 * still decide what to do with a claim the gate did not accept).
 */
import { z } from "zod";
import { digestBytes, digestOf } from "../core/canonical.js";
import type { ConversationState } from "../core/conversation.js";
import { BoundsError, type PilotLimits, parseBoundedJson } from "../core/limits.js";
import { validateMessage } from "../core/schema.js";
import type {
  AnyMessage,
  EvidenceItem,
  Iri,
  JsonObject,
  ReasonCode,
  RepresentationAssessment,
  SourceAuthorityAssessment,
  VerificationResult,
} from "../core/types.js";
import { type KeyAlg, verifyCompact } from "../mechanisms/jws.js";
import {
  MECHANISM_ID,
  representationSchema,
  TYP,
  verifyStatement,
} from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { configurationById } from "../profile/configurations.js";
import type { OperationHandler } from "../runtime/operations.js";
import { packetView } from "../trace/packet.js";
import type { InboundCheck, InboundOutcome, TraceEventInput, Verdict } from "../trace/types.js";
import type { Resolution } from "../trust/resolver.js";
import {
  type AdmittedFact,
  checkRefs,
  defaultName,
  type GateContext,
  type GateMemory,
  type ItemTerms,
  NOT_APPLICABLE,
  PASS_CODE,
  refsFor,
  resolutionView,
} from "./common.js";
import { evaluateItemTerms, fitnessOf, termsSummary } from "./quality.js";

export interface InboundDeps {
  readonly identity: { readonly actor: Iri; readonly party?: Iri };
  readonly trust: TrustStore;
  readonly limits: PilotLimits;
  readonly now: () => string;
  readonly record: (record: { readonly type: string }) => void;
  readonly gate: GateContext;
  /** Labels of admitted facts, shared with this agent's outbound gate. */
  readonly memory: GateMemory;
  /** The agreed terms in force in a conversation, if an agreement was made. */
  readonly agreementTerms: (conversation: Iri) => JsonObject | undefined;
  /** The purpose this agent named on a request it sent (for data delivered in answer). */
  readonly requestPurpose?: (requestId: Iri) => Iri | undefined;
}

export type IntegrityResult =
  | {
      readonly ok: true;
      readonly message: AnyMessage;
      readonly verification: VerificationResult;
      readonly signedBy?: { readonly subject: Iri; readonly alg: KeyAlg; readonly kid: string };
    }
  | {
      readonly ok: false;
      readonly reason: ReasonCode;
      readonly detail: string;
      readonly extra?: JsonObject;
      /** Set once the payload parsed, so the runtime can bind the rejection to its id. */
      readonly message?: AnyMessage;
      readonly kid?: string;
    };

/** The minimum a relayed claim must say for the gate to ask who stands behind it. */
const claimSchema = z
  .object({
    id: z.string().max(512).optional(),
    issuer: z.string().max(512),
    claimType: z.string().max(256),
    subject: z.string().max(512).optional(),
    method: z.string().max(64).optional(),
    asOf: z.string().max(64).optional(),
    issuedAt: z.string().max(64).optional(),
    period: z.object({ start: z.string().max(16), end: z.string().max(16) }).optional(),
    terms: z.unknown().optional(),
    validUntil: z.string().max(64).optional(),
  })
  .passthrough();
type Claim = z.infer<typeof claimSchema>;

const OUTCOME_VERDICT: Record<InboundOutcome, Verdict> = {
  admit: "pass",
  "ask-more": "ask-more",
  refuse: "fail",
};

export class InboundGate {
  /** Authority settled per conversation (the representation statement accepted). */
  private readonly authorityByConversation = new Map<string, { id: string; party: string }>();

  constructor(private readonly deps: InboundDeps) {}

  private get name() {
    return this.deps.gate.name ?? defaultName;
  }

  /** Emit to the trace sink, if any. */
  emit(event: TraceEventInput): void {
    this.deps.gate.sink?.emit(event);
  }

  /** A wire unit arrived over the carriage. Opens its admission. */
  arrive(wire: unknown, binding: string | undefined, peek: AnyMessage | undefined): Admission {
    if (this.deps.gate.sink && peek && typeof peek === "object" && peek.kind) {
      const transport = this.deps.gate.configuration?.layers.transport ?? "unknown";
      this.emit({
        part: "transport",
        kind: "message-in",
        packet: packetView(peek, wire as never, {
          carriageSuite: transport,
          carriageSummary: `Arrived over ${binding ?? "an unnamed binding"}.`,
          name: this.name,
          vocabulary: this.deps.gate.vocabulary,
        }),
        ...refsFor(this.deps.gate, ["transport", "data-access", "meaning"]),
        caption: `${/^[aeiou]/.test(peek.kind) ? "An" : "A"} ${peek.kind} message from ${this.name(peek.from?.actor)} reaches the inbound gate.`,
      });
    }
    return new Admission(
      this,
      this.deps,
      peek?.id ?? digestBytes(JSON.stringify(wire ?? null)),
      this.authorityByConversation,
    );
  }

  /**
   * Integrity: bounds, signature and pinned-key attribution, schema, sender/key binding,
   * configuration/algorithm binding, audience, time window and evidence bounds (the pilot's
   * inbound pipeline, moved unchanged). Records the verification result.
   */
  async verifyIntegrity(
    wire: unknown,
    meta: { binding?: string },
    answersOurs: (id: Iri) => boolean,
  ): Promise<IntegrityResult> {
    const { identity, limits } = this.deps;
    const at = this.deps.now();
    if (!wire || typeof wire !== "object")
      return { ok: false, reason: "malformed", detail: "wire message is not an object" };
    const w = wire as Record<string, unknown>;
    let payload: unknown;
    let verification: VerificationResult;
    let signedBy: { subject: Iri; alg: KeyAlg; kid: string } | undefined;
    const rawDigest = digestBytes(JSON.stringify(w).slice(0, limits.maxEnvelopeBytes * 2));

    if (w.format === "awp-jws-compact/0.1" && typeof w.jws === "string") {
      const v = await verifyCompact(w.jws, {
        resolve: this.deps.trust.resolver("actor"),
        typ: TYP.message,
        allowedAlgs: ["EdDSA", "ES256"],
        limits,
      });
      verification = {
        type: "verification",
        protectedObject: v.digest,
        property: "integrity-and-key-attribution",
        mechanism: `${MECHANISM_ID} typ=${TYP.message}`,
        verifier: identity.actor,
        at,
        ...(v.kid ? { verificationMaterial: v.kid } : {}),
        ...(v.outcome === "valid" ? { attributedTo: v.pinned.subject } : {}),
        outcome: v.outcome,
        limitations:
          v.outcome === "valid"
            ? ["integrity + attribution to a pinned actor key only; not authority or truth"]
            : [v.detail],
      };
      this.deps.record(verification);
      if (v.outcome !== "valid") {
        return {
          ok: false,
          reason: v.reason === "bounds-exceeded" ? "bounds-exceeded" : v.reason,
          detail: v.detail,
          extra: { binding: meta.binding ?? "unknown", digest: v.digest },
        };
      }
      payload = v.payload;
      signedBy = { subject: v.pinned.subject, alg: v.alg, kid: v.kid };
    } else if (w.format === "awp-unsigned-json/0.1" && typeof w.payload === "string") {
      try {
        payload = parseBoundedJson(w.payload, limits);
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof BoundsError && error.code !== "not-json"
              ? "bounds-exceeded"
              : "malformed",
          detail: "unsigned payload rejected",
        };
      }
      verification = {
        type: "verification",
        protectedObject: digestBytes(w.payload),
        property: "none-unsigned",
        mechanism: "none",
        verifier: identity.actor,
        at,
        outcome: "not-applicable",
        limitations: [
          "unsigned: no integrity or attribution; acceptable only for anonymous public requests",
        ],
      };
      this.deps.record(verification);
    } else {
      return {
        ok: false,
        reason: "malformed",
        detail: "unknown wire format",
        extra: { digest: rawDigest },
      };
    }

    const checked = validateMessage(payload);
    if (!checked.ok) return { ok: false, reason: checked.reason, detail: checked.detail };
    const msg = checked.message;
    const bound = { message: msg, ...(signedBy ? { kid: signedBy.kid } : {}) };
    const fail = (reason: ReasonCode, detail: string) =>
      ({ ok: false, reason, detail, ...bound }) as const;

    // Sender ↔ key binding and configuration ↔ mechanism binding.
    const config = configurationById(msg.configuration);
    if (signedBy) {
      if (msg.from.actor !== signedBy.subject) {
        return fail(
          "sender-key-mismatch",
          "message names a different actor than the pinned key's subject",
        );
      }
      if (
        config &&
        config.integrity.status === "selected" &&
        config.integrity.alg !== signedBy.alg
      ) {
        return fail(
          "configuration-mismatch",
          `configuration requires ${config.integrity.alg}, message used ${signedBy.alg}`,
        );
      }
    } else {
      if (!config?.unsignedRequestKinds.includes(msg.kind)) {
        return fail(
          "unsigned-not-allowed",
          `unsigned ${msg.kind} not permitted by ${msg.configuration}`,
        );
      }
      if (msg.from.actor || msg.from.onBehalfOf || (msg.evidence ?? []).length > 0) {
        return fail(
          "unsigned-not-allowed",
          "an unsigned message cannot claim an identity or carry evidence",
        );
      }
    }

    // Audience.
    if (msg.to) {
      if (msg.to.actor !== identity.actor)
        return fail("wrong-audience", `addressed to ${msg.to.actor}`);
    } else {
      const answers = msg.inReplyTo ? answersOurs(msg.inReplyTo) : false;
      const publicConfig = config?.requesterAuthentication === "not-applicable";
      if (!(publicConfig && (answers || !signedBy))) {
        return fail("wrong-audience", "message has no audience");
      }
    }

    // Time window.
    const now = Date.parse(at);
    const created = Date.parse(msg.createdAt);
    const expires = Date.parse(msg.expiresAt);
    if (created > now + limits.maxClockSkewMs)
      return fail("not-yet-valid", "createdAt is in the future");
    if (expires <= now - limits.maxClockSkewMs) return fail("expired", "message expired");
    if (expires - created > limits.maxMessageLifetimeMs || expires <= created) {
      return fail("lifetime-too-long", "message lifetime out of bounds");
    }
    if ((msg.evidence ?? []).length > limits.maxEvidenceItems) {
      return fail("bounds-exceeded", "too many evidence items");
    }
    return { ok: true, message: msg, verification, ...(signedBy ? { signedBy } : {}) };
  }

  /**
   * Assess one representation statement: verified against the PINNED party key, and it
   * must name this actor (and key), this party, this operation, and be currently valid.
   * Records and returns the assessment. Establishes representation only — no permission.
   */
  async assessRepresentation(
    jws: string,
    expect: { actor: Iri; party?: Iri; operation: Iri; actorKid?: string },
  ): Promise<RepresentationAssessment> {
    const at = this.deps.now();
    const base = {
      type: "representation-assessment" as const,
      evaluator: this.deps.identity.actor,
      actor: expect.actor,
      party: expect.party ?? "unknown",
      operation: expect.operation,
      at,
    };
    const done = (a: RepresentationAssessment) => {
      this.deps.record(a);
      return a;
    };
    const check = await verifyStatement(jws, {
      trust: this.deps.trust,
      typ: TYP.representation,
      role: "party",
      schema: representationSchema,
      limits: this.deps.limits,
      verifier: this.deps.identity.actor,
      at,
    });
    this.deps.record(check.verification);
    const s = check.payload;
    if (!s || check.verification.outcome !== "valid")
      return done({ ...base, outcome: "not-accepted", reason: "representation-invalid" });
    const wrongParty = expect.party !== undefined && s.party !== expect.party;
    if (check.signer?.subject !== s.party || wrongParty || s.actor !== expect.actor) {
      return done({
        ...base,
        party: s.party,
        statement: s.id,
        outcome: "not-accepted",
        reason: "representation-invalid",
      });
    }
    if (expect.actorKid && s.actorKid !== expect.actorKid) {
      return done({
        ...base,
        party: s.party,
        statement: s.id,
        outcome: "not-accepted",
        reason: "representation-invalid",
      });
    }
    const now = Date.parse(at);
    if (now < Date.parse(s.validFrom) || now >= Date.parse(s.validUntil)) {
      return done({
        ...base,
        party: s.party,
        statement: s.id,
        outcome: "not-accepted",
        reason: "representation-expired",
      });
    }
    if (!s.operations.includes(expect.operation)) {
      return done({
        ...base,
        party: s.party,
        statement: s.id,
        outcome: "not-accepted",
        reason: "representation-out-of-scope",
      });
    }
    return done({ ...base, party: s.party, statement: s.id, outcome: "accepted" });
  }

  /** The pilot's representation check for an operation that requires one (moved unchanged). */
  async checkRepresentation(
    conv: ConversationState,
    msg: AnyMessage,
    handler: OperationHandler,
    kid: string | undefined,
  ): Promise<RepresentationAssessment | undefined> {
    if (!handler.requiresRepresentation) return undefined;
    const at = this.deps.now();
    const base = {
      type: "representation-assessment" as const,
      evaluator: this.deps.identity.actor,
      actor: msg.from.actor ?? "anonymous",
      party: msg.from.onBehalfOf ?? "unknown",
      operation: handler.description.id,
      at,
    };
    const done = (a: RepresentationAssessment) => {
      this.deps.record(a);
      return a;
    };
    if (!msg.from.actor || !msg.from.onBehalfOf)
      return done({ ...base, outcome: "not-accepted", reason: "representation-missing" });
    const items = (msg.evidence ?? []).filter(
      (e) => e.role === "representation" && e.format === "jws-compact",
    );
    if (items.length === 0)
      return done({ ...base, outcome: "not-accepted", reason: "representation-missing" });
    if (conv.peer.party && conv.peer.party !== msg.from.onBehalfOf) {
      return done({ ...base, outcome: "not-accepted", reason: "representation-invalid" });
    }
    let last: RepresentationAssessment | undefined;
    for (const item of items) {
      last = await this.assessRepresentation(item.value, {
        actor: msg.from.actor,
        party: msg.from.onBehalfOf,
        operation: handler.description.id,
        ...(kid ? { actorKid: kid } : {}),
      });
      if (last.outcome === "accepted") return last;
    }
    return last ?? done({ ...base, outcome: "not-accepted", reason: "representation-invalid" });
  }

  /** Plain name for a claim. */
  labelOf(c: Claim): string {
    return (
      this.deps.gate.claimLabel?.(c as unknown as Record<string, unknown>) ??
      `${this.name(c.issuer)}'s ${c.claimType} statement`
    );
  }

  /** Source: who stands behind one relayed claim, and is that source accepted for it? */
  async assessClaim(
    item: EvidenceItem,
    subject: Iri | undefined,
  ): Promise<{
    verdict: Verdict;
    reason?: string;
    claim?: Claim;
    resolution?: Resolution;
    rule?: { id: string; text: string };
  }> {
    const at = this.deps.now();
    const verify = (role: "issuer" | "party") =>
      verifyStatement(item.value, {
        trust: this.deps.trust,
        typ: TYP.statement,
        role,
        schema: claimSchema,
        limits: this.deps.limits,
        verifier: this.deps.identity.actor,
        at,
      });
    let check = await verify("issuer");
    // A party pinned at its introduction (an organization's own key) may also make statements.
    if (check.verification.outcome === "unknown-key") check = await verify("party");
    const s = check.payload;
    if (!s || check.verification.outcome !== "valid")
      return {
        verdict: "fail",
        reason: check.verification.outcome === "unknown-key" ? "unknown-key" : "evidence-invalid",
      };
    if (check.signer?.subject !== s.issuer)
      return { verdict: "fail", reason: "evidence-invalid", claim: s };
    // The claim's own subject, when it names one: a bank's statement relayed by the bank's
    // agent is still about the account holder.
    const permittedSources = this.deps.gate.claimSources?.[s.claimType];
    if (permittedSources && !permittedSources.includes(s.issuer))
      return {
        verdict: "fail",
        reason: "source-not-authoritative",
        claim: s,
      };
    const about = s.subject ?? subject;
    const input = {
      evaluator: this.deps.identity.actor,
      source: s.issuer,
      claimType: s.claimType,
      ...(about ? { subject: about } : {}),
      at,
    };
    const resolution = this.deps.gate.resolver?.resolveSource(input);
    const outcome = resolution?.outcome ?? this.deps.trust.assessSource(input).outcome;
    const verdict: Verdict =
      outcome === "accepted" ? "pass" : outcome === "unresolved" ? "indeterminate" : "fail";
    const reason =
      verdict === "pass"
        ? "source-accepted"
        : verdict === "indeterminate"
          ? "lookup-failed"
          : outcome === "no-route"
            ? "source-unknown"
            : "source-not-authoritative";
    return {
      verdict,
      reason,
      claim: s,
      ...(resolution ? { resolution } : {}),
      ...(resolution?.rule
        ? {
            rule: {
              id: resolution.rule.id,
              text: `${this.name(s.issuer)} is accepted for ${s.claimType} claims.`,
            },
          }
        : {}),
    };
  }

  verdictEvent(
    check: InboundCheck,
    verdict: Verdict,
    caption: string,
    extra: Partial<TraceEventInput> = {},
  ): void {
    this.emit({
      part: "inbound-gate",
      kind: "check",
      check,
      verdict,
      ...checkRefs(this.deps.gate, check),
      // Every verdict carries a code; a pass without one of its own takes the check's pass code.
      ...(verdict === "pass" && !extra.reason ? { reason: PASS_CODE[check] } : {}),
      ...extra,
      caption,
    });
  }

  decisionEvent(outcome: InboundOutcome, caption: string, reason?: string): void {
    this.emit({
      part: "inbound-gate",
      kind: "decision",
      verdict: OUTCOME_VERDICT[outcome],
      outcome,
      ...(reason ? { reason } : {}),
      caption,
    });
  }

  /** Source, terms and fitness of one claim: one event each. Returns whether all passed. */
  async claimChecks(
    item: EvidenceItem,
    subject: Iri | undefined,
    need: { purpose?: Iri; retentionDays?: number; task: string },
    phase: "source" | "terms" | "fitness",
    cache: Map<string, Awaited<ReturnType<InboundGate["assessClaim"]>>>,
    termsOk: Map<string, boolean> = new Map(),
  ): Promise<boolean> {
    let r = cache.get(item.value);
    if (!r) {
      r = await this.assessClaim(item, subject);
      cache.set(item.value, r);
    }
    const c = r.claim;
    const label = c ? this.labelOf(c) : "A relayed statement";
    if (phase === "source") {
      this.verdictEvent(
        "source",
        r.verdict,
        r.reason === "evidence-invalid"
          ? `${label} does not verify against its issuer's pinned key.`
          : r.verdict === "pass"
            ? `${label}: ${this.name(c?.issuer)} is an accepted source for this kind of claim.`
            : `${label}: ${this.name(c?.issuer)} is not accepted as a source for this kind of claim.`,
        {
          ...(r.reason ? { reason: r.reason } : {}),
          ...(r.rule ? { rule: r.rule } : {}),
          ...(r.resolution ? { resolution: resolutionView(r.resolution) } : {}),
        },
      );
      return r.verdict === "pass";
    }
    if (!c || r.verdict !== "pass") return false;
    const at = this.deps.now();
    const terms = c.terms as ItemTerms | undefined;
    if (phase === "terms") {
      const t = evaluateItemTerms(terms, {
        agent: this.deps.identity.actor,
        action: "use",
        target: c.id ?? "",
        ...(need.purpose ? { purpose: need.purpose } : {}),
        ...(need.retentionDays !== undefined ? { retentionDays: need.retentionDays } : {}),
        at,
      });
      this.verdictEvent(
        "terms",
        t.verdict,
        `${label}: ${t.text.charAt(0).toLowerCase()}${t.text.slice(1)}`,
        {
          ...(t.reason ? { reason: t.reason } : {}),
          rule: { id: terms?.policy.id ?? "default-terms", text: t.text },
        },
      );
      termsOk.set(item.value, t.verdict === "pass");
      return t.verdict === "pass";
    }
    const f = fitnessOf(c, this.deps.gate.reliance, at);
    this.verdictEvent(
      "fitness",
      f.verdict,
      f.verdict === "pass"
        ? `${label} is fit for ${need.task}: ${c.method ?? "method unstated"}, ${f.ageDays} days old.`
        : f.reason === "stale-data"
          ? `${label} is too old for ${need.task}.`
          : f.reason === "method-not-accepted"
            ? `${label} was not produced in a way ${need.task} accepts.`
            : `No reliance rule covers ${label}.`,
      { ...(f.reason ? { reason: f.reason } : {}), ...(f.rule ? { rule: f.rule } : {}) },
    );
    if (termsOk.get(item.value) !== true || f.verdict !== "pass") return false;
    const fact: AdmittedFact = {
      id: c.id ?? digestOf(c),
      label,
      claimType: c.claimType,
      source: c.issuer,
      subject: c.subject ?? "unknown",
      ...(c.method ? { method: c.method } : {}),
      ...(c.asOf ? { asOf: c.asOf } : {}),
      ...(terms ? { terms } : {}),
    };
    this.deps.memory.facts.set(fact.id, fact);
    return true;
  }

  /** The memory event for an admitted claim, labelled with source, method, age and terms. */
  storeEvent(c: Claim, chat?: string): void {
    const terms = c.terms as ItemTerms | undefined;
    this.emit({
      part: "memory",
      kind: "store",
      fact: {
        id: c.id ?? digestOf(c),
        label: this.labelOf(c),
        claimType: c.claimType,
        subject: c.subject ?? "unknown",
        value:
          (c as JsonObject).balance ??
          (c as JsonObject).monthly ??
          (c as JsonObject).decision ??
          (c as JsonObject).product ??
          (c as JsonObject).level ??
          null,
        source: c.issuer,
        ...(c.method ? { method: c.method } : {}),
        ...(c.asOf ? { asOf: c.asOf } : {}),
        ...(c.period ? { period: c.period } : {}),
        ...(terms ? { terms: { id: terms.policy.id, summary: termsSummary(terms) } } : {}),
        provenance: `signed by ${this.name(c.issuer)}${c.issuedAt ? `, issued ${c.issuedAt}` : ""}`,
      },
      ...(chat ? { chat: { who: "agent" as const, text: chat } } : {}),
      caption: `${this.labelOf(c)} is stored with its source, how it was produced, its date and its terms.`,
    });
  }

  /**
   * Admit statements the agent fetched or holds (reading data is an inbound message too):
   * integrity, source, authority, terms and fitness per statement, then a labelled fact.
   */
  async admitStatements(
    items: readonly { readonly jws: string }[],
    opts: {
      readonly subject?: Iri;
      readonly task: string;
      readonly purpose?: Iri;
      readonly taskId?: Iri;
    },
  ): Promise<{ admitted: number; refused: number }> {
    let admitted = 0;
    let refused = 0;
    for (const item of items) {
      const ev: EvidenceItem = { role: "credential", format: "jws-compact", value: item.jws };
      const cache = new Map<string, Awaited<ReturnType<InboundGate["assessClaim"]>>>();
      const r = await this.assessClaim(ev, opts.subject);
      cache.set(item.jws, r);
      const label = r.claim ? this.labelOf(r.claim) : "A statement";
      if (r.reason === "evidence-invalid" || r.reason === "unknown-key") {
        this.verdictEvent("integrity", "fail", `${label} does not verify against a pinned key.`, {
          reason: r.reason,
        });
        this.decisionEvent("refuse", `${label} is refused and kept out of memory.`, r.reason);
        refused++;
        continue;
      }
      this.verdictEvent(
        "integrity",
        "pass",
        `${label} is intact and signed with ${this.name(r.claim?.issuer)}'s pinned key.`,
      );
      const sourceOk = await this.claimChecks(ev, opts.subject, opts, "source", cache);
      this.verdictEvent(
        "authority",
        "not-applicable",
        `${label} asks for nothing, so there is no authority to check.`,
        { reason: NOT_APPLICABLE.noAction },
      );
      const termsOk = new Map<string, boolean>();
      const ok =
        sourceOk &&
        (await this.claimChecks(ev, opts.subject, opts, "terms", cache, termsOk)) &&
        (await this.claimChecks(ev, opts.subject, opts, "fitness", cache, termsOk));
      if (!ok) {
        refused++;
        this.decisionEvent(
          "refuse",
          `${label} is refused and kept out of memory.`,
          sourceOk ? undefined : r.reason,
        );
        continue;
      }
      this.decisionEvent("admit", `${label} is admitted.`);
      const claim = r.claim as Claim;
      this.storeEvent(claim);
      const fact = this.deps.memory.facts.get(claim.id ?? digestOf(claim));
      if (fact)
        this.deps.memory.enter(this.deps.gate.taskId ?? opts.taskId ?? "*", {
          ...fact,
          kind: "statement",
          digest: digestOf(claim),
        });
      admitted++;
    }
    return { admitted, refused };
  }
}

/** One message's passage through the inbound gate. */
export class Admission {
  private outcome: InboundOutcome | undefined;
  private readonly done = new Set<InboundCheck>();
  private readonly sources = new Map<string, Verdict>();
  private readonly claimCache = new Map<string, Awaited<ReturnType<InboundGate["assessClaim"]>>>();
  private claimsAdmitted = true;
  private admittedClaims: Claim[] = [];
  /** Set when the authority check asks the sender for a stronger approval. */
  askedFor: { approval: Iri; label: string } | undefined;

  constructor(
    private readonly gate: InboundGate,
    private readonly deps: InboundDeps,
    readonly subject: string,
    private readonly authorityByConversation: Map<string, { id: string; party: string }>,
  ) {}

  get decided(): boolean {
    return this.outcome !== undefined;
  }

  private get name() {
    return this.deps.gate.name ?? defaultName;
  }

  /** Integrity failed: one check event, then the refusal. */
  failIntegrity(reason: string, detail: string): void {
    this.done.add("integrity");
    this.gate.verdictEvent("integrity", "fail", `Integrity fails: ${detail}.`, { reason });
  }

  passIntegrity(result: Extract<IntegrityResult, { ok: true }>): void {
    this.done.add("integrity");
    const m = result.message;
    const signer = result.signedBy
      ? `signed with ${this.name(result.signedBy.subject)}'s pinned key (${result.signedBy.alg})`
      : "unsigned, which its configuration allows for this kind";
    this.gate.verdictEvent(
      "integrity",
      "pass",
      `The message is intact, ${signer}, addressed here, inside its time window and not seen before.`,
      {
        rule: {
          id: m.configuration,
          text: "The configuration requires a signature from a pinned key, this agent as audience, a valid time window and a message id not seen before.",
        },
      },
    );
  }

  private claims(msg: AnyMessage): EvidenceItem[] {
    return (msg.evidence ?? []).filter(
      (e) => e.role === "credential" && e.format === "jws-compact",
    );
  }

  private need(conv: ConversationState, msg?: AnyMessage) {
    const t = this.deps.agreementTerms(conv.id);
    const ref = msg?.kind === "deliver" ? msg.body.ref : undefined;
    const asked = ref ? this.deps.requestPurpose?.(ref) : undefined;
    const purpose = typeof t?.purpose === "string" ? t.purpose : asked;
    return {
      ...(purpose ? { purpose } : {}),
      ...(typeof t?.retentionDays === "number" ? { retentionDays: t.retentionDays } : {}),
      task:
        (conv.operation && this.deps.gate.taskLabel?.(conv.operation.id)) ??
        "a mortgage application",
    };
  }

  /** Source: one event per relayed claim. */
  async source(msg: AnyMessage): Promise<void> {
    if (this.done.has("source")) return;
    this.done.add("source");
    const claims = this.claims(msg);
    if (claims.length === 0) {
      this.gate.verdictEvent(
        "source",
        "not-applicable",
        "The message carries no statements from third parties.",
        { reason: NOT_APPLICABLE.noClaims },
      );
      return;
    }
    for (const item of claims) {
      const ok = await this.gate.claimChecks(
        item,
        msg.from.onBehalfOf,
        { task: "" },
        "source",
        this.claimCache,
      );
      const r = this.claimCache.get(item.value);
      if (r?.claim)
        this.sources.set(
          `${r.claim.issuer}|${r.claim.claimType}|${msg.from.onBehalfOf ?? ""}`,
          r.verdict,
        );
      if (!ok) this.claimsAdmitted = false;
    }
  }

  /** A source assessment made by the core after admission (shown, not repeated). */
  sourceAssessed(a: SourceAuthorityAssessment): void {
    const key = `${a.source}|${a.claimType}|${a.subject ?? ""}`;
    if (this.sources.has(key)) return;
    const verdict: Verdict =
      a.outcome === "accepted" ? "pass" : a.outcome === "unresolved" ? "indeterminate" : "fail";
    this.sources.set(key, verdict);
    this.gate.verdictEvent(
      "source",
      verdict,
      `${this.name(a.source)} ${verdict === "pass" ? "is" : "is not"} accepted for ${a.claimType}${
        this.decided ? " (asked by the core after admission)" : ""
      }.`,
      {
        reason:
          verdict === "pass"
            ? "source-accepted"
            : verdict === "fail"
              ? "source-not-authoritative"
              : "lookup-failed",
        ...(a.rule
          ? {
              rule: {
                id: a.rule.id,
                text: `${this.name(a.source)} is accepted for ${a.claimType} claims.`,
              },
            }
          : {}),
      },
    );
  }

  /** Authority: the representation statement (the pilot's check). Runs source first. */
  async authority(
    conv: ConversationState,
    msg: AnyMessage,
    handler: OperationHandler,
    kid: string | undefined,
  ): Promise<RepresentationAssessment | undefined> {
    await this.source(msg);
    const rep = await this.gate.checkRepresentation(conv, msg, handler, kid);
    this.done.add("authority");
    if (!rep) {
      this.gate.verdictEvent(
        "authority",
        "not-applicable",
        "This operation is not made on anyone's behalf.",
        { reason: NOT_APPLICABLE.noPrincipal },
      );
      return rep;
    }
    const ok = rep.outcome === "accepted";
    const need = handler.requiredApproval;
    if (ok && need) {
      // CORE-IN-8: the mandate is verified, but this operation needs a stronger approval,
      // shown by an accepted statement of that level about the principal.
      const shown = [...this.claimCache.values()].find(
        (r) =>
          r.verdict === "pass" &&
          r.claim?.claimType === need.claimType &&
          r.claim.subject === rep.party &&
          (r.claim as JsonObject).level === need.level &&
          (!conv.challenge ||
            (() => {
              const approves = (r.claim as JsonObject).approves as JsonObject | undefined;
              const citation = approves?.challenge as JsonObject | undefined;
              return (
                citation?.id === conv.challenge.id &&
                citation?.nonce === conv.challenge.nonce &&
                approves?.actor === msg.from.actor &&
                approves?.operation === handler.description.id &&
                typeof r.claim.validUntil === "string" &&
                Date.parse(r.claim.validUntil) > Date.parse(this.deps.now())
              );
            })()),
      )?.claim;
      const rule = {
        id: need.level,
        text: `${this.name(this.deps.identity.party ?? this.deps.identity.actor)} gives ${this.deps.gate.taskLabel?.(handler.description.id) ?? "this"} only on ${need.label}, attested by an accepted identity provider.`,
      };
      if (!shown) {
        this.askedFor = { approval: need.level, label: need.label };
        this.gate.verdictEvent(
          "authority",
          "ask-more",
          `${this.name(rep.party)}'s mandate is signed with their own key, but this needs ${need.label}.`,
          { reason: "assurance-insufficient", rule },
        );
        this.outcome = "ask-more";
        this.gate.decisionEvent(
          "ask-more",
          `The request is held; the gate answers with a challenge that asks for ${need.label}.`,
          "assurance-insufficient",
        );
        return rep;
      }
      if (rep.statement)
        this.authorityByConversation.set(conv.id, { id: rep.statement, party: rep.party });
      this.gate.verdictEvent(
        "authority",
        "pass",
        `${this.name(rep.party)} signed a statement that ${this.name(rep.actor)} acts for them, and approved it with ${need.label}, attested by ${this.name(shown.issuer)}.`,
        { rule },
      );
      return rep;
    }
    if (ok && rep.statement)
      this.authorityByConversation.set(conv.id, { id: rep.statement, party: rep.party });
    this.gate.verdictEvent(
      "authority",
      ok ? "pass" : "fail",
      ok
        ? `${this.name(rep.party)} signed a statement that ${this.name(rep.actor)} acts for them in this operation.`
        : `The sender has not shown that it acts for ${this.name(rep.party)} here.`,
      {
        ...(ok ? {} : { reason: rep.reason ?? "representation-invalid" }),
        rule: {
          id: rep.statement ?? rep.operation ?? "representation",
          text: `A representation statement signed with ${this.name(rep.party)}'s pinned key must name this agent, this operation and a current validity period.`,
        },
      },
    );
    return rep;
  }

  /**
   * Run the remaining checks before the core sees the message, then decide. Returns a
   * refusal when a check fails (the runtime answers it the way the pilot does).
   */
  async complete(
    conv: ConversationState,
    msg: AnyMessage,
  ): Promise<{ ok: true } | { ok: false; reason: ReasonCode; detail: string }> {
    if (this.decided) return { ok: true };
    await this.source(msg);
    if (!this.done.has("authority")) {
      this.done.add("authority");
      const earlier = this.authorityByConversation.get(conv.id);
      if (earlier && msg.kind !== "describe" && msg.kind !== "description") {
        this.gate.verdictEvent(
          "authority",
          "pass",
          `Settled when this conversation opened: ${this.name(earlier.party)}'s signed representation statement still covers it.`,
          {
            reason: "established-earlier",
            rule: {
              id: earlier.id,
              text: "The representation accepted earlier in this conversation, still valid.",
            },
          },
        );
      } else if (!msg.from.actor) {
        // CORE-IN-9: a public read is made on no one's behalf.
        this.gate.verdictEvent(
          "authority",
          "not-applicable",
          "This request is made on no one's behalf: a public read, with no identifier for the asker.",
          { reason: NOT_APPLICABLE.noPrincipal },
        );
      } else {
        this.gate.verdictEvent(
          "authority",
          "not-applicable",
          "This message asks for nothing, so there is no authority to check.",
          { reason: NOT_APPLICABLE.noAction },
        );
      }
    }
    const claims = this.claims(msg);
    const need = this.need(conv, msg);
    const terms = this.messageTerms(conv, msg, claims.length > 0);
    if (terms.verdict === "fail") {
      this.refuse(terms.reason, "no agreement covers this exchange");
      return { ok: false, reason: terms.reason, detail: "no agreement covers this exchange" };
    }
    this.done.add("terms");
    this.done.add("fitness");
    if (claims.length === 0) {
      this.gate.verdictEvent(
        "fitness",
        "not-applicable",
        "The message carries no claims whose quality matters.",
        { reason: NOT_APPLICABLE.noClaims },
      );
    } else {
      const admitted: Claim[] = [];
      const termsOk = new Map<string, boolean>();
      const passed = claims.filter((item) => this.claimCache.get(item.value)?.verdict === "pass");
      for (const item of passed)
        await this.gate.claimChecks(
          item,
          msg.from.onBehalfOf,
          need,
          "terms",
          this.claimCache,
          termsOk,
        );
      for (const item of passed) {
        const r = this.claimCache.get(item.value);
        const ok = await this.gate.claimChecks(
          item,
          msg.from.onBehalfOf,
          need,
          "fitness",
          this.claimCache,
          termsOk,
        );
        if (!ok) this.claimsAdmitted = false;
        else if (r?.claim) admitted.push(r.claim);
      }
      this.admittedClaims = admitted;
    }
    this.outcome = "admit";
    this.gate.decisionEvent(
      "admit",
      this.claimsAdmitted
        ? "The message is admitted and passed to the core, labelled with its sources, terms and quality."
        : "The message is admitted; statements that did not pass are labelled as not admitted.",
    );
    for (const c of this.admittedClaims)
      this.gate.storeEvent(
        c,
        this.deps.gate.tellPrincipal?.(c as unknown as Record<string, unknown>),
      );
    return { ok: true };
  }

  /** Terms at message level: the agreement it comes under, if any. */
  private messageTerms(
    conv: ConversationState,
    msg: AnyMessage,
    hasClaims: boolean,
  ): { verdict: "pass" | "not-applicable" } | { verdict: "fail"; reason: ReasonCode } {
    const body = msg.body as unknown as JsonObject;
    const basis = body.basis as JsonObject | undefined;
    if (basis?.kind === "agreement" && basis.agreement !== conv.agreement) {
      this.gate.verdictEvent("terms", "fail", "No agreement covers this exchange.", {
        reason: "no-agreement",
      });
      return { verdict: "fail", reason: "no-agreement" };
    }
    if (hasClaims) return { verdict: "pass" }; // per-claim terms events follow
    if (
      conv.agreement &&
      (msg.kind === "deliver" || msg.kind === "receipt" || msg.kind === "invoke")
    ) {
      this.gate.verdictEvent(
        "terms",
        "pass",
        "This comes under the agreement both sides signed; its terms bind what is sent.",
        {
          rule: {
            id: conv.agreement,
            text: "Signed offer and acceptance of the exact terms (by digest).",
          },
        },
      );
      return { verdict: "pass" };
    }
    // OPEN-DESIGN: negotiation messages carry offered terms, not data under terms.
    this.gate.verdictEvent(
      "terms",
      "not-applicable",
      "The message carries no data that needs terms.",
      {
        reason: NOT_APPLICABLE.noData,
      },
    );
    return { verdict: "not-applicable" };
  }

  /** Refuse (if not yet decided), with the pilot's reason code. */
  refuse(reason: string, detail?: string): void {
    if (this.decided) return;
    this.outcome = "refuse";
    this.gate.decisionEvent(
      "refuse",
      `The message is refused (${reason}${detail ? `: ${detail}` : ""}); the core never sees it.`,
      reason,
    );
  }
}
