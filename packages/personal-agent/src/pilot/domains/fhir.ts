/**
 * Domain adapter: UC-04 patient-authorised summary over a LOCAL SYNTHETIC FHIR R4 service.
 *
 * What is modelled (and what is not): the flow follows the SMART App Launch *pattern* —
 * discovery of capabilities (incl. PKCE S256), a patient-approved scope SUBSET, an access
 * grant bound to the client key (proof of possession via the message signature), scope
 * enforcement at the resource server, revocation, and minimised audit. Issuance needs a clinic
 * enrollment binding of the authenticated patient to the compartment and a consent addressed to
 * this service, for this purpose, currently valid; revocation needs the revoking patient's own
 * issuer-signed grant; searchsets carry their grant as a send-time disclosure condition. It is
 * NOT an OAuth 2.0 / SMART implementation, no PKCE exchange happens, and no ONC Inferno test was
 * run. Resources are hand-authored Synthea-like fixtures for two wholly synthetic patients.
 */
import { z } from "zod";
import { digestOf, newUrn } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
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
import { signStatement, TYP, verifyStatement } from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import type { OperationDescription } from "../profile/description.js";
import { AWP, PURPOSE } from "../profile/vocabulary.js";
import type {
  AgreementPlan,
  DisclosureCheck,
  HandlerContext,
  HandlerReply,
  OperationHandler,
} from "../runtime/operations.js";

/**
 * 0.2 (phase 9): the grant names its patient principal, consent and purpose; issuance needs a
 * clinic enrollment binding and a consent addressed to THIS service; searchset deliveries carry
 * the grant as a disclosure condition re-checked at every transmission.
 */
export const AUTHZ_OP = { id: `${AWP}op/patient-authorisation`, version: "0.2" } as const;
export const FHIR_SEARCH_OP = { id: `${AWP}op/fhir-r4-search`, version: "0.2" } as const;
export const FHIR_WRITE_OP = { id: `${AWP}op/fhir-r4-write`, version: "0.1" } as const;
export const SCOPE_MODEL = { id: `${AWP}model/smart-like-scope-request`, version: "0.1" } as const;
export const FHIR_MODEL = { id: "http://hl7.org/fhir/R4", version: "4.0.1" } as const;
export const SUPPORTED_SCOPES = [
  "launch/patient",
  "patient/Patient.r",
  "patient/MedicationRequest.rs",
  "patient/AllergyIntolerance.rs",
  "patient/Observation.rs",
] as const;

export const patientAuthorisationSchema = z
  .object({
    type: z.literal("PatientAuthorisation"),
    id: z.string().max(512),
    patient: z.string().max(512),
    patientId: z.string().max(64),
    client: z.string().max(512),
    clientKid: z.string().max(128),
    audience: z.string().max(512),
    approvedScopes: z.array(z.string().max(64)).max(16),
    purpose: z.string().max(512),
    issuedAt: iso,
    validUntil: iso,
  })
  .strict();

export const accessGrantSchema = z
  .object({
    type: z.literal("AccessGrant"),
    id: z.string().max(512),
    issuer: z.string().max(512),
    audience: z.string().max(512),
    subject: z.string().max(512),
    cnf: z.object({ jkt: z.string().max(128) }).strict(),
    /** The patient PRINCIPAL whose enrollment bound `patientId` at issuance. */
    patient: z.string().max(512),
    patientId: z.string().max(64),
    /** The consent (PatientAuthorisation id) this grant is issued under. */
    consent: z.string().max(512),
    purpose: z.string().max(512),
    scopes: z.array(z.string().max(64)).max(16),
    issuedAt: iso,
    expiresAt: iso,
  })
  .strict();
export type AccessGrant = z.infer<typeof accessGrantSchema>;

/**
 * The patient revokes ONE grant. It carries the issuer-signed grant itself (`grantStatement`),
 * so every enforcing server can verify, without shared state, that the grant exists, was
 * issued by the pinned issuer, and belongs to the signing patient.
 */
export const revocationSchema = z
  .object({
    type: z.literal("GrantRevocation"),
    id: z.string().max(512),
    grant: z.string().max(512),
    grantStatement: z.string().max(16 * 1024),
    patient: z.string().max(512),
    issuedAt: iso,
  })
  .strict();

/**
 * CLINIC-controlled enrollment register: which authenticated patient principal (a party whose
 * key the clinic pinned at registration) owns which local patient compartment. Provisioned by
 * the clinic operator at the authorisation service's init; never taken from a request.
 */
