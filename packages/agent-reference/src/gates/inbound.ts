// AUTHORED-BY Codex GPT-6
import { readCarried } from "../settlement/carried.js";
// AUTHORED-BY Codex GPT-6

import { digestBytes as credentialDigest } from "../core/canonical.js";
import { mapCodeClaim } from "../mechanisms/code-mapping.js";
import { isClaimEvidence, verifySelectivePresentation } from "../mechanisms/selective.js";
import { copyData } from "../model/copy.js";
import { MessageEnvelopeNode } from "../model/envelope.js";
import {
  bindCredentialResolver,
  type EmbeddedCredentialNode,
  EvidenceItemNode,
} from "../model/evidence-item.js";
import { MessageNode, requireMessageNode } from "../model/message-nodes.js";
import type { PaymentFacts } from "../model/payment.js";
import { StatementQualityNode } from "../model/quality.js";
import { interpretEmployment } from "../suites/meaning-registry.js";
import { certifiedQuality } from "../suites/reliance-certificate.js";
import { confidenceFitness } from "../suites/reliance-confidence.js";
import { corroborateIncome } from "../suites/reliance-corroboration.js";
import { checkIndexReceipt } from "../suites/trust-index.js";
import {
  declaredJwsKid,
  documentConfiguration,
  isMessagePacket,
  nativeDocumentLimits,
  verifyMessagePacket,
} from "../wire/message-packet.js";
import {
  liftPaymentObjects,
  paymentDocumentIn,
  paymentTrace,
  readPaymentObjects,
} from "../wire/payment.js";
import { checkReceipt } from "./payment.js";
// AUTHORED-BY Claude Opus 5.5
/**
 * The inbound gate. Every message is checked before the core sees it: integrity, source,
 * authority, terms, fitness, in that order. Each check returns its own verdict record and
 * emits its own trace event; the gate then admits, asks for more, or refuses.
 *
 * The runtime calls the gate before a handler sees the message. A rejected statement stays
 * outside facts and core context; a required curable claim produces a gate-built request
 * for replacement evidence, while an optional rejected claim is removed from the message.
 */

import { z } from "zod";
import { digestBytes, digestContent, digestOf } from "../core/canonical.js";
import type { ConversationState } from "../core/conversation.js";
import { BoundsError, jointLimits, type PilotLimits, parseBoundedJson } from "../core/limits.js";
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
import { admittedResultPolicy } from "../derive/result-trust.js";
import { verifyDerivation } from "../derive/rules.js";
import {
  opaqueDerivation,
  verifyJointMessageOutcome,
  verifyOpaqueDerivation,
} from "../derive/verification.js";
import { AuthorityChainChecks } from "../mechanisms/authority-chain.js";
import { type KeyAlg, verifyCompact } from "../mechanisms/jws.js";
import { OrganizationChecks } from "../mechanisms/organizations.js";
import {
  MECHANISM_ID,
  representationSchema,
  TYP,
  verifyStatement,
} from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { configurationById } from "../profile/configurations.js";
import { identifiersIn } from "../profile/content.js";
import { dutyRuleSchema } from "../runtime/duties.js";
import type { OperationHandler } from "../runtime/operations.js";
import { packetView } from "../trace/packet.js";
import type { InboundCheck, InboundOutcome, TraceEventInput, Verdict } from "../trace/types.js";
import type { Resolution } from "../trust/resolver.js";
import {
  type AdmittedFact,
  alternativeInstalled,
  CURABLE_CLAIM_FAILURES,
  checkRefs,
  claimRequest,
  defaultName,
  type GateContext,
  type GateMemory,
  type ItemTerms,
  NOT_APPLICABLE,
  PASS_CODE,
  refsFor,
  resolutionView,
} from "./common.js";
import { acceptsOfferedTerms, evaluateItemTerms, fitnessOf, termsSummary } from "./quality.js";

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
  readonly settlement?: import("../settlement/types.js").SettlementSuite;
  readonly receiptOrder?: (
    receipt: PaymentFacts,
  ) => { order: PaymentFacts; provider: string } | undefined;
  readonly recordReceipt?: (receipt: PaymentFacts, document: unknown) => void;
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
      readonly extra?: { readonly digest: string; readonly binding?: string };
      /** Set once the payload parsed, so the runtime can bind the rejection to its id. */
      readonly message?: AnyMessage;
      readonly kid?: string;
    };

/** The minimum a relayed claim must say for the gate to ask who stands behind it. */
export const claimSchema = z
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
  "ask-principal": "ask-principal",
  refuse: "fail",
};

export class InboundGate {
  private activePaymentDocument: unknown;
  private readonly credentialBytes = new Map<string, string>();
  rememberCredentials(message: AnyMessage): void {
    if (message instanceof MessageNode)
      bindCredentialResolver(message.dataset, (digest) => this.credentialBytes.get(digest));
    for (const item of message.evidence ?? []) {
      try {
        const value = item.value;
        const digest = credentialDigest(value);
        if (!this.credentialBytes.has(digest) && this.credentialBytes.size >= 4096)
          this.credentialBytes.delete(this.credentialBytes.keys().next().value!);
        this.credentialBytes.set(digest, value);
      } catch {
        /* Missing prior digests fail at integrity, never fetch. */
      }
    }
  }
  /** A published mapping version cannot change within this agent's lifetime (SM-1). */
  private readonly mappingVersions = new Map<string, string>();
  /** Authority settled per conversation (the representation statement accepted). */
  private corroborationPool: Claim[] = [];
  private claimFailure: { outcome: "refuse" | "ask-more"; reason: string } | undefined;
  private getClaimFailure() {
    return this.claimFailure;
  }
  setCorroborationPool(claims: Claim[]): void {
    this.corroborationPool = claims;
  }
  private readonly authorityByConversation = new Map<string, { id: string; party: string }>();

  constructor(private readonly deps: InboundDeps) {}

  private organizations(): OrganizationChecks | undefined {
    const organizations = this.deps.gate.organizations;
    return organizations
      ? new OrganizationChecks({
          ...organizations,
          trust: this.deps.trust,
          now: this.deps.now,
          verifier: this.deps.identity.actor,
          record: this.deps.record,
        })
      : undefined;
  }

  private get name() {
    return this.deps.gate.name ?? defaultName;
  }

  /** Emit to the trace sink, if any. */
  emit(event: TraceEventInput): void {
    this.deps.gate.sink?.emit({
      ...event,
      ...(this.activePaymentDocument ? { settlementDocument: this.activePaymentDocument } : {}),
    });
  }

