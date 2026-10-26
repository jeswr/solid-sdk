/**
 * SYNTHETIC US health-summary flow (UC-04) as durable, independently initialised agents that
 * compose the EXISTING domain handlers (`domains/fhir.ts`):
 *
 *  - `health-patient` (the patient's agent): requests a scoped, client-bound access grant with a
 *    PatientAuthorisation that the patient (owner) signs OUTSIDE the service
 *    (`awp-pilot owner-sign --kind patient-authorisation`), reads FHIR resources under the
 *    grant, validates them, and produces a minimised summary citing resource id/version/source
 *    with contradictions left unresolved. Its mandate allows authorisation requests and READS
 *    only — no write entitlement, and no write operation exists anywhere.
 *  - `health-authorization`: issues only for a consent addressed to IT, for the requested
 *    purpose, currently valid, whose authenticated patient the CLINIC's enrollment register
 *    (`patient-enrollments.json`, provisioned at init) binds to the requested compartment; scopes
 *    = requested ∩ patient-approved ∩ supported; the grant ends no later than the consent. It is
 *    signed with its OWN token-issuer key — separate from the organisation's owner key and from
 *    the service's actor key; the resource server pins that key's public card at ITS
 *    provisioning.
 *  - `health-resource`: enforces grant issuer, audience, client binding (key thumbprint), expiry,
 *    revocation, scope and patient compartment; each searchset carries its grant as a disclosure
 *    condition re-checked at transmission; audit records are minimised (no clinical payload).
 * Revocation: the patient signs a GrantRevocation carrying the issuer-signed grant (owner key,
 * outside the service); each server that enforces the grant accepts it through an operator
 * operation only if it verifies against the PINNED patient key AND the grant is the pinned
 * issuer's and belongs to that patient; it is persisted with those facts (no revocation
 * propagation protocol is claimed).
 *
 * Synthetic data only. This is a SMART-like pattern, not SMART-on-FHIR/OAuth 2.0
 * interoperability, not HIPAA or clinical compliance, and not clinical advice.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { newUrn } from "../core/canonical.js";
import type { Iri, JsonObject, Json as JsonValue } from "../core/types.js";
import {
  ACCESS_GRANT_CONDITION,
  AUTHZ_OP,
  AuthorisationServerHandler,
  accessGrantCheck,
  applyGrantRevocation,
  CareBriefHandler,
  enrollmentMap,
  enrollmentsFileSchema,
  FHIR_MODEL,
  FHIR_SEARCH_OP,
  patientAuthorisationSchema,
  ResourceServerHandler,
  type RevocationEntry,
  RevocationList,
  revocationSchema,
  SCOPE_MODEL,
  SUPPORTED_SCOPES,
} from "../domains/fhir.js";
import {
  authorisationServerMandate,
  CV_AUTH,
  CV_FHIR,
  PATIENT_ID,
  patientAgentMandate,
  resourceServerMandate,
  TOKEN_ISSUER,
} from "../fixtures/health.js";
import { TrustStore } from "../mechanisms/trust.js";
import { CONFIG_ED25519 } from "../profile/configurations.js";
import { PURPOSE } from "../profile/vocabulary.js";
import { NOT_SENT_NOTICE, summariseStep } from "../service.js";
import { pinIssuersFromFiles, readJson, writeAtomic } from "./common.js";
import { durableHandler, scopedStateKey } from "./durable.js";
import type { Json, OperationContext, OperatorOperation, RoleDefinition } from "./types.js";

export const REVOCATIONS_FILE = "revocations.json";
export const RESOURCES_FILE = "fhir-resources.json";
export const SUMMARIES_FILE = "health-summaries.json";
export const ENROLLMENTS_FILE = "patient-enrollments.json";
export const PATIENT_FILE = "health-patient.json";
const patientFile = z.strictObject({
  version: z.literal(1),
  patientId: z.string().min(1).max(64),
});
const CAREBRIEF_STATE = "carebrief";
const JWS = z
  .string()
  .min(16)
  .max(16 * 1024);

// ------------------------------------------------------------------ shared: revocation list

/**
 * Version 2 (phase 9) persists the verified ownership facts of each revocation. A version-1
 * file (grant ids only) is still honoured — a revocation can only restrict.
 */