export const enrollmentsFileSchema = z.strictObject({
  version: z.literal(1),
  clinic: z.string().max(512),
  enrollments: z
    .array(
      z.strictObject({
        principal: z.string().min(8).max(512),
        patientId: z.string().min(1).max(64),
        enrolledAt: iso,
      }),
    )
    .max(10_000),
  synthetic: z.literal(true),
});
export type EnrollmentsFile = z.infer<typeof enrollmentsFileSchema>;

/** Principal → compartment, refusing a register that binds one principal or compartment twice. */
export function enrollmentMap(file: EnrollmentsFile): ReadonlyMap<Iri, string> {
  const map = new Map<Iri, string>();
  const compartments = new Set<string>();
  for (const e of file.enrollments) {
    if (map.has(e.principal) || compartments.has(e.patientId))
      throw new Error(`enrollment register binds ${e.principal} / ${e.patientId} twice`);
    map.set(e.principal, e.patientId);
    compartments.add(e.patientId);
  }
  return map;
}

/** Longest consent validity window this service accepts. */
export const MAX_CONSENT_MS = 24 * 3_600_000;

const scopeRequest = z.strictObject({
  model: z.literal(SCOPE_MODEL.id),
  requestedScopes: z.array(z.string().max(64)).min(1).max(16),
  patientId: z.string().max(64),
  sessionMinutes: z.number().int().min(1).max(60),
  purpose: z.string().max(512),
  synthetic: z.literal(true),
});

/** One accepted revocation, with the verified ownership facts it was accepted on. */
export interface RevocationEntry {
  readonly grant: Iri;
  readonly patient: Iri;
  readonly patientId: string;
  readonly grantExpiresAt: string;
  readonly at: string;
}

/** Revocation state of ONE enforcing server (each server keeps and persists its own). */
export class RevocationList {
  readonly revoked = new Set<Iri>();
  readonly entries = new Map<Iri, RevocationEntry>();
  add(e: RevocationEntry): void {
    this.revoked.add(e.grant);
    this.entries.set(e.grant, e);
  }
}

/** Disclosure-condition kind: a searchset may leave only while its access grant holds. */
export const ACCESS_GRANT_CONDITION = `${AWP}condition/access-grant`;

/**
 * Send-time check for {@link ACCESS_GRANT_CONDITION}: the grant is neither revoked (this
 * server's persisted list) nor expired. Pure: reads state, creates no effect.
 */
export function accessGrantCheck(revocations: RevocationList): DisclosureCheck {
  return (ref, at) => {
    const grant = typeof ref.grant === "string" ? ref.grant : "";
    const expires = Date.parse(String(ref.expiresAt ?? ""));
    if (!grant || Number.isNaN(expires))
      return { ok: false, reason: "malformed access-grant reference" };
    if (revocations.revoked.has(grant)) return { ok: false, reason: `grant ${grant} was revoked` };
    if (expires <= Date.parse(at))
      return { ok: false, reason: `grant ${grant} expired at ${String(ref.expiresAt)}` };
    return { ok: true };
  };
}

// ------------------------------------------------------------------ authorisation server

export class AuthorisationServerHandler implements OperationHandler {
  readonly description: OperationDescription = {
    id: AUTHZ_OP.id,
    version: AUTHZ_OP.version,
    label: "Patient-approved, client-bound access grant (SMART-like pattern, synthetic)",
    pattern: "negotiate",
    access: "represented",
    roles: ["responder"],
    models: [SCOPE_MODEL],
    purposes: [PURPOSE.personalHealthSummary],
    effects: ["issues an access grant bound to the client key"],
    outcomes: ["granted scopes ⊆ requested ∩ patient-approved ∩ supported"],
    limitations: ["not OAuth 2.0 / SMART conformant", "no PKCE exchange is performed"],
  };
  readonly termsSchema = scopeRequest as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  constructor(
    private readonly cfg: {
      /** This service's own receiving identifier (a consent must name it as its audience). */
      self: Iri;
      issuer: Iri;
      issuerKey: SigningKey;
      resourceServer: Iri;
      revocations: RevocationList;
      /** Clinic enrollment register: patient principal → patient compartment. */
      enrollments: ReadonlyMap<Iri, string>;
      codeChallengeMethods?: readonly string[];
    },
  ) {}