  /** A wire unit arrived over the carriage. Opens its admission. */
  arrive(wire: unknown, binding: string | undefined, peek: AnyMessage | undefined): Admission {
    this.activePaymentDocument = peek ? paymentDocumentIn(peek) : undefined;
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

    let graphMessage: AnyMessage | undefined;
    let webId: Awaited<ReturnType<NonNullable<GateContext["webId"]>["resolve"]>>;
    if (isMessagePacket(wire)) {
      let declared: ReturnType<typeof documentConfiguration>;
      try {
        declared = documentConfiguration(wire);
      } catch {
        return { ok: false, reason: "malformed", detail: "invalid-rdf-document" };
      }
      const config = configurationById(declared.configuration);
      const suite =
        config?.integrity.status === "selected" && config.integrity.mechanism === "data-integrity"
          ? "data-integrity"
          : "jws";
      // Brief 26b resolver seam, on the document path: the declared kid is a routing hint
      // only; the fetched WebID key must still verify the exact signed document below.
      const hint = declared.signed && suite === "jws" ? declaredJwsKid(wire) : undefined;
      webId = hint
        ? await this.deps.gate.webId?.resolveDeclared?.(declared.configuration, hint)
        : undefined;
      if (webId && !webId.ok)
        return {
          ok: false,
          reason: webId.reason,
          detail:
            "The resolved identity document does not match the independently signed key commitment.",
          extra: { binding: meta.binding ?? "unknown", digest: rawDigest },
        };
      const fetched = webId?.ok ? webId.key : undefined;
      const resolve = (id: string) => {
        const kid = id.replace(/^urn:awp:key:/, "");
        if (fetched) return kid === fetched.kid ? fetched : undefined;
        return this.deps.trust.resolver("actor")(kid);
      };
      const checked = await verifyMessagePacket(wire, {
        suite,
        resolve,
        unsigned: !declared.signed,
        limits: nativeDocumentLimits(limits),
      });
      if (!checked.ok) return { ok: false, reason: checked.reason, detail: checked.detail };
      const node = requireMessageNode(checked.root, checked.dataset);
      bindCredentialResolver(node.dataset, (digest) => this.credentialBytes.get(digest));
      graphMessage = node.live;
      const pinned = checked.kid ? resolve(checked.kid) : undefined;
      if (declared.signed && !pinned)
        return { ok: false, reason: "unknown-key", detail: "message key is not pinned" };
      if (pinned) signedBy = { subject: pinned.subject, alg: pinned.alg, kid: pinned.kid };
      verification = {
        type: "verification",
        protectedObject: digestBytes(wire.jsonld),
        property: pinned ? "integrity-and-key-attribution" : "none-unsigned",
        mechanism: pinned
          ? `${suite}${fetched ? " with resolved identity document discovery" : ""}`
          : "none",
        verifier: identity.actor,
        at,
        ...(pinned ? { verificationMaterial: pinned.kid, attributedTo: pinned.subject } : {}),
        outcome: pinned ? "valid" : "not-applicable",
        limitations: [
          fetched
            ? "integrity + attribution to resolved identity material bound to a signed thumbprint commitment; not source authority"
            : "integrity and pinned-key attribution only; not source authority",
        ],
      };
      this.deps.record(verification);
    } else if (w.format === "awp-jws-compact/0.1" && typeof w.jws === "string") {
      // Brief 26b resolver seam: selected WebID exchanges verify with fetched profile material.
      webId = await this.deps.gate.webId?.resolve(w.jws);
      if (webId && !webId.ok)
        return {
          ok: false,
          reason: webId.reason,
          detail:
            "The resolved identity document does not match the independently signed key commitment.",
          extra: { binding: meta.binding ?? "unknown", digest: rawDigest },
        };
      const webIdKey = webId?.ok ? webId.key : undefined;
      const v = await verifyCompact(w.jws, {
        resolve: webIdKey
          ? (kid) => (kid === webIdKey.kid ? webIdKey : undefined)
          : this.deps.trust.resolver("actor"),
        typ: TYP.message,
        allowedAlgs: ["EdDSA", "ES256"],
        limits,
      });
      verification = {
        type: "verification",
        protectedObject: v.digest,
        property: "integrity-and-key-attribution",
        mechanism: `${MECHANISM_ID} typ=${TYP.message}${webId?.ok ? " with resolved identity document discovery" : ""}`,
        verifier: identity.actor,
        at,
        ...(v.kid ? { verificationMaterial: v.kid } : {}),
        ...(v.outcome === "valid" ? { attributedTo: v.pinned.subject } : {}),
        outcome: v.outcome,
        limitations:
          v.outcome === "valid"
            ? [
                webId?.ok
                  ? "integrity + attribution to resolved identity material bound to a signed thumbprint commitment; not authority or truth"
                  : "integrity + attribution to a pinned actor key only; not authority or truth",
              ]
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

    const checked = graphMessage
      ? { ok: true as const, message: graphMessage }
      : validateMessage(payload);
    if (!checked.ok) return { ok: false, reason: checked.reason, detail: checked.detail };
    const msg = checked.message;
    const envelope = msg instanceof MessageNode ? msg : MessageEnvelopeNode.fromMessage(msg);
    const sender = envelope.from;
    const kind = envelope.kind;
    if (!sender || !kind) throw new Error("internal: incomplete validated envelope");
    const bound = { message: msg, ...(signedBy ? { kid: signedBy.kid } : {}) };
    const fail = (reason: ReasonCode, detail: string) =>
      ({ ok: false, reason, detail, ...bound }) as const;

    // Sender ↔ key binding and configuration ↔ mechanism binding.
    const config = configurationById(envelope.configuration ?? "");
    if (!alternativeInstalled(this.deps.gate, envelope.configuration ?? ""))
      return fail(
        "unsupported-configuration",
        "The selected identity or authority adapter is not installed.",
      );
    if (
      config?.acceptedDidMethods &&
      [sender.actor, sender.onBehalfOf, sender.operator].some(
        (id) =>
          id &&
          (!id.startsWith("did:") || !config.acceptedDidMethods!.includes(id.split(":")[1] ?? "")),
      )
    )
      return fail(
        "unsupported-configuration",
        "The declared identity method is not listed in this configuration.",
      );
    if (signedBy) {
      if (sender.actor !== signedBy.subject) {
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
      if (!config?.unsignedRequestKinds.includes(kind)) {
        return fail(
          "unsigned-not-allowed",
          `unsigned ${kind} not permitted by ${envelope.configuration}`,
        );
      }
      if (sender.actor || sender.onBehalfOf || (msg.evidence ?? []).length > 0) {
        return fail(
          "unsigned-not-allowed",
          "an unsigned message cannot claim an identity or carry evidence",
        );
      }
    }

    for (const part of msg.content ?? []) {
      if (!signedBy || digestContent(part.bytes) !== part.digest)
        return fail("evidence-invalid", "content digest does not match protected bytes");
    }
    if (new Set((msg.content ?? []).map((p) => p.id)).size !== (msg.content ?? []).length)
      return fail("malformed", "duplicate content part");

    if (signedBy && this.deps.gate.organizations && sender.onBehalfOf) {
      const current = await this.organizations()?.key(
        sender.onBehalfOf,
        signedBy.kid,
        signedBy.subject,
        "actor",
      );
      if (!current?.ok)
        return fail(
          current?.reason ?? "lookup-failed",
          "signing key is absent from the current identifier document",
        );
    }

    if (graphMessage) {
      for (const item of msg.evidence ?? []) {
        if (!(item instanceof EvidenceItemNode))
          return fail("evidence-invalid", "message evidence is not a graph wrapper");
        try {
          void item.value;
        } catch {
          return fail("evidence-invalid", "prior-credential-missing-or-digest-mismatch");
        }
        if (item.credential && !item.credential.projectionMatches(item.format))
          return fail("evidence-invalid", "original-credential-projection-mismatch");
      }
      this.rememberCredentials(msg);
    }
    for (const item of msg.evidence ?? [])
      if (item.format === "selective-disclosure+jws") {
        const verified = await verifySelectivePresentation(
          item,
          this.deps.trust,
          at,
          identity.actor,
        );
        this.deps.record(verified.verification);
        if (!verified.payload || verified.verification.outcome !== "valid")
          return fail(
            this.deps.gate.selectiveAnnual ? "bad-signature" : "evidence-invalid",
            "selective disclosure does not match its signed commitment",
          );
      }
    // Audience.
    if (envelope.to) {
      if (envelope.to.actor !== identity.actor)
        return fail("wrong-audience", `addressed to ${envelope.to.actor}`);
    } else {
      const answers = envelope.inReplyTo ? answersOurs(envelope.inReplyTo) : false;
      const publicConfig = config?.requesterAuthentication === "not-applicable";
      if (!(publicConfig && (answers || !signedBy))) {
        return fail("wrong-audience", "message has no audience");
      }
    }

    // Time window.
    const now = Date.parse(at);
    const created = Date.parse(envelope.createdAt ?? "");
    const expires = Date.parse(envelope.expiresAt ?? "");
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
    expect: {
      actor: Iri;
      party?: Iri;
      operation: Iri;
      actorKid?: string;
      credential?: EmbeddedCredentialNode;
    },
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
    const s =
      check.payload && expect.credential
        ? expect.credential.originalJws === jws && expect.credential.projectionMatches()
          ? (expect.credential
              .payload as unknown as import("../mechanisms/statements.js").RepresentationStatement)
          : undefined
        : check.payload;
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
    if (this.deps.gate.agentRegistry) {
      const failure = await this.deps.gate.agentRegistry.check(
        s.actor,
        s.party,
        s.actorKid,
        expect.operation,
      );
      if (failure)
        return done({
          ...base,
          party: s.party,
          statement: s.id,
          outcome: "not-accepted",
          reason: failure,
        });
    }
    if (this.deps.gate.authorizationGrant) {
      const failure = await this.deps.gate.authorizationGrant.check(
        s.authorityGrant,
        s.actor,
        s.party,
        s.actorKid,
        expect.operation,
      );
      if (failure)
        return done({
          ...base,
          party: s.party,
          statement: s.id,
          outcome: "not-accepted",
          reason: failure,
        });
    }
    if (this.deps.gate.mandateCredential) {
      const failure = await this.deps.gate.mandateCredential.check(
        s.mandate,
        s.actor,
        s.party,
        s.actorKid,
      );
      if (failure)
        return done({
          ...base,
          party: s.party,
          statement: s.id,
          outcome: "not-accepted",
          reason: failure,
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
    if (
      this.deps.gate.authorityChains &&
      (!this.deps.gate.authorityChains.policy.operations ||
        this.deps.gate.authorityChains.policy.operations.includes(handler.description.id))
    ) {
      const credential = (msg.evidence ?? []).find(
        (e) => e.role === "representation" && e.format === "mandate-chain+jws",
      );
      const body = msg.body as unknown as JsonObject;
      const input = body.input as JsonObject | undefined;
      const chain = new AuthorityChainChecks({
        ...this.deps.gate.authorityChains,
        trust: this.deps.trust,
        now: this.deps.now,
        verifier: this.deps.identity.actor,
        record: (v) => this.deps.record(v),
      });
      const result = await chain.check(credential?.value, {
        actor: msg.from.actor,
        kid: kid ?? "",
        entity: msg.from.onBehalfOf,
        action: this.deps.gate.authorityChains.policy.actionField
          ? String(input?.request ?? "")
          : msg.kind,
        operation: handler.description.id,
        subject: typeof input?.subject === "string" ? input.subject : msg.from.onBehalfOf,
        purpose: typeof body.purpose === "string" ? body.purpose : "",
      });
      return done({
        ...base,
        outcome: result.ok ? "accepted" : "not-accepted",
        ...(result.ok
          ? { statement: result.statement }
          : {
              reason: result.reason,
              ...(result.deciderRole ? { deciderRole: result.deciderRole } : {}),
            }),
      });
    }
    if (this.deps.gate.organizations) {
      const credential = (msg.evidence ?? []).find(
        (e) => e.role === "representation" && e.format === "organization-mandate+jws",
      );
      if (!credential || !kid)
        return done({ ...base, outcome: "not-accepted", reason: "representation-missing" });
      const body = msg.body as unknown as JsonObject;
      const requestedEntity = (body.input as JsonObject | undefined)?.entity;
      const authority = await this.organizations()?.authority(credential.value, {
        actor: msg.from.actor,
        kid,
        entity: msg.from.onBehalfOf,
        operation: handler.description.id,
        action:
          this.deps.gate.organizations.policy.actionKinds?.[handler.description.id] ?? msg.kind,
        requestedEntity,
      });
      return done({
        ...base,
        outcome: authority?.ok ? "accepted" : "not-accepted",
        ...(authority?.ok
          ? { statement: authority.statement }
          : { reason: authority?.reason ?? "lookup-failed" }),
      });
    }
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
        ...(item instanceof EvidenceItemNode && item.credential
          ? { credential: item.credential }
          : {}),
      });
      if (last.outcome === "accepted") return last;
    }
    return last ?? done({ ...base, outcome: "not-accepted", reason: "representation-invalid" });
  }

  resolvePrecedence(purpose: string | undefined): string | undefined {
    for (const rule of this.deps.gate.reliance?.rules ?? []) {
      if (!rule.precedence) continue;
      const facts = [...this.deps.memory.facts.values()].filter(
        (f) =>
          f.claimType === rule.claimType &&
          f.admittedPurpose === purpose &&
          f.statement &&
          fitnessOf(
            StatementQualityNode.from(f.statement as Claim),
            this.deps.gate.reliance,
            this.deps.now(),
          ).verdict === "pass",
      );
      const groups = new Map<string, AdmittedFact[]>();
      for (const fact of facts) {
        const key = digestOf({ subject: fact.subject, period: fact.statement?.period ?? null });
        const group = groups.get(key) ?? [];
        group.push(fact);
        groups.set(key, group);
      }
      const value = (f: AdmittedFact) =>
        Object.fromEntries(
          Object.entries(f.statement ?? {}).filter(
            ([k]) =>
              ![
                "id",
                "issuer",
                "method",
                "asOf",
                "issuedAt",
                "terms",
                "validUntil",
                "status",
                "rank",
                "yieldTo",
                "resourceGrant",
              ].includes(k),
          ),
        );
      for (const group of groups.values()) {
        if (new Set(group.map((f) => digestOf(value(f)))).size < 2) continue;
        const policy = rule.precedence;
        const compare = (a: AdmittedFact, b: AdmittedFact) => {
          const ar = policy.sources.indexOf(a.source),
            br = policy.sources.indexOf(b.source);
          if (ar < 0 || br < 0) return 0;
          const rank = br - ar;
          const age = Date.parse(a.asOf ?? "") - Date.parse(b.asOf ?? "");
          return policy.freshness === "newer-first"
            ? Number.isFinite(age) && age !== 0
              ? age
              : rank
            : rank || (Number.isFinite(age) ? age : 0);
        };
        const winner = group.find((a) =>
          group.every(
            (b) => a === b || digestOf(value(a)) === digestOf(value(b)) || compare(a, b) > 0,
          ),
        );
        if (!winner) {
          const ids = group.map((f) => f.id);
          for (const fact of group) {
            this.deps.memory.facts.delete(fact.id);
            this.deps.memory.precedenceHolds[fact.id] = { ...fact, disputedWith: ids };
            this.deps.memory.refusals[`statement:${fact.id}`] = "completeness-not-established";
            for (const [scope, items] of Object.entries(this.deps.memory.contexts))
              this.deps.memory.contexts[scope] = items.map((i) =>
                i.id === fact.id ? { ...i, accepted: false, disputedWith: ids } : i,
              );
          }
          const detail = `Conflicting statements require an order: ${group.map((f) => `${f.id} from ${f.source}`).join("; ")}.`;
          const record = { type: "precedence-unresolved", statements: ids, purpose };
          this.deps.record(record);
          this.verdictEvent("fitness", "ask-more", detail, {
            reason: "completeness-not-established",
          });
          return detail;
        }
        for (const fact of group) {
          if (fact.id === winner.id || digestOf(value(fact)) === digestOf(value(winner))) continue;
          this.deps.memory.facts.delete(fact.id);
          this.deps.memory.precedenceHolds[fact.id] = { ...fact, supersededBy: winner.id };
          this.deps.memory.refusals[`statement:${fact.id}`] = "superseded-by-better-source";
          for (const [scope, items] of Object.entries(this.deps.memory.contexts))
            this.deps.memory.contexts[scope] = items.map((i) =>
              i.id === fact.id ? { ...i, accepted: false, supersededBy: winner.id } : i,
            );
          const record = {
            type: "statement-superseded",
            statement: fact.id,
            digest: fact.digest,
            by: winner.id,
            purpose,
            reason: "superseded-by-better-source",
          };
          this.deps.record(record);
          this.verdictEvent(
            "fitness",
            "pass",
            `${fact.id} is retained but superseded by ${winner.id} for this purpose.`,
            { reason: "superseded-by-better-source" },
          );
        }
      }
    }
    return undefined;
  }

  /** Plain name for a claim. */
  labelOf(c: Claim): string {
    const label = this.deps.gate.originHosted?.nonTransferable(String(c.id))
      ? `${this.name(c.issuer)}'s unsigned product record`
      : (this.deps.gate.claimLabel?.(c as unknown as Record<string, unknown>) ??
        `${this.name(c.issuer)}'s ${
          c.claimType === "mortgage.product"
            ? "signed product terms"
            : c.claimType
                .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
                .replace(/[._-]/g, " ")
                .toLowerCase() + " statement"
        }`);
    const mapping = (c as JsonObject).derivation as JsonObject | undefined;
    return mapping?.type === "code-mapping" && mapping.approximate === true
      ? `${label} (approximate mapping; reduced standing)`
      : label;
  }

  /** Source: who stands behind one relayed claim, and is that source accepted for it? */
  async assessClaim(
    item: EvidenceItem,
    subject: Iri | undefined,
  ): Promise<{
    verdict: Verdict;
    reason?: string;
    claim?: Claim;
    methodOverride?: string;
    resolution?: Resolution;
    rule?: { id: string; text: string };
  }> {
    const at = this.deps.now();
    if (item.format === "origin-hosted") {
      const node = await this.deps.gate.originHosted?.verify(
        item,
        this.deps.trust,
        at,
        this.deps.identity.actor,
        (entry) => this.deps.record(entry),
      );
      if (!node) return { verdict: "fail", reason: "evidence-invalid" };
      const claim = node.live as Claim,
        issuer = node.string("issuer")!,
        kind = node.string("claimType")!,
        about = node.string("subject") ?? subject;
      const input = {
        evaluator: this.deps.identity.actor,
        source: issuer,
        claimType: kind,
        ...(about ? { subject: about } : {}),
        at,
      };
      const resolution = this.deps.gate.resolver?.resolveSource(input),
        outcome = resolution?.outcome ?? this.deps.trust.assessSource(input).outcome;
      const permitted = this.deps.gate.claimSources?.[kind];
      const ok = outcome === "accepted" && (!permitted || permitted.includes(issuer));
      return {
        verdict: ok ? "pass" : outcome === "unresolved" ? "indeterminate" : "fail",
        reason: ok
          ? "source-accepted"
          : outcome === "unresolved"
            ? "lookup-failed"
            : outcome === "no-route"
              ? "source-unknown"
              : "source-not-authoritative",
        claim,
        ...(resolution ? { resolution } : {}),
      };
    }
    const verify = (role: "issuer" | "party" | "actor") =>
      verifyStatement(item.value, {
        trust: this.deps.trust,
        typ: TYP.statement,
        role,
        schema: claimSchema,
        limits: this.deps.limits,
        verifier: this.deps.identity.actor,
        at,
      });
    let check =
      item.format === "selective-disclosure+jws"
        ? ((await verifySelectivePresentation(
            item,
            this.deps.trust,
            at,
            this.deps.identity.actor,
          )) as import("../mechanisms/statements.js").StatementCheck<Claim>)
        : await verify("issuer");
    // A party pinned at its introduction (an organization's own key) may also make statements.
    if (check.verification.outcome === "unknown-key") check = await verify("party");
    if (check.verification.outcome === "unknown-key") {
      const reading = await verify("actor");
      if (
        reading.verification.outcome === "valid" &&
        (reading.payload?.method !== "derived" || !reading.payload.derivation) &&
        (reading.payload?.method !== "model-output" ||
          typeof (reading.payload as JsonObject).originalDigest !== "string" ||
          typeof (reading.payload as JsonObject).implementation !== "string")
      )
        return { verdict: "fail", reason: "evidence-invalid" };
      check = reading;
    }
    this.deps.record(check.verification);
    const verifiedPayload = check.payload;
    const s =
      verifiedPayload &&
      item instanceof EvidenceItemNode &&
      item.credential?.types.has("https://www.w3.org/2018/credentials#VerifiableCredential")
        ? (item.credential.payload as Claim)
        : verifiedPayload;
    if (!s || check.verification.outcome !== "valid")
      return {
        verdict: "fail",
        reason: check.verification.outcome === "unknown-key" ? "unknown-key" : "evidence-invalid",
      };
    const metadata = StatementQualityNode.from(s);
    // Legacy claim schemas admit non-IRI identifiers. Keep those exact readings until
    // their credential admission is migrated; valid issuer/subject IRIs read the graph.
    const issuer = metadata.issuer ?? s.issuer;
    const sourceSubject = metadata.claimSubject ?? s.subject;
    if (
      metadata.method === "model-output" &&
      (typeof s.originalDigest !== "string" ||
        typeof s.implementation !== "string" ||
        typeof s.implementationDigest !== "string")
    )
      return { verdict: "fail", reason: "evidence-invalid", claim: s };
    if (check.signer?.subject !== issuer)
      return { verdict: "fail", reason: "evidence-invalid", claim: s };
    if (this.deps.gate.organizations && check.signer) {
      const current = await this.organizations()?.key(
        issuer,
        check.signer.kid,
        issuer,
        check.signer.role,
      );
      if (!current?.ok)
        return { verdict: "fail", reason: current?.reason ?? "lookup-failed", claim: s };
      if (
        this.deps.gate.organizations.policy.statusClaims?.includes(metadata.claimType) &&
        (!s.status || typeof s.status !== "object")
      )
        return { verdict: "fail", reason: "lookup-failed", claim: s };
      if (s.status && typeof s.status === "object") {
        const status = await this.organizations()?.status(issuer, s.status);
        if (!status?.ok)
          return { verdict: "fail", reason: status?.reason ?? "lookup-failed", claim: s };
      }
    }
    if (
      metadata.method === "derived" &&
      this.deps.gate.rules?.length &&
      (!s.derivation || typeof s.derivation !== "object" || Array.isArray(s.derivation))
    )
      return { verdict: "fail", reason: "derivation-not-verified", claim: s };
    // The claim's own subject, when it names one: a bank's statement relayed by the bank's
    // agent is still about the account holder.
    // Recomputed outputs get their source authority from their admitted original inputs.
    // The source phase below verifies the rule, exact inputs, output and inherited terms.
    if (
      metadata.method === "derived" &&
      s.derivation &&
      ((s.derivation as JsonObject).assurance === "recomputed" || opaqueDerivation(s as JsonObject))
    )
      return { verdict: "pass", reason: "source-accepted", claim: s };
    const about = sourceSubject ?? subject;
    const input = {
      evaluator: this.deps.identity.actor,
      source: issuer,
      claimType: metadata.claimType,
      ...(about ? { subject: about } : {}),
      at,
    };
    const resolution = this.deps.gate.resolver?.resolveSource(input);
    const outcome = resolution?.outcome ?? this.deps.trust.assessSource(input).outcome;
    const permittedSources = this.deps.gate.claimSources?.[metadata.claimType];
    if (outcome !== "no-route" && permittedSources && !permittedSources.includes(issuer))
      return {
        verdict: "fail",
        reason: "source-not-authoritative",
        claim: s,
        ...(resolution ? { resolution } : {}),
      };
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
              text: `${this.name(issuer)} is accepted for ${metadata.claimType} claims.`,
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

  /** A paid acceptance is an agreement only when both native credential proofs verify. */
  async checkAgreementCredential(
    message: MessageNode,
    offer?: MessageNode,
  ): Promise<string | undefined> {
    const protocol = this.deps.gate.agreementCredential;
    if (!protocol) return undefined;
    const checked = await protocol.check(message, offer, this.deps.trust, this.deps.now());
    if (checked.state === "not-applicable") return undefined;
    this.verdictEvent(
      "authority",
      checked.reason ? "fail" : "pass",
      checked.reason === "no-agreement"
        ? "Only the valuer's proof is present. This remains an offer, not an agreement."
        : checked.reason
          ? "The agreement credential proofs, terms or current status could not be verified."
          : checked.state === "agreement"
            ? "Both parties' Data Integrity proofs cover the same valuation terms and their signed status lists are clear."
            : "The valuer's Data Integrity proof establishes an offer; the acceptor's proof is still required.",
      {
        reason: checked.reason ?? "authority-valid",
        ...(checked.credential
          ? {
              fact: {
                id: checked.credential.id!,
                label:
                  checked.state === "agreement"
                    ? "The two-proof valuation agreement"
                    : "The valuer's signed credential offer",
                claimType: "agreement.credential",
                subject: message.id,
                source: checked.credential.issuer,
                value: checked.credential,
              },
            }
          : {}),
      },
    );
    return checked.reason;
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

  /** Refusals are gate records, never core context or admitted facts. */
  private failedClaim(c: Claim, reason: string, task: string): void {
    this.deps.memory.refusals[
      `${this.deps.gate.taskId ?? task}|${c.claimType}|${c.subject ?? ""}`
    ] = reason;
    this.deps.memory.refusals[`statement:${c.id ?? digestOf(c)}`] = reason;
    const holdKey = `${this.deps.gate.taskId ?? task}|${c.id ?? digestOf(c)}`;
    delete this.deps.memory.relianceHolds[holdKey];
    if (
      this.deps.gate.personMayRelyOn?.includes(c.claimType) &&
      ["source-not-authoritative", "source-unknown", "method-not-accepted"].includes(reason) &&
      ["self-reported", "reported-by-subject"].includes(c.method ?? "") &&
      c.issuer === c.subject
    ) {
      const taskId = this.deps.gate.taskId ?? task;
      this.deps.memory.relianceHolds[`${taskId}|${c.id ?? digestOf(c)}`] = {
        task: taskId,
        statement: copyData(c) as JsonObject,
        digest: digestOf(c),
        reason,
      };
    }
  }

  requiredFailure(c: Claim, reason: string, operation?: string): string | undefined {
    if (this.deps.gate.statedConfidence && reason === "confidence-too-low")
      return "A source confidence measurement with an accepted calibration method meeting this task’s threshold is required.";
    if (
      this.deps.gate.incomeCorroboration &&
      StatementQualityNode.from(c).claimType === "income.gross.monthly-series" &&
      reason === "evidence-missing"
    )
      return "Independent payroll and bank salary-credit observations for the same period and currency are required.";
    if (
      this.deps.gate.registryMeaning &&
      StatementQualityNode.from(c).claimType === "income.gross.monthly-series" &&
      reason === "unsupported-term"
    )
      return "Employment status requires a mapping signed by a publisher accepted for both code lists.";
    if (!operation || !CURABLE_CLAIM_FAILURES.has(reason)) return undefined;
    if (
      !this.deps.gate.actionClaims?.some(
        (r) => r.action === operation && r.claims.includes(c.claimType),
      )
    )
      return undefined;
    return claimRequest(this.deps.gate, c.claimType);
  }

  /** Brief 26e seam: certification also precedes optional admission-batch quality work. */
  private async qualityIsCertified(
    claim: unknown,
    at: string,
    carriedBy?: string,
  ): Promise<boolean> {
    const certificate = this.deps.gate.qualityCertificate;
    return certificate
      ? certifiedQuality(claim, {
          ...certificate,
          trust: this.deps.trust,
          at,
          verifier: this.deps.identity.actor,
          evaluatorParty: this.deps.identity.party,
          carriedBy,
          record: this.deps.record,
        })
      : false;
  }

  /** Source, terms and fitness of one claim: one event each. Returns whether all passed. */
  // AUTHORED-BY Codex GPT-6
  async checkJointBindings(session: JsonObject): Promise<boolean> {
    if (!session.wire) return true; // Existing test-only protocol has a distinct wire format.
    const roster = session.roster as JsonObject[];
    let ok = Array.isArray(roster) && roster.length > 0;
    for (const member of roster ?? []) {
      if (typeof member.keyBinding !== "string") {
        ok = false;
        break;
      }
      const checked = await this.assessClaim(
        { role: "credential", format: "derivation+jws", value: member.keyBinding },
        String(member.party),
      );
      const c = checked.claim;
      if (
        checked.verdict !== "pass" ||
        !c ||
        c.claimType !== "joint.keys" ||
        c.issuer !== member.party ||
        c.subject !== member.party ||
        c.method !== "recorded-by-authority" ||
        digestOf(c.value) !==
          digestOf({ publicKeys: member.publicKeys, computeOnly: member.computeOnly === true })
      ) {
        ok = false;
        break;
      }
    }
    this.verdictEvent(
      "source",
      ok ? "pass" : "fail",
      "Each aggregate key and compute-only role is bound by a statement signed with its party's independently pinned identity key.",
      {
        reason: ok ? "source-accepted" : "source-not-accepted",
        rule: {
          id: "DER-key-binding",
          text: "Authenticate every roster key binding before accepting the roster.",
        },
      },
    );
    return ok;
  }

  async claimChecks(
    item: EvidenceItem,
    subject: Iri | undefined,
    need: {
      purpose?: Iri;
      retentionDays?: number;
      task: string;
      taskId?: string;
      carriedBy?: string;
      messageEvidence?: readonly EvidenceItem[];
    },
    phase: "source" | "terms" | "fitness",
    cache: Map<string, Awaited<ReturnType<InboundGate["assessClaim"]>>>,
    termsOk: Map<string, boolean> = new Map(),
  ): Promise<boolean> {
    let r = cache.get(item.value);
    if (!r) {
      r = await this.assessClaim(item, subject);
      cache.set(item.value, r);
    }
    if (
      phase === "source" &&
      r.verdict === "pass" &&
      r.claim?.claimType === "mortgage.product" &&
      this.deps.gate.trustedIndex &&
      need.carriedBy === this.deps.gate.trustedIndex.source
    ) {
      const ok = await checkIndexReceipt(
        item,
        need.messageEvidence ?? [],
        this.deps.gate.trustedIndex,
        this.deps.trust,
        this.deps.now(),
        this.deps.identity.actor,
        (entry) => this.deps.record(entry),
      );
      if (!ok) {
        r = { ...r, verdict: "fail", reason: "evidence-invalid" };
        cache.set(item.value, r);
      }
    }
    let c = r.claim;
    let label = c ? this.labelOf(c) : "A relayed statement";
    if (
      phase === "source" &&
      c &&
      (c.claimType === "joint.message" ||
        (c.derivation as JsonObject | undefined)?.assurance === "joint")
    ) {
      const value = c.value as JsonObject | undefined;
      const joint = (c.derivation as JsonObject | undefined)?.joint as JsonObject | undefined;
      const fixed = this.deps.gate.fixedJointSessions?.[String(value?.sessionId ?? "")];
      const session = (joint?.session ?? value?.session ?? fixed?.session) as
        | JsonObject
        | undefined;
      if (session && !(await this.checkJointBindings(session))) {
        cache.set(item.value, { ...r, verdict: "fail", reason: "source-not-accepted" });
        this.failedClaim(c, "source-not-accepted", need.taskId ?? need.task);
        return false;
      }
      if (session?.wire && value && c.claimType === "joint.message") {
        const kind =
          "partial" in value
            ? "partial"
            : "contribution" in value
              ? "contribute"
              : "outcome" in value
                ? "outcome"
                : "open";
        try {
          parseBoundedJson(
            JSON.stringify(value),
            jointLimits(kind, (session.roster as JsonObject[]).length),
          );
          if (kind === "partial") {
            const index = (session.roster as JsonObject[]).findIndex(
              (p) => p.party === this.deps.identity.party,
            );
            if (
              index < 0 ||
              ((value.partial as JsonObject).message as JsonObject)?.recipient !== index
            )
              throw new Error("private routing mismatch");
          }
          if (kind === "outcome") {
            const checked = await verifyJointMessageOutcome(
              this.deps.gate,
              value,
              need.purpose ?? "",
            );
            this.verdictEvent(
              "source",
              checked.ok ? "pass" : "fail",
              checked.ok
                ? "The real research-grade, unaudited outcome verifier checked the complete ordered contribution set before core admission."
                : `Joint outcome refused: ${checked.detail ?? checked.reason}.`,
              {
                reason: checked.ok ? "source-accepted" : checked.reason,
                rule: {
                  id: "DER-14",
                  text: "Verify the complete joint outcome in the inbound source gate.",
                },
              },
            );
            if (!checked.ok) {
              cache.set(item.value, { ...r, verdict: "fail", reason: checked.reason });
              this.failedClaim(
                c,
                checked.reason ?? "derivation-not-verified",
                need.taskId ?? need.task,
              );
              return false;
            }
          }
        } catch {
          cache.set(item.value, { ...r, verdict: "fail", reason: "source-not-accepted" });
          return false;
        }
      }
    }
    if (phase === "source" && c?.derivation && opaqueDerivation(c as JsonObject)) {
      const proof = (c.derivation as JsonObject).proof as JsonObject | undefined;
      if (
        proof?.method === "sparq-zk-result/5" &&
        this.deps.gate.proofSystems?.get("sparq-zk-result/5")?.kind === "real"
      ) {
        const request = this.deps.gate.derivedRequests?.[String(proof.nonce)];
        const checked = admittedResultPolicy(
          this.deps.memory,
          request?.policy,
          this.deps.gate.proofIssuerKeys ?? [],
          {
            agent: this.deps.identity.actor,
            purpose: need.purpose,
            at: this.deps.now(),
            reliance: this.deps.gate.reliance,
          },
        );
        if (!checked.ok) {
          this.verdictEvent("source", "fail", checked.detail, {
            reason: checked.reason,
            rule: {
              id: "DER-key-binding",
              text: "Admit each identity-signed result key statement and status snapshot before using its native policy.",
            },
          });
          cache.set(item.value, { ...r, verdict: "fail", reason: checked.reason });
          this.failedClaim(c, checked.reason, need.taskId ?? need.task);
          return false;
        }
      }
      const result = await verifyOpaqueDerivation({
        statement: c as JsonObject,
        gate: this.deps.gate,
        purpose: need.purpose ?? "",
        acceptsSource: (issuer, kind) => {
          const lookup = {
            evaluator: this.deps.identity.actor,
            source: issuer,
            claimType: kind,
            subject: c?.subject ?? subject,
            at: this.deps.now(),
          };
          const assessed =
            this.deps.gate.resolver?.resolveSource(lookup) ?? this.deps.trust.assessSource(lookup);
          const permitted = this.deps.gate.claimSources?.[kind];
          return assessed.outcome === "accepted" && (!permitted || permitted.includes(issuer));
        },
        event: (event) =>
          this.verdictEvent("source", event.ok ? "pass" : "fail", event.text, {
            reason: event.reason,
            rule: { id: event.clause, text: event.text },
          }),
      });
      if (!result.ok) {
        cache.set(item.value, { ...r, verdict: "fail", reason: result.reason });
        this.failedClaim(c, result.reason, need.taskId ?? need.task);
        return false;
      }
      c = result.statement as Claim;
      cache.set(item.value, {
        ...r,
        claim: c,
        verdict: "pass",
        reason: "source-accepted",
        ...(result.reportedBySubject ? { methodOverride: "reported-by-subject" } : {}),
      });
      return true;
    }
    if (phase === "source" && c?.derivation) {
      const derived = verifyDerivation(c as JsonObject, {
        rules: this.deps.gate.rules ?? [],
        attestedDerivers: this.deps.gate.attestedDerivers,
        sources: this.deps.gate.sourceAliases,
        memory: this.deps.memory,
        task: this.deps.gate.taskId ?? need.task,
        subject: c.subject ?? subject ?? "",
        reliance: this.deps.gate.reliance,
        at: this.deps.now(),
        purpose: need.purpose ?? "",
      });
      if (!derived.ok) {
        cache.set(item.value, { ...r, verdict: "fail", reason: derived.reason });
        this.failedClaim(c, derived.reason, need.taskId ?? need.task);
        this.verdictEvent(
          "source",
          "fail",
          "The declared derivation is not accepted or could not be verified.",
          { reason: derived.reason },
        );
        return false;
      }
      const record = c.derivation as JsonObject;
      for (const input of (record.inputs ?? []) as JsonObject[]) {
        const lookup = {
          evaluator: this.deps.identity.actor,
          source: String(input.issuer),
          claimType: String(input.claimType),
          subject: c.subject ?? subject,
          at: this.deps.now(),
        };
        const resolution = this.deps.gate.resolver?.resolveSource(lookup);
        const assessed = resolution ?? this.deps.trust.assessSource(lookup);
        const permitted = this.deps.gate.claimSources?.[String(input.claimType)];
        this.verdictEvent(
          "source",
          assessed.outcome === "accepted" &&
            (!permitted || permitted.includes(String(input.issuer)))
            ? "pass"
            : "fail",
          "The receiver checks each original input issuer for the claim the rule read.",
          {
            reason:
              assessed.outcome === "accepted" &&
              (!permitted || permitted.includes(String(input.issuer)))
                ? "source-accepted"
                : "source-not-authoritative",
            ...(resolution ? { resolution: resolutionView(resolution) } : {}),
          },
        );
        if (
          assessed.outcome !== "accepted" ||
          (permitted && !permitted.includes(String(input.issuer)))
        ) {
          cache.set(item.value, { ...r, verdict: "fail", reason: "source-not-authoritative" });
          this.failedClaim(c, "source-not-authoritative", need.taskId ?? need.task);
          this.verdictEvent(
            "source",
            "fail",
            "An input issuer is not accepted for the claim read by this rule.",
            { reason: "source-not-authoritative" },
          );
          return false;
        }
      }
    }
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
      if (c && r.reason === "source-unknown" && this.deps.gate.resolver?.pinnedOnly)
        this.deps.gate.sink?.emit({
          part: "principal",
          kind: "ask-principal",
          reason: "source-unknown",
          caption: "The source is outside the principal’s own list; its statement is withheld.",
          chat: {
            who: "agent",
            text: `May I add ${this.name(c.issuer)} to your list for this kind of statement? The statement stays outside memory until you decide.`,
          },
        });
      if (c && r.verdict !== "pass")
        this.failedClaim(c, r.reason ?? "source-not-authoritative", need.taskId ?? need.task);
      return r.verdict === "pass";
    }
    if (!c || r.verdict !== "pass") return false;
    const receivedClaim = c;
    const at = this.deps.now();
    const terms = c.terms as ItemTerms | undefined;
    if (phase === "terms") {
      const t = evaluateItemTerms(terms, {
        name: this.deps.gate.name,
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
          rule: { id: terms?.policy?.id ?? "default-terms", text: t.text },
        },
      );
      if (t.verdict !== "pass")
        this.failedClaim(c, t.reason ?? "terms-not-acceptable", need.taskId ?? need.task);
      termsOk.set(item.value, t.verdict === "pass");
      return t.verdict === "pass";
    }
    if (
      c.method === "derived" &&
      c.derivation &&
      typeof c.derivation === "object" &&
      !Array.isArray(c.derivation)
    ) {
      for (const input of ((c.derivation as JsonObject).inputs ?? []) as JsonObject[]) {
        const basis = fitnessOf(
          StatementQualityNode.from({
            claimType: String(input.claimType),
            method: String(input.method),
            asOf: String(input.asOf),
          }),
          this.deps.gate.reliance,
          at,
        );
        if (basis.verdict !== "pass") {
          this.verdictEvent(
            "fitness",
            basis.verdict,
            "Assurance cannot raise the quality of the original input's method or time.",
            { reason: basis.reason },
          );
          this.failedClaim(c, basis.reason ?? "method-not-accepted", need.taskId ?? need.task);
          return false;
        }
      }
    }
    if (this.deps.gate.statedConfidence) {
      const confidence = confidenceFitness(c, this.deps.gate.statedConfidence);
      if (confidence.statement || !confidence.ok)
        this.verdictEvent(
          "fitness",
          confidence.ok ? "pass" : "fail",
          confidence.ok
            ? "The bank’s source-stated confidence meets this task’s threshold by the recorded calibration method."
            : "The source confidence is below the task’s threshold or has no accepted calibration; a model’s own estimate is uncalibrated.",
          { reason: confidence.ok ? "fit-for-use" : confidence.reason },
        );
      if (!confidence.ok) {
        this.failedClaim(c, confidence.reason, need.taskId ?? need.task);
        this.claimFailure = { outcome: "ask-more", reason: confidence.reason };
        return false;
      }
    }
    // Brief 26e seam: interpreting a qualified field never rewrites its signed parent.
    if (
      this.deps.gate.registryMeaning &&
      StatementQualityNode.from(c).claimType === "income.gross.monthly-series"
    ) {
      const interpretation = await interpretEmployment(c, {
        ...this.deps.gate.registryMeaning,
        seenVersions: this.mappingVersions,
        trust: this.deps.trust,
        at,
        verifier: this.deps.identity.actor,
        record: this.deps.record,
      });
      this.verdictEvent(
        "fitness",
        interpretation.ok ? "pass" : "indeterminate",
        interpretation.ok
          ? "The signed payroll employment status maps to the lender’s versioned code list; the original and mapping provenance are retained."
          : "No accepted mapping establishes the employment status requested by the lender.",
        { reason: interpretation.ok ? "fit-for-use" : interpretation.reason },
      );
      if (!interpretation.ok) {
        this.failedClaim(c, interpretation.reason, need.taskId ?? need.task);
        this.claimFailure = { outcome: interpretation.outcome, reason: interpretation.reason };
        return false;
      }
      this.emit({
        part: "memory",
        kind: "store",
        caption:
          "Employment status interpreted through the signed mapping, alongside its original payroll statement.",
        fact: {
          id: String(interpretation.value.id),
          label: "Mapped employment status",
          claimType: "employment.status",
          subject: String(c.subject),
          value: interpretation.value,
          source: c.issuer,
          method: "derived",
          provenance:
            "Mapped from the payroll provider’s signed employment status; mapping publisher and signed parent digest are retained.",
        },
      });
    }
    const certified = await this.qualityIsCertified(c, at, need.carriedBy);
    const f = certified
      ? { verdict: "pass" as const, ageDays: undefined, reason: undefined, rule: undefined }
      : fitnessOf(
          StatementQualityNode.from({ ...c, method: r.methodOverride ?? c.method }),
          this.deps.gate.reliance,
          at,
        );
    this.verdictEvent(
      "fitness",
      f.verdict,
      certified
        ? "An accepted current certificate covers this index, dataset, product category and quality policy; no per-record freshness check is applied."
        : f.verdict === "pass"
          ? `${label} is fit for ${need.task}: ${c.method ?? "method unstated"}, ${f.ageDays} days old.`
          : f.reason === "stale-data"
            ? `${label} is too old for ${need.task}.`
            : f.reason === "method-not-accepted"
              ? `${label} was not produced in a way ${need.task} accepts.`
              : `No reliance rule covers ${label}.`,
      { ...(f.reason ? { reason: f.reason } : {}), ...(f.rule ? { rule: f.rule } : {}) },
    );
    if (termsOk.get(item.value) !== true || f.verdict !== "pass") {
      if (f.verdict !== "pass")
        this.failedClaim(c, f.reason ?? "missing-context", need.taskId ?? need.task);
      return false;
    }
    if (
      this.deps.gate.incomeCorroboration &&
      StatementQualityNode.from(c).claimType === "income.gross.monthly-series"
    ) {
      const corroborated = corroborateIncome(c, this.corroborationPool, {
        settings: this.deps.gate.incomeCorroboration,
        trust: this.deps.trust,
        reliance: this.deps.gate.reliance,
        at,
        verifier: this.deps.identity.actor,
        purpose: need.purpose,
        record: this.deps.record,
      });
      this.verdictEvent(
        "fitness",
        corroborated.ok ? "pass" : "ask-more",
        corroborated.ok
          ? "Payroll and independently recorded bank salary credits agree within the stated currency tolerance."
          : "Two independent income observations are missing; shared source records count once.",
        { reason: corroborated.ok ? "fit-for-use" : corroborated.reason },
      );
      if (!corroborated.ok) {
        this.failedClaim(c, corroborated.reason, need.taskId ?? need.task);
        this.claimFailure = { outcome: "ask-more", reason: corroborated.reason };
        return false;
      }
    }
    const completeness = this.deps.gate.reliance?.rules.find(
      (r) => r.claimType === receivedClaim.claimType,
    )?.completeness;
    if (
      completeness &&
      !this.corroborationPool.some(
        (candidate) =>
          candidate.claimType === completeness &&
          candidate.subject === receivedClaim.subject &&
          candidate.complete === true &&
          candidate.forClaim === receivedClaim.claimType &&
          this.deps.memory.facts.get(candidate.id ?? "")?.digest === digestOf(candidate) &&
          digestOf(candidate.period ?? null) === digestOf(receivedClaim.period ?? null),
      )
    ) {
      this.verdictEvent(
        "fitness",
        "ask-more",
        `An accepted completeness statement for ${c.claimType}, its subject and period is required.`,
        { reason: "completeness-not-established" },
      );
      this.failedClaim(c, "completeness-not-established", need.taskId ?? need.task);
      this.claimFailure = { outcome: "ask-more", reason: "completeness-not-established" };
      return false;
    }
    const corroboration = this.deps.gate.reliance?.rules.find(
      (r) => r.claimType === receivedClaim.claimType,
    )?.corroboration;
    if (corroboration) {
      const comparable = (claim: JsonObject) =>
        Object.fromEntries(
          Object.entries(claim).filter(
            ([key]) =>
              !["id", "issuer", "method", "asOf", "issuedAt", "terms", "validUntil"].includes(key),
          ),
        );
      const matches = this.corroborationPool.filter(
        (candidate) =>
          candidate.subject === receivedClaim.subject &&
          candidate.claimType === receivedClaim.claimType &&
          digestOf(comparable(candidate as JsonObject)) === digestOf(comparable(c as JsonObject)),
      );
      const issuers = new Set(matches.map((claim) => claim.issuer));
      const controllers = new Set(
        matches
          .map((claim) => this.deps.trust.data.controllers?.[claim.issuer])
          .filter((controller) => typeof controller === "string" && controller.length > 0),
      );
      const count = corroboration.independent
        ? Math.min(issuers.size, controllers.size)
        : issuers.size;
      if (count < corroboration.sources) {
        this.verdictEvent(
          "fitness",
          "ask-more",
          `Need ${corroboration.sources} accepted independent sources for ${c.claimType}.`,
          { reason: "completeness-not-established" },
        );
        this.failedClaim(c, "completeness-not-established", need.taskId ?? need.task);
        this.claimFailure = { outcome: "ask-more", reason: "completeness-not-established" };
        return false;
      }
    }

    let mapped = false;
    let original: AdmittedFact["original"];
    if (
      this.deps.gate.codeMappings &&
      typeof c.codeList === "string" &&
      typeof c.code === "string" &&
      !this.deps.gate.codeMappings.policy.acceptedLists.includes(c.codeList)
    ) {
      const result = await mapCodeClaim(c as JsonObject, {
        ...this.deps.gate.codeMappings,
        attestedDerivers: this.deps.gate.attestedDerivers,
        purpose: need.purpose ?? "",
        trust: this.deps.trust,
        at,
        verifier: this.deps.identity.actor,
        record: this.deps.record,
      });
      if (!result.ok) {
        this.verdictEvent(
          "fitness",
          result.outcome === "ask-more" ? "ask-more" : "fail",
          `Code ${result.code} cannot be used through this mapping: ${result.reason}.`,
          {
            reason: result.reason,
            rule: { id: String(c.codeList), text: `Unsupported or unusable code: ${result.code}` },
          },
        );
        this.failedClaim(c, result.reason, need.taskId ?? need.task);
        this.claimFailure = { outcome: result.outcome, reason: result.reason };
        return false;
      }
      const fitness = fitnessOf(
        StatementQualityNode.from(
          result.statement as unknown as import("./quality.js").QualityClaim,
        ),
        this.deps.gate.reliance,
        at,
      );
      if (fitness.verdict !== "pass") {
        this.failedClaim(c, fitness.reason ?? "method-not-accepted", need.taskId ?? need.task);
        this.verdictEvent("fitness", "fail", "The profile does not accept this mapped method.", {
          reason: fitness.reason,
        });
        return false;
      }
      original = {
        id: c.id ?? digestOf(c),
        digest: digestOf(c),
        statement: copyData(c as JsonObject),
        evidence: copyData(item),
      };
      c = result.statement as Claim;
      const originalRecord = { type: "mapping-original", mapped: c.id, original };
      this.deps.record(originalRecord);
      cache.set(item.value, { ...r, claim: c });
      mapped = true;
      label = this.labelOf(c);
      this.verdictEvent(
        "fitness",
        "pass",
        `The signed mapping derives ${String(c.code)}; original source and quality are retained.`,
        { reason: "fit-for-use" },
      );
    }
    const fact: AdmittedFact = {
      ...(original ? { original } : {}),
      admittedPurpose: need.purpose,
      statement: c as JsonObject,
      identifiers: identifiersIn(c),
      id: c.id ?? digestOf(c),
      digest: digestOf(c),
      label,
      claimType: c.claimType,
      source: c.issuer,
      subject: c.subject ?? "unknown",
      ...((r.methodOverride ?? c.method) ? { method: r.methodOverride ?? c.method } : {}),
      ...(c.asOf ? { asOf: c.asOf } : {}),
      ...(c.terms ? { terms: c.terms as ItemTerms } : {}),
    };
    this.deps.memory.facts.set(fact.id, fact);
    if (mapped)
      this.deps.memory.enter(this.deps.gate.taskId ?? need.taskId ?? need.task, {
        ...fact,
        kind: "statement",
        accepted: true,
        digest: digestOf(c),
      });
    delete this.deps.memory.relianceHolds[
      `${this.deps.gate.taskId ?? need.taskId ?? need.task}|${fact.id}`
    ];
    return true;
  }

  /** The memory event for an admitted claim, labelled with source, method, age and terms. */
  storeEvent(c: Claim, chat?: string): void {
    const terms = c.terms as ItemTerms | undefined;
    const method = this.deps.memory.facts.get(c.id ?? digestOf(c))?.method ?? c.method;
    this.emit({
      part: "memory",
      kind: "store",
      fact: {
        id: c.id ?? digestOf(c),
        label: this.labelOf(c),
        claimType: c.claimType,
        subject: c.subject ?? "unknown",
        value:
          ((c as JsonObject).derivation as JsonObject | undefined)?.type === "code-mapping"
            ? { codeList: c.codeList, code: c.code, derivation: c.derivation }
            : ((c as JsonObject).balance ??
              (c as JsonObject).monthly ??
              (c as JsonObject).decision ??
              (c as JsonObject).product ??
              (c as JsonObject).level ??
              null),
        source: c.issuer,
        ...(method ? { method } : {}),
        ...(c.asOf ? { asOf: c.asOf } : {}),
        ...(c.period ? { period: c.period } : {}),
        ...(terms
          ? { terms: { id: terms.policy.id, summary: termsSummary(terms, this.name) } }
          : {}),
        provenance: `${((c as JsonObject).derivation as JsonObject | undefined)?.type === "code-mapping" ? "Locally mapped; original signed by" : "signed by"} ${this.name(c.issuer)}${c.issuedAt ? `, issued ${c.issuedAt}` : ""}`,
      },
      ...(chat
        ? {
            chat: {
              who: "agent" as const,
              text:
                c.method === "model-output"
                  ? `[model-output; reading of ${String(c.originalDigest)}] ${chat}`
                  : chat,
            },
          }
        : {}),
      caption: `${this.labelOf(c)} is stored with its source, how it was produced, its date and its terms.`,
    });
  }

  /**
   * Admit statements the agent fetched or holds (reading data is an inbound message too):
   * integrity, source, authority, terms and fitness per statement, then a labelled fact.
   */
  async admitStatements(
    items: readonly { readonly jws: string; readonly format?: string }[],
    opts: {
      readonly subject?: Iri;
      readonly task: string;
      readonly purpose?: Iri;
      readonly taskId?: Iri;
      readonly operation?: Iri;
    },
  ): Promise<{ admitted: number; refused: number }> {
    let admitted = 0;
    let refused = 0;
    const candidates: Claim[] = [];
    for (const item of items) {
      const checked = await this.assessClaim(
        { role: "credential", format: item.format ?? "jws-compact", value: item.jws },
        opts.subject,
      );
      if (checked.verdict !== "pass" || !checked.claim) continue;
      const c = checked.claim;
      if (
        evaluateItemTerms(c.terms as ItemTerms | undefined, {
          name: this.deps.gate.name,
          agent: this.deps.identity.actor,
          action: "use",
          target: c.id ?? "",
          purpose: opts.purpose,
          at: this.deps.now(),
        }).verdict === "pass" &&
        ((await this.qualityIsCertified(c, this.deps.now())) ||
          fitnessOf(StatementQualityNode.from(c), this.deps.gate.reliance, this.deps.now())
            .verdict === "pass")
      )
        candidates.push(c);
    }
    this.corroborationPool = candidates;
    for (const item of items) {
      this.claimFailure = undefined;
      const ev: EvidenceItem = {
        role: "credential",
        format: item.format ?? "jws-compact",
        value: item.jws,
      };
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
        ev.format === "origin-hosted"
          ? `${label} was fetched directly from the source’s registered address; it is unsigned and cannot be forwarded as evidence.`
          : `${label} is intact and signed with ${this.name(r.claim?.issuer)}'s pinned key.`,
      );
      const sourceOk = await this.claimChecks(ev, opts.subject, opts, "source", cache);
      if (!sourceOk && r.claim)
        this.deps.memory.refusals[
          `${this.deps.gate.taskId ?? opts.taskId ?? opts.task}|${r.claim.claimType}|${r.claim.subject ?? ""}`
        ] = r.reason ?? "source-not-authoritative";
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
        const reason =
          this.getClaimFailure()?.reason ??
          (r.claim
            ? this.deps.memory.refusals[`statement:${r.claim.id ?? digestOf(r.claim)}`]
            : r.reason);
        const request =
          r.claim && reason ? this.requiredFailure(r.claim, reason, opts.operation) : undefined;
        this.decisionEvent(
          request ? "ask-more" : (this.getClaimFailure()?.outcome ?? "refuse"),
          request ?? `${label} is refused and kept out of memory.`,
          reason,
        );
        continue;
      }
      this.decisionEvent("admit", `${label} is admitted.`);
      const claim = (cache.get(item.jws)?.claim ?? r.claim) as Claim;
      this.storeEvent(claim);
      const fact = this.deps.memory.facts.get(claim.id ?? digestOf(claim));
      if (fact)
        this.deps.memory.enter(this.deps.gate.taskId ?? opts.taskId ?? "*", {
          ...fact,
          accepted: true,
          kind: "statement",
          digest: digestOf(claim),
        });
      admitted++;
    }
    const conflict = this.resolvePrecedence(opts.purpose);
    if (conflict) this.decisionEvent("ask-more", conflict, "completeness-not-established");
    return { admitted, refused };
  }
}

/** One message's passage through the inbound gate. */
export class Admission {
  private outcome: InboundOutcome | undefined;
  private readonly done = new Set<InboundCheck>();
  private readonly sources = new Map<string, Verdict>();
  private readonly claimCache = new Map<string, Awaited<ReturnType<InboundGate["assessClaim"]>>>();
  private sourceFailure?: { reason: ReasonCode; detail: string };
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

  private organizations(): OrganizationChecks | undefined {
    const organizations = this.deps.gate.organizations;
    return organizations
      ? new OrganizationChecks({
          ...organizations,
          trust: this.deps.trust,
          now: this.deps.now,
          verifier: this.deps.identity.actor,
          record: this.deps.record,
        })
      : undefined;
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
      (e) => isClaimEvidence(e) || (e.format === "origin-hosted" && !!this.deps.gate.originHosted),
    );
  }

  private need(conv: ConversationState, msg?: AnyMessage) {
    const t = this.deps.agreementTerms(conv.id);
    const ref = msg?.kind === "deliver" ? msg.body.ref : undefined;
    const asked = ref ? this.deps.requestPurpose?.(ref) : undefined;
    const purpose =
      typeof t?.purpose === "string"
        ? t.purpose
        : msg?.kind === "invoke"
          ? msg.body.purpose
          : asked;
    return {
      taskId: conv.id,
      ...(msg?.from.onBehalfOf ? { carriedBy: msg.from.onBehalfOf } : {}),
      ...(purpose ? { purpose } : {}),
      ...(typeof t?.retentionDays === "number" ? { retentionDays: t.retentionDays } : {}),
      task:
        (conv.operation && this.deps.gate.taskLabel?.(conv.operation.id)) ??
        "a mortgage application",
    };
  }

  /** Current admissions or still-fit admitted support, scoped to this task and subject. */
  private missingClaims(
    required: readonly string[],
    task: string,
    subject: string | undefined,
    purpose?: string,
  ): string[] {
    const covered = new Set(
      this.admittedClaims
        .filter((c) => subject !== undefined && c.subject === subject)
        .map((c) => c.claimType),
    );
    for (const item of this.deps.memory.contexts[task] ?? []) {
      const fact = this.deps.memory.facts.get(item.id);
      if (
        !subject ||
        item.subject !== subject ||
        !item.accepted ||
        !fact?.statement ||
        fact.supersededBy ||
        fact.disputedWith?.length ||
        item.digest !== fact.digest ||
        fact.digest !== digestOf(fact.statement)
      )
        continue;
      const quality = StatementQualityNode.from({
        ...fact.statement,
        method: fact.method ?? fact.statement.method,
      } as Claim);
      if (fitnessOf(quality, this.deps.gate.reliance, this.deps.now()).verdict !== "pass") continue;
      if (
        evaluateItemTerms(fact.terms, {
          agent: this.deps.identity.actor,
          action: "use",
          target: fact.id,
          purpose,
          at: this.deps.now(),
        }).verdict !== "pass"
      )
        continue;
      covered.add(fact.claimType);
    }
    return required.filter((kind) => !covered.has(kind));
  }

  /** The operation may concern a referenced item (for example a material lot), not its sender. */
  private operationSubject(
    msg: AnyMessage,
    required: readonly string[],
    task: string,
  ): string | undefined {
    const input =
      msg.kind === "invoke" ? msg.body.input : msg.kind === "deliver" ? msg.body.output : undefined;
    if (typeof input?.subject === "string") return input.subject;
    const items = Array.isArray(input?.items)
      ? input.items.filter((id): id is string => typeof id === "string")
      : [];
    const subjects = new Set(
      this.admittedClaims
        .filter(
          (claim) =>
            required.includes(claim.claimType) && items.includes(claim.id ?? digestOf(claim)),
        )
        .map((claim) => claim.subject)
        .filter((subject): subject is string => subject !== undefined),
    );
    for (const item of this.deps.memory.contexts[task] ?? []) {
      const fact = this.deps.memory.facts.get(item.id);
      if (
        items.includes(item.id) &&
        required.includes(item.claimType) &&
        item.accepted &&
        fact?.subject &&
        fact.digest === item.digest &&
        fact.statement &&
        fact.digest === digestOf(fact.statement)
      )
        subjects.add(fact.subject);
    }
    if (subjects.size > 1) return undefined;
    return (
      subjects.values().next().value ??
      (msg.kind === "deliver" ? this.deps.identity.party : msg.from.onBehalfOf)
    );
  }

  private coverageRefs(kinds: readonly string[]): NonNullable<TraceEventInput["refs"]> {
    return kinds.map((id) => ({
      id,
      layer: "reliance",
      suite: refsFor(this.deps.gate, ["reliance"]).refs?.[0]?.suite ?? "precedence-rules",
      clause: "CORE-IN-21",
    }));
  }

  /** Source: one event per relayed claim. */
  async source(msg: AnyMessage): Promise<void> {
    if (this.done.has("source")) return;
    this.done.add("source");
    if (this.deps.gate.reputation)
      await this.deps.gate.reputation.present(msg.evidence ?? [], this.deps.now(), (entry) =>
        this.deps.record(entry),
      );
    const federation = this.deps.gate.federation;
    if (
      federation &&
      ((msg.evidence ?? []).some((e) => e.format === "openid-entity-statement+jwt") ||
        msg.from.onBehalfOf === federation.policy.subject)
    ) {
      const result = await federation.present(msg.evidence ?? [], this.deps.now());
      const evaluation = {
        type: "federation-chain-check",
        outcome: result.ok ? "accepted" : "refused",
        path: result.path,
        reason: result.reason,
      };
      this.deps.record(evaluation);
      if (msg.from.onBehalfOf === federation.policy.subject) {
        this.gate.verdictEvent(
          "source",
          result.ok ? "pass" : result.reason === "lookup-failed" ? "indeterminate" : "fail",
          result.ok
            ? "The lender presents a current chain to the principal’s federation anchor, covering this mortgage."
            : "The lender’s presented federation chain does not establish its authority for this mortgage.",
          { reason: result.ok ? "source-accepted" : result.reason },
        );
        if (!result.ok)
          this.sourceFailure = {
            reason: result.reason!,
            detail:
              "The presented federation chain is missing, expired or outside its metadata policy.",
          };
      }
    }
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
        {
          task: "",
          taskId: msg.conversation,
          carriedBy: msg.from.onBehalfOf,
          messageEvidence: msg.evidence,
          purpose:
            typeof this.deps.agreementTerms(msg.conversation)?.purpose === "string"
              ? String(this.deps.agreementTerms(msg.conversation)?.purpose)
              : msg.kind === "invoke"
                ? msg.body.purpose
                : msg.kind === "deliver"
                  ? this.deps.requestPurpose?.(msg.body.ref)
                  : undefined,
        },
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
    if (
      !ok &&
      rep.reason === "representation-out-of-scope" &&
      !this.deps.gate.authorityChains &&
      !this.deps.gate.agentRegistry
    ) {
      this.gate.verdictEvent(
        "authority",
        "ask-more",
        "A current mandate credential covering this operation and its required role is needed.",
        { reason: rep.reason },
      );
      return rep;
    }
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
          fitnessOf(StatementQualityNode.from(r.claim), this.deps.gate.reliance, this.deps.now())
            .verdict === "pass" &&
          evaluateItemTerms(r.claim.terms as ItemTerms | undefined, {
            name: this.deps.gate.name,
            agent: this.deps.identity.actor,
            action: "use",
            target: r.claim.id ?? "",
            purpose: this.need(conv, msg).purpose,
            at: this.deps.now(),
          }).verdict === "pass" &&
          (!conv.challenge ||
            (() => {
              const approves = (r.claim as JsonObject).approves as JsonObject | undefined;
              const citation = approves?.challenge as JsonObject | undefined;
              return (
                msg.kind === "invoke" &&
                msg.body.challenge?.id === conv.challenge.id &&
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
  ): Promise<{ ok: true } | { ok: false; reason: ReasonCode; detail: string; askMore?: boolean }> {
    if (this.decided) return { ok: true };
    await this.source(msg);
    if (this.sourceFailure) {
      this.refuse(this.sourceFailure.reason, this.sourceFailure.detail);
      return { ok: false, ...this.sourceFailure };
    }
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
    const operation =
      msg.kind === "invoke" || msg.kind === "deliver" ? msg.body.operation.id : undefined;
    const required = [
      ...new Set(
        this.deps.gate.actionClaims
          ?.filter((rule) => rule.action === operation)
          .flatMap((rule) => rule.claims) ?? [],
      ),
    ];
    if (claims.length === 0 && required.length === 0) {
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
        const c = this.claimCache.get(item.value)?.claim;
        const reason = c && this.deps.memory.refusals[`statement:${c.id ?? digestOf(c)}`];
        if (termsOk.get(item.value) !== true && reason === "unsupported-term") {
          this.refuse(reason, "An attached term has no supported rule.");
          return { ok: false, reason, detail: "An attached term has no supported rule." };
        }
      }
      this.gate.setCorroborationPool(
        passed
          .filter((item) => termsOk.get(item.value) === true)
          .map((item) => this.claimCache.get(item.value)?.claim)
          .filter((claim): claim is Claim => !!claim),
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
        else {
          const claim = this.claimCache.get(item.value)?.claim ?? r?.claim;
          if (claim) admitted.push(claim);
        }
      }
      this.admittedClaims = admitted;
    }
    // Operation support remains admitted when claim coverage needs more evidence.
    // Other message paths keep their existing runtime admission boundary.
    const task = this.deps.gate.taskId ?? conv.id;
    const subject = this.operationSubject(msg, required, task);
    if (required.length > 0)
      for (const c of this.admittedClaims) {
        const fact = this.deps.memory.facts.get(c.id ?? digestOf(c));
        if (fact)
          this.deps.memory.enter(task, {
            ...fact,
            kind: "statement",
            accepted: true,
            digest: digestOf(c),
          });
      }
    for (const r of this.claimCache.values()) {
      if (!r.claim || this.admittedClaims.includes(r.claim)) continue;
      const reason = this.deps.memory.refusals[`statement:${r.claim.id ?? digestOf(r.claim)}`];
      let detail = reason && this.gate.requiredFailure(r.claim, reason, operation);
      if (detail) {
        // A failed kind keeps its CORE-IN-20 reason, while the same challenge also
        // names every other uncovered kind rather than concealing omissions.
        const missing = this.missingClaims(required, task, subject, need.purpose);
        const other = missing.filter((kind) => kind !== r.claim!.claimType);
        if (other.length) {
          detail += ` ${other.map((kind) => claimRequest(this.deps.gate, kind, undefined, "label")).join(" ")}`;
          this.gate.verdictEvent("fitness", "ask-more", detail, {
            reason,
            refs: this.coverageRefs(missing),
            rule: {
              id: "CORE-IN-21",
              text: "Name every uncovered kind, preserving a present statement's more specific failure.",
            },
          });
        }
        this.outcome = "ask-more";
        this.gate.decisionEvent("ask-more", detail, reason);
        return { ok: false, reason: reason as ReasonCode, detail, askMore: true };
      }
    }
    const conflict = this.gate.resolvePrecedence(need.purpose);
    if (conflict) {
      this.outcome = "ask-more";
      this.gate.decisionEvent("ask-more", conflict, "completeness-not-established");
      return { ok: false, reason: "completeness-not-established", detail: conflict, askMore: true };
    }
    this.admittedClaims = this.admittedClaims.filter((c) =>
      this.deps.memory.facts.has(c.id ?? digestOf(c)),
    );
    if (required.length > 0) {
      const missing = this.missingClaims(required, task, subject, need.purpose);
      const detail = missing
        .map((kind) => claimRequest(this.deps.gate, kind, undefined, "label"))
        .join(" ");
      this.gate.verdictEvent(
        "fitness",
        missing.length ? "ask-more" : "pass",
        missing.length
          ? detail
          : "Every kind of claim required by this operation is covered by admitted, fit evidence.",
        {
          reason: missing.length ? "evidence-missing" : "fit-for-use",
          rule: {
            id: "CORE-IN-21",
            text: "Each required claim kind must be covered for the same task and subject.",
          },
          refs: this.coverageRefs(missing),
        },
      );
      if (missing.length) {
        this.outcome = "ask-more";
        for (const c of this.admittedClaims) this.gate.storeEvent(c);
        this.gate.decisionEvent("ask-more", detail, "evidence-missing");
        return { ok: false, reason: "evidence-missing", detail, askMore: true };
      }
    }
    for (const item of this.claims(msg)) {
      const checked = this.claimCache.get(item.value);
      if (checked?.claim?.claimType !== "payment-receipt") continue;
      const id = checked.claim.id ?? digestOf(checked.claim);
      if (!this.admittedClaims.some((claim) => (claim.id ?? digestOf(claim)) === id)) {
        const reason = (this.deps.memory.refusals[`statement:${id}`] ??
          checked.reason ??
          "source-not-authoritative") as ReasonCode;
        this.refuse(
          reason,
          "A payment receipt must pass every ordinary statement admission check.",
        );
        return { ok: false, reason, detail: "The provider receipt failed ordinary admission." };
      }
    }
    if (
      this.deps.settlement &&
      this.deps.settlement.id !== "rdf-order" &&
      msg.kind === "invoke" &&
      msg.body.operation.id === "urn:op:payment"
    ) {
      try {
        const facts = this.deps.settlement.lift(readCarried(msg.body.input, this.deps.settlement));
        if (facts.payer !== msg.from.onBehalfOf) throw new Error("payer-mismatch");
      } catch {
        this.refuse("evidence-invalid", "The carried native payment order failed admission.");
        return {
          ok: false,
          reason: "evidence-invalid",
          detail: "The carried native payment order failed admission.",
        };
      }
    }
    if (this.deps.settlement && this.deps.settlement.id !== "rdf-order")
      for (const claim of this.admittedClaims.filter((c) => c.claimType === "invoice")) {
        try {
          this.deps.settlement.lift(readCarried(claim.payment, this.deps.settlement));
        } catch {
          this.refuse("evidence-invalid", "The carried protocol invoice failed admission.");
          return {
            ok: false,
            reason: "evidence-invalid",
            detail: "The carried protocol invoice failed admission.",
          };
        }
      }
    for (const claim of this.admittedClaims.filter((c) => c.claimType === "payment-receipt")) {
      let receipt: PaymentFacts | undefined;
      try {
        receipt =
          this.deps.settlement && this.deps.settlement.id !== "rdf-order"
            ? this.deps.settlement.lift(readCarried(claim.payment, this.deps.settlement))
            : liftPaymentObjects(await readPaymentObjects(claim.payment));
      } catch {
        if (this.deps.settlement && this.deps.settlement.id !== "rdf-order") {
          this.refuse("evidence-invalid", "The carried protocol receipt failed admission.");
          return {
            ok: false,
            reason: "evidence-invalid",
            detail: "The carried protocol receipt failed admission.",
          };
        }
        /* Fail closed below. */
      }
      const sent = receipt && this.deps.receiptOrder?.(receipt);
      const result =
        receipt && sent && receipt.provider === claim.issuer
          ? checkReceipt(receipt, sent.order, sent.provider)
          : undefined;
      const ok = result?.ok === true;
      this.deps.gate.sink?.emit({
        part: "inbound-gate",
        kind: "check",
        check: "receipt",
        verdict: ok ? "pass" : "fail",
        reason: ok ? "evidence-complete" : "receipt-mismatch",
        caption:
          result?.verdicts[0]?.fact ??
          "The provider receipt does not match a recorded payment order.",
        ...(receipt
          ? {
              settlement:
                this.deps.settlement?.trace && this.deps.settlement.id !== "rdf-order"
                  ? await this.deps.settlement.trace(
                      readCarried(claim.payment, this.deps.settlement),
                    )
                  : await paymentTrace(receipt),
            }
          : {}),
        ...checkRefs(this.deps.gate, "receipt"),
      });
      if (!ok) {
        this.refuse("receipt-mismatch", "The provider receipt differs from the recorded order.");
        return {
          ok: false,
          reason: "receipt-mismatch",
          detail: "The receipt does not match the order.",
        };
      }
      if (receipt) this.deps.recordReceipt?.(receipt, claim.payment);
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
    if (
      msg.kind === "propose" &&
      msg.body.terms.duties !== undefined &&
      !dutyRuleSchema.array().safeParse(msg.body.terms.duties).success
    ) {
      this.gate.verdictEvent(
        "terms",
        "indeterminate",
        "The proposed agreement contains unsupported duties.",
        { reason: "unsupported-term" },
      );
      return { verdict: "fail", reason: "unsupported-term" };
    }
    const offered = msg.kind === "invoke" ? msg.body.input.terms : undefined;
    if (offered !== undefined) {
      const evaluated = evaluateItemTerms(offered as unknown as ItemTerms, {
        name: this.deps.gate.name,
        agent: this.deps.identity.actor,
        action: "use",
        target: "",
        purpose: msg.kind === "invoke" ? msg.body.purpose : undefined,
        at: this.deps.now(),
      });
      const unsupported =
        evaluated.reason === "unsupported-term" || evaluated.reason === "indeterminate-policy";
      const acceptable =
        !unsupported &&
        (!this.deps.gate.termsAcceptance ||
          acceptsOfferedTerms(
            offered as unknown as ItemTerms,
            this.deps.gate.termsAcceptance.purposes,
          ));
      this.gate.verdictEvent(
        "terms",
        acceptable ? "pass" : unsupported ? "indeterminate" : "fail",
        acceptable
          ? "The principal accepts the uses in the request's terms."
          : "The request's terms allow uses the principal does not accept.",
        {
          reason: acceptable
            ? "terms-acceptable"
            : unsupported
              ? "unsupported-term"
              : "terms-not-acceptable",
        },
      );
      if (!acceptable)
        return {
          verdict: "fail",
          reason: unsupported ? "unsupported-term" : "terms-not-acceptable",
        };
      if (!hasClaims) return { verdict: "pass" };
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