interface RevocationsFile {
  version: 1 | 2;
  revoked: (RevocationEntry | { grant: Iri; at: string })[];
}
function loadRevocations(dir: string): RevocationList {
  const list = new RevocationList();
  for (const r of readJson<RevocationsFile>(join(dir, REVOCATIONS_FILE), {
    version: 2,
    revoked: [],
  }).revoked) {
    if ("patient" in r) list.add(r);
    else list.revoked.add(r.grant);
  }
  return list;
}

/**
 * Operator operation: accept ONE patient-signed GrantRevocation. Accepting it confers nothing:
 * the runtime-independent check in `applyGrantRevocation` requires the issuer-signed grant it
 * carries to belong to the signing patient. Persisted before it is reported.
 */
function acceptRevocation(dir: string, actor: Iri, list: RevocationList) {
  return (op: OperationContext): OperatorOperation => ({
    name: "accept_revocation",
    title: "Accept a patient-signed grant revocation",
    description:
      "Verify ONE GrantRevocation: signed by the patient's (owner) key (checked against the PINNED patient key), " +
      "carrying the grant signed by the PINNED token issuer, and that grant belongs to that patient. If so, persist " +
      "it: the grant is refused — and queued disclosures under it are withheld — from now on, also after a restart.",
    input: { revocation: JWS },
    async run(raw) {
      const { revocation } = raw as { revocation: string };
      const at = op.now().toISOString();
      const result = await applyGrantRevocation(
        {
          trust: await TrustStore.load(op.trust),
          at,
          verifier: actor,
          issuer: TOKEN_ISSUER,
          record: (r) => op.rt.recordObservation({ ...r, observedBy: actor }),
        },
        revocation,
        list,
      );
      if (result.revoked)
        writeAtomic(join(dir, REVOCATIONS_FILE), {
          version: 2,
          revoked: [...list.entries.values()],
        } satisfies RevocationsFile);
      return { ...result, revokedGrants: [...list.revoked] };
    },
  });
}

// ------------------------------------------------------------------ patient agent

const scopeEnum = z.enum(SUPPORTED_SCOPES);