  describeFor(): JsonObject {
    return {
      smartLikeConfiguration: {
        issuer: this.cfg.issuer,
        resourceServer: this.cfg.resourceServer,
        capabilities: ["launch-standalone", "context-standalone-patient", "permission-v2"],
        code_challenge_methods_supported: [...(this.cfg.codeChallengeMethods ?? ["S256"])],
        scopes_supported: [...SUPPORTED_SCOPES],
        revocation_supported: true,
        note: "advertised support only; not a grant",
      },
    };
  }

  /**
   * Issuance. A real patient signature establishes WHO consented — not entitlement. The grant is
   * issued only if ALL hold: the consent verifies against the pinned patient key and is signed
   * by the patient it names; the requester is that patient's agent (client, key); the consent
   * names THIS service as audience and the requested purpose; it is currently valid (not future,
   * not expired, a bounded window); and the clinic's enrollment register binds that principal to
   * the requested compartment. The grant expires at the EARLIEST of session end and consent end.
   */
  async onProposal(ctx: HandlerContext, body: ProposeBody): Promise<HandlerReply> {
    const t = scopeRequest.parse(body.terms);
    const deny = (
      reason: "not-authorised" | "purpose-not-permitted" | "grant-expired" | "not-yet-valid",
      detail: string,
      consent?: string,
    ): HandlerReply => {
      ctx.record({
        type: "consent-decision",
        outcome: "refused",
        reason,
        detail,
        ...(consent ? { consent } : {}),
        requester: ctx.peer.actor ?? "unknown",
        requestedPatientId: t.patientId,
      });
      return { type: "refuse", reason, detail };
    };
    const item = (ctx.message?.evidence ?? []).find((e) => e.role === "authorisation");
    if (!item) return deny("not-authorised", "no patient authorisation presented");
    const check = await ctx.verify(item.value, {
      typ: TYP.statement,
      role: "party",
      schema: patientAuthorisationSchema,
    });
    const pa = check.payload;
    if (!pa || check.verification.outcome !== "valid" || check.signer?.subject !== pa.patient)
      return deny("not-authorised", "patient authorisation not verified");
    if (
      pa.patient !== ctx.peer.party ||
      pa.client !== ctx.peer.actor ||
      pa.clientKid !== ctx.signerKid
    )
      return deny("not-authorised", "authorisation is for a different patient/client/key", pa.id);
    if (pa.audience !== this.cfg.self)
      return deny("not-authorised", "the consent names another authorisation service", pa.id);
    if (pa.purpose !== t.purpose || !(this.description.purposes ?? []).includes(t.purpose))
      return deny(
        "purpose-not-permitted",
        "purpose differs from the consent or is not offered",
        pa.id,
      );
    const issued = Date.parse(pa.issuedAt);
    const until = Date.parse(pa.validUntil);
    const nowMs = Date.parse(ctx.now);
    if (!(until > issued) || until - issued > MAX_CONSENT_MS)
      return deny("not-authorised", "consent validity window is malformed or too long", pa.id);
    if (issued > nowMs + DEFAULT_LIMITS.maxClockSkewMs)
      return deny("not-yet-valid", "consent is issued in the future", pa.id);
    if (until <= nowMs) return deny("grant-expired", "patient authorisation expired", pa.id);
    // Clinic-controlled binding: the AUTHENTICATED principal must own the compartment.
    const enrolled = this.cfg.enrollments.get(pa.patient);
    if (!enrolled)
      return deny("not-authorised", "the patient principal is not enrolled at this clinic", pa.id);
    if (enrolled !== pa.patientId || enrolled !== t.patientId)
      return deny(
        "not-authorised",
        "the requested compartment is not the enrolled compartment of this patient",
        pa.id,
      );
    const granted = t.requestedScopes.filter(
      (s) => pa.approvedScopes.includes(s) && (SUPPORTED_SCOPES as readonly string[]).includes(s),
    );
    const expiresAt = new Date(Math.min(nowMs + t.sessionMinutes * 60_000, until)).toISOString();
    ctx.record({
      type: "scope-decision",
      consent: pa.id,
      patient: pa.patient,
      patientId: enrolled,
      enrollment: "clinic register (principal → compartment)",
      audience: pa.audience,
      purpose: t.purpose,
      requested: t.requestedScopes,
      approvedByPatient: pa.approvedScopes,
      granted,
      consentValidUntil: pa.validUntil,
      grantExpiresAt: expiresAt,
      note: "requested, approved and granted scopes are recorded separately",
    });
    if (!granted.some((s) => s.startsWith("patient/")))
      return { type: "refuse", reason: "insufficient-scope", detail: "no data scope approved" };
    const grant: AccessGrant = {
      type: "AccessGrant",
      id: newUrn(),
      issuer: this.cfg.issuer,
      audience: this.cfg.resourceServer,
      subject: pa.client,
      cnf: { jkt: pa.clientKid },
      patient: pa.patient,
      patientId: enrolled,
      consent: pa.id,
      purpose: t.purpose,
      scopes: granted,
      issuedAt: ctx.now,
      expiresAt,
    };
    // Minted here, released only if the executor permits the accept.
    const jws = await signStatement(this.cfg.issuerKey, TYP.statement, grant);
    return {
      type: "accept",
      selection: {
        grantedScopes: granted,
        grantId: grant.id,
        expiresAt: grant.expiresAt,
        grant: jws,
      },
      intent: {
        operation: AUTHZ_OP.id,
        action: "use",
        target: AUTHZ_OP.id,
        purpose: t.purpose,
        ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
        parameters: { termsDigest: body.termsDigest, granted },
        conversation: ctx.conversation.id,
      },
    };
  }

