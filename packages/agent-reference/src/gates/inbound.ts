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
  CHECK_LAYERS,
  defaultName,
  type GateContext,
  NOT_APPLICABLE,
  refsFor,
  resolutionView,
} from "./common.js";

export interface InboundDeps {
  readonly identity: { readonly actor: Iri; readonly party?: Iri };
  readonly trust: TrustStore;
  readonly limits: PilotLimits;
  readonly now: () => string;
  readonly record: (record: { readonly type: string }) => void;
  readonly gate: GateContext;
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
  })
  .passthrough();

const OUTCOME_VERDICT: Record<InboundOutcome, Verdict> = {
  admit: "pass",
  "ask-more": "ask-more",
  refuse: "fail",
};

export class InboundGate {
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
        }),
        ...refsFor(this.deps.gate, ["transport", "data-access", "meaning"]),
        caption: `${/^[aeiou]/.test(peek.kind) ? "An" : "A"} ${peek.kind} message from ${this.name(peek.from?.actor)} reaches the inbound gate.`,
      });
    }
    return new Admission(this, this.deps, peek?.id ?? digestBytes(JSON.stringify(wire ?? null)));
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

  /** Source: who stands behind one relayed claim, and is that source accepted for it? */
  async assessClaim(
    item: EvidenceItem,
    subject: Iri | undefined,
  ): Promise<{
    verdict: Verdict;
    reason?: string;
    claimType?: string;
    source?: Iri;
    resolution?: Resolution;
    assessment?: SourceAuthorityAssessment;
    statement?: JsonObject;
  }> {
    const at = this.deps.now();
    const check = await verifyStatement(item.value, {
      trust: this.deps.trust,
      typ: TYP.statement,
      role: "issuer",
      schema: claimSchema,
      limits: this.deps.limits,
      verifier: this.deps.identity.actor,
      at,
    });
    const s = check.payload;
    if (!s || check.verification.outcome !== "valid")
      return { verdict: "fail", reason: "evidence-invalid" };
    if (check.signer?.subject !== s.issuer)
      return {
        verdict: "fail",
        reason: "evidence-invalid",
        claimType: s.claimType,
        source: s.issuer,
      };
    const input = {
      evaluator: this.deps.identity.actor,
      source: s.issuer,
      claimType: s.claimType,
      ...(subject ? { subject } : {}),
      at,
    };
    const resolution = this.deps.gate.resolver?.resolveSource(input);
    const assessment = this.deps.trust.assessSource(input);
    const verdict: Verdict =
      assessment.outcome === "accepted"
        ? "pass"
        : assessment.outcome === "unresolved"
          ? "indeterminate"
          : "fail";
    return {
      verdict,
      ...(verdict === "fail" ? { reason: "source-not-authoritative" } : {}),
      ...(verdict === "indeterminate" ? { reason: "indeterminate-policy" } : {}),
      claimType: s.claimType,
      source: s.issuer,
      ...(resolution ? { resolution } : {}),
      assessment,
      statement: s as unknown as JsonObject,
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
      ...refsFor(this.deps.gate, CHECK_LAYERS[check]),
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

  /**
   * Admit statements the agent fetched or holds (reading data is an inbound message too):
   * integrity and source per statement, then terms and fitness, then a labelled memory fact.
   */
  async admitStatements(
    items: readonly { readonly jws: string }[],
    opts: { readonly subject?: Iri; readonly task: string },
  ): Promise<{ admitted: JsonObject[]; refused: number }> {
    const name = this.name;
    const admitted: JsonObject[] = [];
    let refused = 0;
    for (const item of items) {
      const r = await this.assessClaim(
        { role: "credential", format: "jws-compact", value: item.jws },
        opts.subject,
      );
      const who = r.source ? name(r.source) : "an unknown signer";
      this.verdictEvent(
        "integrity",
        r.reason === "evidence-invalid" ? "fail" : "pass",
        r.reason === "evidence-invalid"
          ? "The statement's signature does not check out against any pinned key."
          : `The ${r.claimType} statement is intact and signed with ${who}'s pinned key.`,
        r.reason === "evidence-invalid" ? { reason: "evidence-invalid" } : {},
      );
      if (r.reason === "evidence-invalid") {
        refused++;
        this.decisionEvent("refuse", "The statement is refused and kept out of memory.", r.reason);
        continue;
      }
      this.verdictEvent(
        "source",
        r.verdict,
        r.verdict === "pass"
          ? `${who} is an accepted source for ${r.claimType}, for ${opts.task}.`
          : `${who} is not an accepted source for ${r.claimType}.`,
        {
          ...(r.reason ? { reason: r.reason } : {}),
          ...(r.assessment?.rule
            ? {
                rule: {
                  id: r.assessment.rule.id,
                  text: `${who} is accepted for ${r.claimType} claims.`,
                },
              }
            : {}),
          ...(r.resolution ? { resolution: resolutionView(r.resolution) } : {}),
        },
      );
      this.verdictEvent(
        "authority",
        "not-applicable",
        "The statement asks for nothing, so there is no authority to check.",
        { reason: NOT_APPLICABLE.noAction },
      );
      this.verdictEvent(
        "terms",
        "not-applicable",
        "The statement carries no terms of use in this configuration.",
        { reason: NOT_APPLICABLE.notInConfiguration },
      );
      // OPEN-DESIGN: no freshness, completeness or confidence rules at the gate yet.
      this.verdictEvent(
        "fitness",
        "not-applicable",
        "No freshness or confidence rule applies at the gate in this configuration.",
        { reason: NOT_APPLICABLE.notInConfiguration },
      );
      if (r.verdict !== "pass") {
        refused++;
        this.decisionEvent("refuse", "The statement is refused and kept out of memory.", r.reason);
        continue;
      }
      this.decisionEvent("admit", `The ${r.claimType} statement from ${who} is admitted.`);
      const s = r.statement as JsonObject;
      this.emit({
        part: "memory",
        kind: "store",
        fact: {
          id: String(s.id ?? digestOf(s)),
          claimType: String(r.claimType),
          subject: String(s.subject ?? opts.subject ?? "unknown"),
          value: s.balance ?? s.monthly ?? null,
          source: String(r.source),
          sourceKind: "authority",
          confidence: 1,
          terms: "none attached (baseline)",
          provenance: `signed by ${who}; issued ${String(s.issuedAt ?? "unknown")}`,
          ...(typeof s.asOf === "string" ? { asOf: s.asOf } : {}),
        },
        caption: `The statement is stored with its source, its origin and how sure the source is.`,
      });
      admitted.push(s);
    }
    return { admitted, refused };
  }
}

/** One message's passage through the inbound gate. */
export class Admission {
  private outcome: InboundOutcome | undefined;
  private readonly done = new Set<InboundCheck>();
  private readonly sources = new Map<string, Verdict>();

  constructor(
    private readonly gate: InboundGate,
    private readonly deps: InboundDeps,
    readonly subject: string,
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
          text: `The configuration requires a JWS from a pinned key, this agent as audience, a valid time window and a one-time message id (${m.id}).`,
        },
      },
    );
  }

  /** Source: one event per relayed claim; claims the gate did not accept are labelled. */
  async source(msg: AnyMessage): Promise<void> {
    if (this.done.has("source")) return;
    this.done.add("source");
    const claims = (msg.evidence ?? []).filter(
      (e) => e.role === "credential" && e.format === "jws-compact",
    );
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
      const r = await this.gate.assessClaim(item, msg.from.onBehalfOf);
      if (r.source && r.claimType)
        this.sources.set(`${r.source}|${r.claimType}|${msg.from.onBehalfOf ?? ""}`, r.verdict);
      const who = r.source ? this.name(r.source) : "an unknown signer";
      this.gate.verdictEvent(
        "source",
        r.verdict,
        r.reason === "evidence-invalid"
          ? "A relayed statement does not verify against its issuer's pinned key; it is not admitted."
          : r.verdict === "pass"
            ? `${who} is an accepted source for ${r.claimType}.`
            : `${who} is not accepted as a source for ${r.claimType}; that claim is not admitted.`,
        {
          ...(r.reason ? { reason: r.reason } : {}),
          ...(r.assessment?.rule
            ? {
                rule: {
                  id: r.assessment.rule.id,
                  text: `${who} is accepted for ${r.claimType} claims.`,
                },
              }
            : {}),
          ...(r.resolution ? { resolution: resolutionView(r.resolution) } : {}),
        },
      );
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
        ...(verdict === "fail" ? { reason: "source-not-authoritative" } : {}),
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
        "This operation does not ask the sender to show who it acts for.",
        { reason: NOT_APPLICABLE.notInConfiguration },
      );
      return rep;
    }
    const ok = rep.outcome === "accepted";
    this.gate.verdictEvent(
      "authority",
      ok ? "pass" : "fail",
      ok
        ? `${this.name(rep.party)} signed a statement that ${this.name(rep.actor)} acts for it in this operation.`
        : `The sender has not shown that it acts for ${this.name(rep.party)} here (${rep.reason}).`,
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
      const opening = msg.kind === "describe" || msg.kind === "description";
      this.gate.verdictEvent(
        "authority",
        "not-applicable",
        opening
          ? "Describing capabilities asks for nothing, so there is no authority to check."
          : "Authority was checked when this conversation was opened; the sender is bound to it.",
        { reason: opening ? NOT_APPLICABLE.noAction : NOT_APPLICABLE.conversationBound },
      );
    }
    const terms = this.terms(conv, msg);
    if (terms.verdict === "fail") {
      this.refuse(terms.reason, "no agreement covers this exchange");
      return { ok: false, reason: terms.reason, detail: "no agreement covers this exchange" };
    }
    // OPEN-DESIGN: the gate has no fitness rules yet (freshness, completeness, confidence,
    // conflict ranking); the lender's core checks the 12-month income series itself.
    this.done.add("fitness");
    this.gate.verdictEvent(
      "fitness",
      "not-applicable",
      "No freshness, completeness or confidence rule applies at the gate in this configuration.",
      { reason: NOT_APPLICABLE.notInConfiguration },
    );
    const notAdmitted = [...this.sources.values()].filter((v) => v !== "pass").length;
    this.outcome = "admit";
    this.gate.decisionEvent(
      "admit",
      notAdmitted > 0
        ? `The message is admitted; ${notAdmitted} statement(s) the gate did not accept are labelled as such.`
        : "The message is admitted and passed to the core.",
    );
    return { ok: true };
  }

  private terms(
    conv: ConversationState,
    msg: AnyMessage,
  ): { verdict: "pass" | "not-applicable" } | { verdict: "fail"; reason: ReasonCode } {
    this.done.add("terms");
    const body = msg.body as unknown as JsonObject;
    const basis = body.basis as JsonObject | undefined;
    if (msg.kind === "deliver" || msg.kind === "invoke" || msg.kind === "receipt") {
      if (basis?.kind === "public") {
        this.gate.verdictEvent("terms", "not-applicable", "A public request: no terms apply.", {
          reason: NOT_APPLICABLE.noPersonalData,
        });
        return { verdict: "not-applicable" };
      }
      const agreement = basis?.kind === "agreement" ? String(basis.agreement) : conv.agreement;
      if (agreement && agreement === conv.agreement) {
        this.gate.verdictEvent(
          "terms",
          "pass",
          "This comes under the agreement both sides signed; its terms bind what is sent.",
          {
            rule: {
              id: agreement,
              text: "Signed offer and acceptance of the exact terms (by digest).",
            },
          },
        );
        return { verdict: "pass" };
      }
      if (basis?.kind !== "agreement") {
        // OPEN-DESIGN: grant-, invocation- and representation-based exchanges are decided by
        // the pilot's domain handlers; the gate does not evaluate their terms yet.
        this.gate.verdictEvent(
          "terms",
          "not-applicable",
          "No agreement governs this exchange; any grant it relies on is checked by the core.",
          { reason: NOT_APPLICABLE.notYetAgreed },
        );
        return { verdict: "not-applicable" };
      }
      this.gate.verdictEvent("terms", "fail", "No agreement covers this exchange.", {
        reason: "no-agreement",
      });
      return { verdict: "fail", reason: "no-agreement" };
    }
    this.gate.verdictEvent(
      "terms",
      "not-applicable",
      msg.kind === "propose"
        ? "Terms are being negotiated; none are in force yet."
        : "Nothing is exchanged under terms by this message.",
      { reason: NOT_APPLICABLE.notYetAgreed },
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