export const HEALTH_PATIENT_ROLE: RoleDefinition = {
  id: "health-patient",
  label:
    "Synthetic patient agent (CareBrief) — scoped read grant, validation, cited minimised summary",
  synthetic: true,
  // Identity given at init (--party = the patient principal, --actor = this agent): one agent
  // per patient (fixtures: CAREBRIEF for Maya, CAREBRIEF_NOAH for Noah).
  mandate: patientAgentMandate,
  representationOperations: [AUTHZ_OP.id, FHIR_SEARCH_OP.id],
  ownerStatements: {
    "patient-authorisation": {
      description:
        "The patient approves a scope SUBSET for THIS client key and ONE authorisation server (valid ≤ 60 min).",
      args: {
        audience: z.string().min(8).max(512),
        approvedScopes: z.array(scopeEnum).min(1).max(8),
        patientId: z.string().min(1).max(64),
        validMinutes: z.number().int().min(1).max(60).optional(),
      },
      build(args, ctx) {
        const a = args as {
          audience: string;
          approvedScopes: string[];
          patientId: string;
          validMinutes?: number;
        };
        return patientAuthorisationSchema.parse({
          type: "PatientAuthorisation",
          id: newUrn(),
          patient: ctx.party,
          patientId: a.patientId,
          client: ctx.actor,
          clientKid: ctx.actorKid,
          audience: a.audience,
          approvedScopes: a.approvedScopes,
          purpose: PURPOSE.personalHealthSummary,
          issuedAt: ctx.now.toISOString(),
          validUntil: new Date(ctx.now.getTime() + (a.validMinutes ?? 60) * 60_000).toISOString(),
        }) as unknown as Json;
      },
    },
    "grant-revocation": {
      description:
        "The patient revokes ONE access grant, carrying the issuer-signed grant (`current_grant` shows it); each " +
        "enforcing server checks that the grant is the issuer's and belongs to this patient.",
      args: { grant: JWS },
      build(args, ctx) {
        const jws = (args as { grant: string }).grant;
        // Read (NOT verify) the grant id; the enforcing servers verify issuer and ownership.
        const payload = JSON.parse(
          Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8") || "{}",
        ) as { id?: unknown };
        if (typeof payload.id !== "string") throw new Error("not an access grant statement");
        return revocationSchema.parse({
          type: "GrantRevocation",
          id: newUrn(),
          grant: payload.id,
          grantStatement: jws,
          patient: ctx.party,
          issuedAt: ctx.now.toISOString(),
        }) as unknown as Json;
      },
    },
  },
  inputs: {
    "patient-id":
      "VALUE (optional, default synthetic-maya): the compartment this patient asks for — a claim; the clinic's enrollment register decides",
  },
  async init({ trust, options }) {
    const file = patientFile.parse({ version: 1, patientId: options["patient-id"] ?? PATIENT_ID });
    return { trust, files: { [PATIENT_FILE]: file } };
  },
  build(ctx) {
    const durable = (op: typeof AUTHZ_OP | typeof FHIR_SEARCH_OP, cvParty: Iri) =>
      durableHandler(new CareBriefHandler(op, { cvParty }), {
        key: CAREBRIEF_STATE,
        snapshot: (h) => h.exportState() as JsonValue,
        restore: (h, s) => h.importState(s as JsonObject),
      });
    const summariesPath = join(ctx.dir, SUMMARIES_FILE);
    const own = patientFile.parse(
      readJson(join(ctx.dir, PATIENT_FILE), { version: 1, patientId: PATIENT_ID }),
    );
    return {
      // Authorisation requests and READS only (the mandate grants nothing else).
      handlers: [durable(AUTHZ_OP, CV_AUTH.party), durable(FHIR_SEARCH_OP, CV_FHIR.party)],
      effects: [],
      operations: (op): OperatorOperation[] => {
        const saved = (o: typeof AUTHZ_OP | typeof FHIR_SEARCH_OP) =>
          (op.rt.domainState(scopedStateKey(o, CAREBRIEF_STATE)) ?? {}) as {
            grant?: { jws: string; id: Iri; scopes: string[] };
            resources?: JsonObject[];
            validation?: Json[];
          };
        const summaries = () =>
          readJson<{ summaries: Json[] }>(summariesPath, { summaries: [] }).summaries;
        return [
          {
            name: "request_access",
            title: "Request a scoped, client-bound read grant",
            description:
              "Negotiate with a PINNED authorisation server, presenting a PatientAuthorisation the patient signed outside " +
              "this service (owner-sign). Granted scopes = requested ∩ patient-approved ∩ supported.",
            input: {
              authServerActor: z.string().min(8).max(512),
              authorisation: JWS,
              patientId: z.string().min(1).max(64).optional(),
              scopes: z.array(scopeEnum).min(1).max(8).optional(),
              sessionMinutes: z.number().int().min(1).max(60).optional(),
            },
            async run(raw) {
              const a = raw as {
                authServerActor: string;
                authorisation: string;
                patientId?: string;
                scopes?: string[];
                sessionMinutes?: number;
              };
              const step = await op.rt.startNegotiation({
                peer: op.pinnedPeer(a.authServerActor),
                operation: AUTHZ_OP,
                terms: {
                  model: SCOPE_MODEL.id,
                  requestedScopes: a.scopes ?? [...SUPPORTED_SCOPES],
                  patientId: a.patientId ?? own.patientId,
                  sessionMinutes: a.sessionMinutes ?? 60,
                  purpose: PURPOSE.personalHealthSummary,
                  synthetic: true,
                },
                models: [SCOPE_MODEL],
                evidence: [
                  { role: "authorisation", format: "jws-compact", value: a.authorisation },
                ],
              });
              return {
                step: summariseStep(step),
                outbound: op.show(await op.prepare(step.outbound)),
                notice: NOT_SENT_NOTICE,
              };
            },
          },
          {
            name: "read_resources",
            title: "Read one resource type under the grant (read-only)",
            description:
              "One FHIR R4 patient-compartment search at a PINNED resource server, carrying the client-bound grant. " +
              "There is no write operation.",
            input: {
              resourceServerActor: z.string().min(8).max(512),
              resourceType: z.enum([
                "Patient",
                "MedicationRequest",
                "AllergyIntolerance",
                "Observation",
              ]),
              patientId: z.string().min(1).max(64).optional(),
            },
            async run(raw) {
              const a = raw as {
                resourceServerActor: string;
                resourceType: string;
                patientId?: string;
              };
              const grant = saved(AUTHZ_OP).grant;
              if (!grant) throw new Error("no access grant yet (request_access first)");
              const step = await op.rt.startInvocation({
                peer: op.pinnedPeer(a.resourceServerActor),
                operation: FHIR_SEARCH_OP,
                input: { resourceType: a.resourceType, patientId: a.patientId ?? own.patientId },
                basis: { kind: "grant", grant: grant.id },
                models: [FHIR_MODEL],
                discover: false,
                configuration: CONFIG_ED25519,
                evidence: [{ role: "grant", format: "jws-compact", value: grant.jws }],
              });
              return {
                step: summariseStep(step),
                outbound: op.show(await op.prepare(step.outbound)),
                notice: NOT_SENT_NOTICE,
              };
            },
          },
          {
            name: "current_grant",
            title: "Show the current access grant (for the patient's revocation)",
            description:
              "The issuer-signed grant this agent holds (id, scopes, expiry, patient, compartment and the signed " +
              "statement). The patient carries it into `owner-sign --kind grant-revocation`. Read-only.",
            readOnly: true,
            input: {},
            async run() {
              const grant = saved(AUTHZ_OP).grant;
              if (!grant) throw new Error("no access grant held");
              const p = JSON.parse(
                Buffer.from(grant.jws.split(".")[1] ?? "", "base64url").toString("utf8"),
              ) as Json;
              return {
                id: grant.id,
                scopes: grant.scopes,
                expiresAt: p.expiresAt,
                patient: p.patient,
                patientId: p.patientId,
                grant: grant.jws,
              };
            },
          },
          {
            name: "summarise",
            title: "Minimised summary with resource-version provenance",
            description:
              "Summarise the VALIDATED resources received so far: every statement cites Type/id/_history/version @ source; " +
              "conflicting records are marked unresolved (left for a clinician). Synthetic; not clinical advice.",
            input: {},
            async run() {
              const handler = new CareBriefHandler(FHIR_SEARCH_OP, { cvParty: CV_FHIR.party });
              handler.importState(saved(FHIR_SEARCH_OP) as unknown as JsonObject);
              const grant = saved(AUTHZ_OP).grant;
              const statements = handler.summary(op.now().toISOString());
              const summary = {
                id: newUrn(),
                at: op.now().toISOString(),
                grant: grant ? { id: grant.id, scopes: grant.scopes } : null,
                statements: statements as unknown as Json[],
                unresolved: statements.filter((s) => s.status === "unresolved").length,
                basedOn: handler.resources.map(
                  (r) =>
                    `${String(r.resourceType)}/${String(r.id)}/_history/${String((r.meta as JsonObject).versionId)}`,
                ),
                validation: handler.validation.map((v) => ({
                  resource: v.resource,
                  valid: v.valid,
                  issues: v.issues,
                })),
                notClaimed: ["clinical advice", "completeness of the record", "HIPAA compliance"],
                synthetic: true,
              };
              writeAtomic(summariesPath, { summaries: [...summaries(), summary] });
              return summary;
            },
          },
        ];
      },
      status: () => ({ summaries: summaries().length }),
    };
    function summaries() {
      return readJson<{ summaries: Json[] }>(summariesPath, { summaries: [] }).summaries;
    }
  },
};