  onAgreement(): AgreementPlan {
    return { requiredOutcomes: [] };
  }

  /** The patient's own revocation (a portal action; verified against the pinned patient key). */
  revoke(
    input: RevocationInput,
    revocationJws: string,
  ): Promise<{ revoked: boolean; reason?: string }> {
    return applyGrantRevocation(input, revocationJws, this.cfg.revocations);
  }
}

export interface RevocationInput {
  readonly trust: TrustStore;
  readonly at: string;
  readonly verifier: Iri;
  /** The pinned access-grant issuer (the only issuer whose grants this server enforces). */
  readonly issuer: Iri;
  readonly record: <T extends { type: string }>(r: T) => void;
}

/**
 * Accept a patient's signed GrantRevocation only with AUTHORITATIVE grant ownership:
 *  1. the revocation verifies against the PINNED party key of the patient it names;
 *  2. the grant it carries verifies against the PINNED issuer key and was issued by `issuer`;
 *  3. that grant is the one named, and its `patient` principal is the signing patient.
 * Anything else — an unknown, arbitrary or another patient's grant — is refused and recorded.
 * Shared by every server that enforces the grant; each keeps its own persisted list.
 */
export async function applyGrantRevocation(
  input: RevocationInput,
  revocationJws: string,
  revocations: RevocationList,
): Promise<{ revoked: boolean; reason?: string }> {
  const refuse = (reason: string, grant?: string) => {
    input.record({ type: "revocation-refused", reason, ...(grant ? { grant } : {}) });
    return { revoked: false, reason };
  };
  const check = await verifyStatement(revocationJws, {
    trust: input.trust,
    typ: TYP.statement,
    role: "party",
    schema: revocationSchema,
    limits: DEFAULT_LIMITS,
    verifier: input.verifier,
    at: input.at,
  });
  input.record(check.verification);
  const rev = check.payload;
  if (!rev || check.verification.outcome !== "valid" || check.signer?.subject !== rev.patient)
    return refuse("revocation not verified against the pinned key of the patient it names");
  const grantCheck = await verifyStatement(rev.grantStatement, {
    trust: input.trust,
    typ: TYP.statement,
    role: "issuer",
    schema: accessGrantSchema,
    limits: DEFAULT_LIMITS,
    verifier: input.verifier,
    at: input.at,
  });
  const g = grantCheck.payload;
  if (
    !g ||
    grantCheck.verification.outcome !== "valid" ||
    grantCheck.signer?.subject !== input.issuer ||
    g.issuer !== input.issuer
  )
    return refuse("the carried grant is not a grant of the pinned issuer", rev.grant);
  if (g.id !== rev.grant) return refuse("the carried grant is not the grant named", rev.grant);
  if (g.patient !== rev.patient)
    return refuse("the grant belongs to another patient principal", rev.grant);
  revocations.add({
    grant: g.id,
    patient: g.patient,
    patientId: g.patientId,
    grantExpiresAt: g.expiresAt,
    at: input.at,
  });
  input.record({ type: "grant-revoked", grant: g.id, by: rev.patient, patientId: g.patientId });
  return { revoked: true };
}

// ------------------------------------------------------------------ resource server

export class ResourceServerHandler implements OperationHandler {
  readonly description: OperationDescription = {
    id: FHIR_SEARCH_OP.id,
    version: FHIR_SEARCH_OP.version,
    label: "FHIR R4 patient-compartment search (read-only, synthetic data)",
    pattern: "invoke",
    access: "represented",
    roles: ["responder"],
    models: [FHIR_MODEL],
    purposes: [PURPOSE.personalHealthSummary],
    effects: ["none (read-only)"],
    outcomes: ["searchset Bundle | insufficient-scope | grant-revoked | grant-expired"],
    limitations: ["no write capability is offered"],
  };
  readonly inputSchema = z.strictObject({
    resourceType: z.enum(["Patient", "MedicationRequest", "AllergyIntolerance", "Observation"]),
    patientId: z.string().max(64),
  }) as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = false;

  constructor(
    private readonly cfg: {
      self: Iri;
      issuer: Iri;
      revocations: RevocationList;
      resources: readonly JsonObject[];
    },
  ) {}

  async onInvoke(
    ctx: HandlerContext,
    body: InvokeBody,
    evidence: readonly EvidenceItem[],
  ): Promise<HandlerReply> {
    const input = body.input as { resourceType: string; patientId: string };
    const deny = (
      reason: "grant-invalid" | "grant-expired" | "grant-revoked" | "insufficient-scope",
      detail: string,
    ): HandlerReply => {
      ctx.record({
        type: "audit-denial",
        client: ctx.message?.from.actor ?? "unknown",
        resourceType: input.resourceType,
        reason,
      });
      return { type: "refuse", reason, detail };
    };
    const item = evidence.find((e) => e.role === "grant");
    if (!item) return deny("grant-invalid", "no access grant presented");
    const check = await ctx.verify(item.value, {
      typ: TYP.statement,
      role: "issuer",
      schema: accessGrantSchema,
    });
    const g = check.payload;
    if (
      !g ||
      check.verification.outcome !== "valid" ||
      check.signer?.subject !== this.cfg.issuer ||
      g.issuer !== this.cfg.issuer
    ) {
      return deny("grant-invalid", "grant not issued by the pinned authorisation server");
    }
    if (g.audience !== this.cfg.self)
      return deny("grant-invalid", "grant audience is another server");
    if (g.subject !== ctx.message?.from.actor || g.cnf.jkt !== ctx.signerKid)
      return deny("grant-invalid", "grant is bound to a different client key");
    if (Date.parse(g.expiresAt) <= Date.parse(ctx.now))
      return deny("grant-expired", "grant expired");
    if (this.cfg.revocations.revoked.has(g.id))
      return deny("grant-revoked", "grant revoked by the patient");
    const needed =
      input.resourceType === "Patient" ? "patient/Patient.r" : `patient/${input.resourceType}.rs`;
    if (!g.scopes.includes(needed)) return deny("insufficient-scope", `${needed} not granted`);
    if (g.patientId !== input.patientId)
      return deny("insufficient-scope", "outside the patient compartment");
    const entries = this.cfg.resources.filter(
      (r) =>
        r.resourceType === input.resourceType &&
        (r.resourceType === "Patient"
          ? r.id === input.patientId
          : (r.subject as { reference?: string })?.reference === `Patient/${input.patientId}`),
    );
    ctx.record({
      type: "audit-access",
      client: g.subject,
      grant: g.id,
      resourceType: input.resourceType,
      count: entries.length,
      ids: entries.map((e) => `${e.resourceType}/${e.id}`),
      note: "minimised: no clinical payload",
    });
    return {
      type: "deliver",
      output: {
        resourceType: "Bundle",
        type: "searchset",
        total: entries.length,
        entry: entries.map((resource) => ({ resource })),
      },
      // PROTECTED payload: it may leave only while this grant still holds (re-checked at every
      // transmission, also after a restart). Refusals and descriptions carry no condition.
      conditions: [
        {
          kind: ACCESS_GRANT_CONDITION,
          ref: {
            grant: g.id,
            issuer: g.issuer,
            patient: g.patient,
            patientId: g.patientId,
            expiresAt: g.expiresAt,
          },
        },
      ],
    };
  }
}

// ------------------------------------------------------------------ CareBrief client

const coding = z
  .object({ system: z.string(), code: z.string(), display: z.string().optional() })
  .passthrough();