// ------------------------------------------------------------------ authorisation server

export const HEALTH_AUTHORIZATION_ROLE: RoleDefinition = {
  id: "health-authorization",
  label: "Synthetic authorisation service — patient-approved scope subset, client-bound grants",
  synthetic: true,
  identity: { party: CV_AUTH.party, actor: CV_AUTH.actor, operator: CV_AUTH.operator },
  mandate: authorisationServerMandate,
  representationOperations: [AUTHZ_OP.id],
  issuingKey: {
    subject: TOKEN_ISSUER,
    note: "access-grant (token) issuer key: separate from the organisation owner key and the service actor key",
  },
  inputs: {
    enrollments:
      "the CLINIC's enrollment register {version:1, clinic, enrollments:[{principal, patientId, enrolledAt}], synthetic:true} (`synthetic-health` writes one)",
  },
  async init({ trust, options }) {
    if (!options.enrollments)
      throw new Error("health-authorization init needs --role-input enrollments=FILE");
    const file = enrollmentsFileSchema.parse(JSON.parse(readFileSync(options.enrollments, "utf8")));
    enrollmentMap(file); // refuse an ambiguous register at provisioning
    return { trust, files: { [ENROLLMENTS_FILE]: file } };
  },
  build(ctx) {
    if (!ctx.issuerKey) throw new Error("health-authorization needs its issuing key");
    const revocations = loadRevocations(ctx.dir);
    // Fail closed: without a (valid) register nobody is enrolled and nothing is issued.
    const path = join(ctx.dir, ENROLLMENTS_FILE);
    const enrollments = existsSync(path)
      ? enrollmentMap(enrollmentsFileSchema.parse(JSON.parse(readFileSync(path, "utf8"))))
      : new Map<Iri, string>();
    return {
      handlers: [
        new AuthorisationServerHandler({
          self: ctx.actor,
          issuer: TOKEN_ISSUER,
          issuerKey: ctx.issuerKey,
          resourceServer: CV_FHIR.actor,
          revocations,
          enrollments,
        }),
      ],
      effects: [],
      operations: (op) => [acceptRevocation(ctx.dir, ctx.actor, revocations)(op)],
      status: () => ({
        revokedGrants: [...revocations.revoked],
        tokenIssuer: TOKEN_ISSUER,
        enrolledPatients: enrollments.size,
      }),
    };
  },
};