const cc = z.object({ coding: z.array(coding).min(1) }).passthrough();
const meta = z.object({ versionId: z.string(), source: z.string() }).passthrough();
const ACCEPTED_SYSTEMS = new Set([
  "http://www.nlm.nih.gov/research/umls/rxnorm",
  "http://snomed.info/sct",
  "http://loinc.org",
]);
const profiles = {
  MedicationRequest: z
    .object({
      resourceType: z.literal("MedicationRequest"),
      id: z.string(),
      meta,
      status: z.enum([
        "active",
        "on-hold",
        "cancelled",
        "completed",
        "entered-in-error",
        "stopped",
        "draft",
        "unknown",
      ]),
      intent: z.string(),
      medicationCodeableConcept: cc,
      subject: z.object({ reference: z.string() }),
    })
    .passthrough(),
  AllergyIntolerance: z
    .object({
      resourceType: z.literal("AllergyIntolerance"),
      id: z.string(),
      meta,
      clinicalStatus: cc,
      verificationStatus: cc,
      code: cc,
      patient: z.object({ reference: z.string() }).optional(),
      subject: z.object({ reference: z.string() }).optional(),
    })
    .passthrough(),
  Observation: z
    .object({
      resourceType: z.literal("Observation"),
      id: z.string(),
      meta,
      status: z.string(),
      code: cc,
      effectiveDateTime: z.string(),
      subject: z.object({ reference: z.string() }),
    })
    .passthrough(),
  Patient: z.object({ resourceType: z.literal("Patient"), id: z.string(), meta }).passthrough(),
} as const;

export interface SummaryStatement {
  readonly text: string;
  readonly status: "recorded" | "unresolved" | "warning";
  readonly cites: readonly string[];
}

export class CareBriefHandler implements OperationHandler {
  readonly description: OperationDescription;
  readonly requiresRepresentation = false;
  readonly resources: JsonObject[] = [];
  readonly validation: Array<{
    resource: string;
    profile: string;
    valid: boolean;
    issues: string[];
  }> = [];
  private grant?: { jws: string; id: Iri; scopes: string[] };

  constructor(
    private readonly op: typeof AUTHZ_OP | typeof FHIR_SEARCH_OP | typeof FHIR_WRITE_OP,
    private readonly cfg: { cvParty: Iri },
  ) {
    this.description = {
      id: op.id,
      version: op.version,
      label: "CareBrief client",
      pattern: op === AUTHZ_OP ? "negotiate" : "invoke",
      access: "represented",
      roles: ["initiator"],
      models: op === AUTHZ_OP ? [SCOPE_MODEL] : [FHIR_MODEL],
      effects: [],
      outcomes: [],
    };
  }

  vetDescription(
    _ctx: HandlerContext,
    description: JsonObject,
  ): { reason: "unsupported-term"; detail: string } | undefined {
    if (this.op !== AUTHZ_OP) return undefined;
    const cfg = (description.extensions as JsonObject | undefined)?.smartLikeConfiguration as
      | JsonObject
      | undefined;
    if (!cfg)
      return { reason: "unsupported-term", detail: "no SMART-like configuration advertised" };
    const methods = cfg.code_challenge_methods_supported;
    if (!Array.isArray(methods) || !methods.includes("S256"))
      return {
        reason: "unsupported-term",
        detail: "PKCE S256 not advertised; authorisation stopped",
      };
    return undefined;
  }

  intentForProposal(ctx: HandlerContext, terms: JsonObject): ActionIntent {
    return {
      operation: AUTHZ_OP.id,
      action: "use",
      target: AUTHZ_OP.id,
      purpose: PURPOSE.personalHealthSummary,
      recipient: this.cfg.cvParty,
      parameters: { termsDigest: digestOf(terms) },
      conversation: ctx.conversation.id,
    };
  }

  intentForInvoke(ctx: HandlerContext, input: JsonObject): ActionIntent {
    return {
      operation: this.op.id,
      action: this.op === FHIR_WRITE_OP ? "modify" : "read",
      target: this.op.id,
      purpose: PURPOSE.personalHealthSummary,
      recipient: this.cfg.cvParty,
      parameters: { resourceType: String(input.resourceType) },
      conversation: ctx.conversation.id,
    };
  }

  onAgreement(ctx: HandlerContext, agreement: Agreement): AgreementPlan {
    const sel = agreement.selection as
      | { grant?: string; grantId?: string; grantedScopes?: string[] }
      | undefined;
    if (sel?.grant && sel.grantId)
      this.grant = { jws: sel.grant, id: sel.grantId, scopes: sel.grantedScopes ?? [] };
    ctx.record({
      type: "grant-received",
      grant: sel?.grantId ?? "none",
      scopes: sel?.grantedScopes ?? [],
    });
    return { requiredOutcomes: [] };
  }

  /** Working state (grant, validated resources, validation log) for durable roles. */
  exportState(): JsonObject {
    return {
      ...(this.grant ? { grant: this.grant as unknown as JsonObject } : {}),
      resources: [...this.resources],
      validation: this.validation as unknown as JsonObject[],
    };
  }

  importState(state: JsonObject): void {
    const s = state as {
      grant?: { jws: string; id: Iri; scopes: string[] };
      resources?: JsonObject[];
      validation?: CareBriefHandler["validation"];
    };
    this.grant = s.grant;
    this.resources.splice(0, this.resources.length, ...(s.resources ?? []));
    this.validation.splice(0, this.validation.length, ...(s.validation ?? []));
  }

  grantEvidence(): EvidenceItem[] {
    return this.grant ? [{ role: "grant", format: "jws-compact", value: this.grant.jws }] : [];
  }

  get grantInfo() {
    return this.grant;
  }

  onDeliver(ctx: HandlerContext, body: DeliverBody): HandlerReply {
    const entries = (
      (body.output as { entry?: Array<{ resource: JsonObject }> }).entry ?? []
    ).slice(0, 200);
    for (const { resource } of entries) {
      const type = String(resource.resourceType) as keyof typeof profiles;
      const schema = profiles[type];
      const issues: string[] = [];
      if (!schema) issues.push("unsupported resource type");
      else {
        const r = schema.safeParse(resource);
        if (!r.success)
          issues.push(
            ...r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
          );
      }
      const codes = JSON.stringify(resource).match(/"system":"([^"]+)"/g) ?? [];
      for (const c of codes) {
        const system = c.slice(10, -1);
        if (!ACCEPTED_SYSTEMS.has(system) && !system.startsWith("http://terminology.hl7.org/"))
          issues.push(`unknown code system ${system}`);
      }
      const valid = issues.filter((i) => !i.startsWith("unknown code system")).length === 0;
      this.validation.push({
        resource: `${type}/${String(resource.id)}`,
        profile: `${AWP}model/us-core-subset/0.1`,
        valid,
        issues,
      });
      if (valid) this.resources.push(resource);
    }
    ctx.record({
      type: "resources-received",
      count: entries.length,
      note: "payloads held by the client only",
    });
    return { type: "none" };
  }

  /** Cited summary: every statement names resource type/id/version and source. */
  summary(now: string): SummaryStatement[] {
    const cite = (r: JsonObject) =>
      `${String(r.resourceType)}/${String(r.id)}/_history/${String((r.meta as JsonObject).versionId)} @ ${String((r.meta as JsonObject).source)}`;
    const out: SummaryStatement[] = [];
    const meds = this.resources.filter((r) => r.resourceType === "MedicationRequest");
    const byCode = new Map<string, JsonObject[]>();
    for (const m of meds) {
      const code = String(
        ((m.medicationCodeableConcept as JsonObject).coding as JsonObject[])[0]?.code,
      );
      byCode.set(code, [...(byCode.get(code) ?? []), m]);
    }
    for (const [, group] of byCode) {
      const statuses = new Set(group.map((m) => String(m.status)));
      const name = String(
        (
          ((group[0] as JsonObject).medicationCodeableConcept as JsonObject).coding as JsonObject[]
        )[0]?.display,
      );
      if (statuses.size > 1 && statuses.has("active"))
        out.push({
          text: `${name}: conflicting records (${[...statuses].join(" vs ")}); left for a clinician`,
          status: "unresolved",
          cites: group.map(cite),
        });
      else if (statuses.has("active"))
        out.push({
          text: `${name}: recorded as active`,
          status: "recorded",
          cites: group.map(cite),
        });
    }
    for (const a of this.resources.filter((r) => r.resourceType === "AllergyIntolerance")) {
      const coding0 = ((a.code as JsonObject).coding as JsonObject[])[0] as JsonObject;
      const known = ACCEPTED_SYSTEMS.has(String(coding0.system));
      out.push({
        text: `Allergy: ${String(coding0.display)}${known ? "" : " (unrecognised code system)"}`,
        status: known ? "recorded" : "warning",
        cites: [cite(a)],
      });
    }
    const recent = this.resources.filter(
      (r) =>
        r.resourceType === "Observation" &&
        Date.parse(String(r.effectiveDateTime)) >= Date.parse(now) - 365 * 86_400_000,
    );
    for (const o of recent)
      out.push({
        text: `Observation ${String((((o.code as JsonObject).coding as JsonObject[])[0] as JsonObject).display)}: ${JSON.stringify(o.valueQuantity ?? {})}`,
        status: "recorded",
        cites: [cite(o)],
      });
    return out;
  }
}