// ------------------------------------------------------------------ resource server

const resourcesFile = z.union([
  z.strictObject({
    version: z.literal(1),
    patientId: z.string().min(1).max(64),
    resources: z.array(z.record(z.string(), z.unknown())).max(500),
    synthetic: z.literal(true),
  }),
  z.strictObject({
    version: z.literal(2),
    patientIds: z.array(z.string().min(1).max(64)).min(1).max(100),
    resources: z.array(z.record(z.string(), z.unknown())).max(2000),
    synthetic: z.literal(true),
  }),
]);

export const HEALTH_RESOURCE_ROLE: RoleDefinition = {
  id: "health-resource",
  label: "Synthetic FHIR R4 resource service — read-only, grant-enforced, minimised audit",
  synthetic: true,
  mandate: resourceServerMandate,
  representationOperations: [FHIR_SEARCH_OP.id],
  inputs: {
    resources:
      "JSON {version:2, patientIds:[…], resources:[FHIR R4 JSON…], synthetic:true} (version 1 with one patientId accepted)",
    issuers: "token issuer public card(s) (`awp-pilot issuer-card --name <authorization>`)",
  },
  async init({ trust, options }) {
    if (!options.resources || !options.issuers)
      throw new Error("health-resource init needs --role-input resources=FILE and issuers=FILE");
    const file = resourcesFile.parse(JSON.parse(readFileSync(options.resources, "utf8")));
    return {
      trust: pinIssuersFromFiles(
        trust,
        options.issuers,
        "access-grant issuer pinned at the resource server's provisioning",
      ),
      files: { [RESOURCES_FILE]: file },
    };
  },
  build(ctx) {
    const file = resourcesFile.parse(
      JSON.parse(readFileSync(join(ctx.dir, RESOURCES_FILE), "utf8")),
    );
    const revocations = loadRevocations(ctx.dir);
    return {
      handlers: [
        new ResourceServerHandler({
          self: ctx.actor,
          issuer: TOKEN_ISSUER,
          revocations,
          resources: file.resources as JsonObject[],
        }),
      ],
      effects: [],
      operations: (op) => [acceptRevocation(ctx.dir, ctx.actor, revocations)(op)],
      // A queued searchset leaves only while its grant still holds (revocation, expiry).
      disclosureChecks: { [ACCESS_GRANT_CONDITION]: accessGrantCheck(revocations) },
      status: () => ({
        resources: file.resources.length,
        revokedGrants: [...revocations.revoked],
        writeCapability: false,
      }),
    };
  },
};