// ------------------------------------------------------------------ synthetic fixtures

const SOURCE = "https://cedarvalley.example/fhir";
const m = (versionId: string) => ({
  versionId,
  source: SOURCE,
  tag: [{ system: "https://example.org/awp-fixture", code: "synthetic" }],
});

export function syntheticResources(patientId: string): JsonObject[] {
  const subject = { reference: `Patient/${patientId}` };
  const rx = (code: string, display: string) => ({
    coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code, display }],
  });
  const status = (code: string, system: string) => ({ coding: [{ system, code }] });
  return [
    {
      resourceType: "Patient",
      id: patientId,
      meta: m("3"),
      name: [{ family: "Chen", given: ["Maya"] }],
      birthDate: "1980-01-01",
    },
    {
      resourceType: "MedicationRequest",
      id: "mr-1",
      meta: m("1"),
      status: "active",
      intent: "order",
      medicationCodeableConcept: rx("314076", "lisinopril 10 MG Oral Tablet"),
      subject,
    },
    {
      resourceType: "MedicationRequest",
      id: "mr-2",
      meta: m("2"),
      status: "stopped",
      intent: "order",
      medicationCodeableConcept: rx("617318", "atorvastatin 20 MG Oral Tablet"),
      subject,
    },
    {
      resourceType: "MedicationRequest",
      id: "mr-3",
      meta: m("1"),
      status: "active",
      intent: "order",
      medicationCodeableConcept: rx("617318", "atorvastatin 20 MG Oral Tablet"),
      subject,
    },
    {
      resourceType: "MedicationRequest",
      id: "mr-4",
      meta: m("1"),
      status: "active",
      intent: "order",
      subject,
    },
    {
      resourceType: "AllergyIntolerance",
      id: "ai-1",
      meta: m("1"),
      clinicalStatus: status(
        "active",
        "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
      ),
      verificationStatus: status(
        "confirmed",
        "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
      ),
      code: {
        coding: [
          { system: "http://snomed.info/sct", code: "91936005", display: "Allergy to penicillin" },
        ],
      },
      patient: subject,
    },
    {
      resourceType: "AllergyIntolerance",
      id: "ai-2",
      meta: m("1"),
      clinicalStatus: status(
        "active",
        "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
      ),
      verificationStatus: status(
        "unconfirmed",
        "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
      ),
      code: {
        coding: [
          { system: "http://example.org/local-codes", code: "X12", display: "Local allergen X12" },
        ],
      },
      patient: subject,
    },
    {
      resourceType: "Observation",
      id: "obs-1",
      meta: m("1"),
      status: "final",
      code: {
        coding: [
          { system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" },
        ],
      },
      effectiveDateTime: "2026-08-01T10:00:00Z",
      valueQuantity: { value: 128, unit: "mm[Hg]" },
      subject,
    },
  ].map((r) =>
    r.resourceType === "AllergyIntolerance" ? { ...r, subject } : r,
  ) as unknown as JsonObject[];
}

/**
 * A SECOND wholly synthetic patient (distinct resource ids and content), used to show that one
 * patient's consent never reaches another patient's compartment.
 */
export function syntheticSecondPatientResources(patientId: string): JsonObject[] {
  const subject = { reference: `Patient/${patientId}` };
  return [
    {
      resourceType: "Patient",
      id: patientId,
      meta: m("1"),
      name: [{ family: "Okafor", given: ["Noah"] }],
      birthDate: "1975-05-05",
    },
    {
      resourceType: "MedicationRequest",
      id: `${patientId}-mr-1`,
      meta: m("1"),
      status: "active",
      intent: "order",
      medicationCodeableConcept: {
        coding: [
          {
            system: "http://www.nlm.nih.gov/research/umls/rxnorm",
            code: "861007",
            display: "metformin hydrochloride 500 MG Oral Tablet",
          },
        ],
      },
      subject,
    },
  ] as unknown as JsonObject[];
}
