/**
 * UC-04 executable workflow: CareBrief (Maya's agent) against a local synthetic Cedar
 * Valley authorisation server + FHIR R4 resource server, plus a misconfigured clinic and a
 * rogue client. All decisions run in the shared runtime and the domain handlers.
 */

import { DirectBus } from "../bindings/direct.js";
import { newUrn } from "../core/canonical.js";
import type { JsonObject } from "../core/types.js";
import {
  AUTHZ_OP,
  AuthorisationServerHandler,
  CareBriefHandler,
  FHIR_MODEL,
  FHIR_SEARCH_OP,
  FHIR_WRITE_OP,
  ResourceServerHandler,
  RevocationList,
  SCOPE_MODEL,
  SUPPORTED_SCOPES,
  syntheticResources,
} from "../domains/fhir.js";
import {
  authorisationServerMandate,
  BIRCH,
  CAREBRIEF,
  CV_AUTH,
  CV_FHIR,
  MAYA_PARTY,
  PATIENT_ID,
  patientAgentMandate,
  ROGUE,
  resourceServerMandate,
  TOKEN_ISSUER,
} from "../fixtures/health.js";
import { generateSigningKey } from "../mechanisms/jws.js";
import { signStatement, TYP } from "../mechanisms/statements.js";
import { TrustStore } from "../mechanisms/trust.js";
import { CONFIG_ED25519 } from "../profile/configurations.js";
import { PURPOSE } from "../profile/vocabulary.js";
import type { OperationHandler } from "../runtime/operations.js";
import { verifyLedger } from "../store/ledger.js";
import { Cast, mandateOf, permit } from "./common.js";

export { BIRCH, CAREBRIEF, CV_AUTH, CV_FHIR, MAYA_PARTY, ROGUE };

/** A client that sends a write without any local authorisation check (to test the server). */
class RogueWriteHandler implements OperationHandler {
  readonly description = {
    id: FHIR_WRITE_OP.id,
    version: FHIR_WRITE_OP.version,
    label: "rogue",
    pattern: "invoke" as const,
    access: "represented" as const,
    roles: ["initiator" as const],
    models: [FHIR_MODEL],
    effects: [],
    outcomes: [],
  };
  readonly requiresRepresentation = false;
  intentForInvoke(): undefined {
    return undefined;
  }
}
class RogueSearchHandler implements OperationHandler {
  readonly description = {
    id: FHIR_SEARCH_OP.id,
    version: FHIR_SEARCH_OP.version,
    label: "rogue",
    pattern: "invoke" as const,
    access: "represented" as const,
    roles: ["initiator" as const],
    models: [FHIR_MODEL],
    effects: [],
    outcomes: [],
  };
  readonly requiresRepresentation = false;
  intentForInvoke(): undefined {
    return undefined;
  }
}

export async function runFhir(clock: { now: () => Date; advance: (ms: number) => void }) {
  const now = clock.now;
  const cast = new Cast(now);
  const cvOrgKey = (await generateSigningKey("EdDSA")).key;
  const tokenKey = (await generateSigningKey("EdDSA")).key;
  await cast.add(CAREBRIEF, patientAgentMandate(), [AUTHZ_OP.id, FHIR_SEARCH_OP.id]);
  await cast.add(CV_AUTH, authorisationServerMandate(), [AUTHZ_OP.id], { ownerKey: cvOrgKey });
  await cast.add(CV_FHIR, resourceServerMandate(), [FHIR_SEARCH_OP.id], { ownerKey: cvOrgKey });
  await cast.add(BIRCH, authorisationServerMandate(), [AUTHZ_OP.id]);
  await cast.add(
    ROGUE,
    mandateOf("rogue", [permit("read", FHIR_SEARCH_OP.id, [PURPOSE.personalHealthSummary])]),
    [FHIR_SEARCH_OP.id, FHIR_WRITE_OP.id],
  );
  cast.introduce("carebrief", "cv-auth");
  cast.introduce("carebrief", "cv-fhir");
  cast.introduce("carebrief", "birch-auth");
  cast.introduce("rogue-app", "cv-fhir");
  cast.pinIssuer("cv-fhir", TOKEN_ISSUER, tokenKey, "Cedar Valley access-grant signing key");
  cast.pinIssuer("cv-auth", TOKEN_ISSUER, tokenKey, "this service's own issuing key");

  const revocations = new RevocationList();
  const authHandler = new AuthorisationServerHandler({
    self: CV_AUTH.actor,
    issuer: TOKEN_ISSUER,
    issuerKey: tokenKey,
    resourceServer: CV_FHIR.actor,
    revocations,
    // The clinic's enrollment register binds Maya's principal to her compartment.
    enrollments: new Map([[MAYA_PARTY, PATIENT_ID]]),
  });
  const cbAuth = new CareBriefHandler(AUTHZ_OP, { cvParty: CV_AUTH.party });
  const cbSearch = new CareBriefHandler(FHIR_SEARCH_OP, { cvParty: CV_FHIR.party });
  const cbWrite = new CareBriefHandler(FHIR_WRITE_OP, { cvParty: CV_FHIR.party });
  const cb = await cast.runtime("carebrief", [cbAuth, cbSearch, cbWrite]);
  const auth = await cast.runtime("cv-auth", [authHandler]);
  const fhir = await cast.runtime("cv-fhir", [
    new ResourceServerHandler({
      self: CV_FHIR.actor,
      issuer: TOKEN_ISSUER,
      revocations,
      resources: syntheticResources(PATIENT_ID),
    }),
  ]);
  const birch = await cast.runtime("birch-auth", [
    new AuthorisationServerHandler({
      self: BIRCH.actor,
      issuer: "https://birchclinic.example/#token-issuer",
      issuerKey: tokenKey,
      resourceServer: CV_FHIR.actor,
      revocations: new RevocationList(),
      enrollments: new Map(),
      codeChallengeMethods: ["plain"],
    }),
  ]);
  const rogue = await cast.runtime("rogue-app", [
    new RogueWriteHandler(),
    new RogueSearchHandler(),
  ]);
  const bus = new DirectBus().register(
    cb.runtime,
    auth.runtime,
    fhir.runtime,
    birch.runtime,
    rogue.runtime,
  );
  const obs: Record<string, unknown> = {};
  const terms = {
    model: SCOPE_MODEL.id,
    requestedScopes: [...SUPPORTED_SCOPES],
    patientId: PATIENT_ID,
    sessionMinutes: 60,
    purpose: PURPOSE.personalHealthSummary,
    synthetic: true,
  } as JsonObject;

  // 1. Discovery at a clinic that does not advertise PKCE S256 → stop before requesting.
  const toBirch = await cb.runtime.startNegotiation({
    peer: { actor: BIRCH.actor, party: BIRCH.party },
    operation: AUTHZ_OP,
    terms,
    models: [SCOPE_MODEL],
  });
  bus.send(cb.runtime, toBirch);
  await bus.run();
  obs.birch = {
    phase: cb.runtime.conversation(toBirch.conversation as string)?.phase,
    reason: cb.runtime.conversation(toBirch.conversation as string)?.closedReason,
    proposalsSent: bus.trace.filter((t) => t.to === BIRCH.actor && t.kind === "propose").length,
  };

  // 2. Maya approves a SUBSET (no Observation) for this client key and this server.
  const maya = cast.get("carebrief");
  const approvedScopes = [
    "launch/patient",
    "patient/Patient.r",
    "patient/MedicationRequest.rs",
    "patient/AllergyIntolerance.rs",
  ];
  const patientAuth = await signStatement(maya.ownerKey, TYP.statement, {
    type: "PatientAuthorisation",
    id: newUrn(),
    patient: MAYA_PARTY,
    patientId: PATIENT_ID,
    client: CAREBRIEF.actor,
    clientKid: maya.actorKey.kid,
    audience: CV_AUTH.actor,
    approvedScopes,
    purpose: PURPOSE.personalHealthSummary,
    issuedAt: now().toISOString(),
    validUntil: new Date(now().getTime() + 3_600_000).toISOString(),
  });
  const toCv = await cb.runtime.startNegotiation({
    peer: { actor: CV_AUTH.actor, party: CV_AUTH.party },
    operation: AUTHZ_OP,
    terms,
    models: [SCOPE_MODEL],
    evidence: [{ role: "authorisation", format: "jws-compact", value: patientAuth }],
  });
  bus.send(cb.runtime, toCv);
  await bus.run();
  const scopeDecision = auth.ledger
    .entries()
    .find((e) => e.record.type === "scope-decision")?.record;
  obs.authorisation = {
    phase: cb.runtime.conversation(toCv.conversation as string)?.phase,
    requested: scopeDecision?.requested,
    approvedByPatient: scopeDecision?.approvedByPatient,
    granted: scopeDecision?.granted,
  };
  const grant = cbAuth.grantInfo;

  // 3. Reads, each an invocation carrying the client-bound grant.
  const read = async (
    rt: typeof cb.runtime,
    resourceType: string,
    evidence = cbAuth.grantEvidence(),
  ) => {
    const step = await rt.startInvocation({
      peer: { actor: CV_FHIR.actor, party: CV_FHIR.party },
      operation: FHIR_SEARCH_OP,
      input: { resourceType, patientId: PATIENT_ID },
      basis: { kind: "grant", grant: grant?.id ?? "urn:awp:none" },
      models: [FHIR_MODEL],
      discover: false,
      configuration: CONFIG_ED25519,
      evidence,
    });
    bus.send(rt, step);
    await bus.run();
    const c = rt.conversation(step.conversation as string);
    return { phase: c?.phase, reason: c?.closedReason };
  };
  obs.reads = {
    Patient: await read(cb.runtime, "Patient"),
    MedicationRequest: await read(cb.runtime, "MedicationRequest"),
    AllergyIntolerance: await read(cb.runtime, "AllergyIntolerance"),
    Observation: await read(cb.runtime, "Observation"),
  };
  const accesses = fhir.ledger
    .entries()
    .filter((e) => e.record.type === "audit-access")
    .map((e) => e.record);
  obs.exercisedScopes = accesses.map((a) => a.resourceType);
  obs.outOfScopeSuccessfulReads = accesses.filter(
    (a) => !approvedScopes.some((s) => s.includes(`/${String(a.resourceType)}.`)),
  ).length;

  // 4. Writes: CareBrief's own mandate blocks it (nothing sent); a rogue client's write is
  //    refused by the server (no write operation exists); a stolen grant is key-bound.
  const writeStep = await cb.runtime.startInvocation({
    peer: { actor: CV_FHIR.actor, party: CV_FHIR.party },
    operation: FHIR_WRITE_OP,
    input: { resourceType: "MedicationRequest", patientId: PATIENT_ID },
    basis: { kind: "grant", grant: grant?.id ?? "x" },
    models: [FHIR_MODEL],
    discover: false,
    configuration: CONFIG_ED25519,
  });
  const rogueWrite = await rogue.runtime.startInvocation({
    peer: { actor: CV_FHIR.actor, party: CV_FHIR.party },
    operation: FHIR_WRITE_OP,
    input: { resourceType: "MedicationRequest", patientId: PATIENT_ID },
    basis: { kind: "grant", grant: "urn:awp:none" },
    models: [FHIR_MODEL],
    discover: false,
    configuration: CONFIG_ED25519,
  });
  bus.send(rogue.runtime, rogueWrite);
  await bus.run();
  const stolen = await read(rogue.runtime, "MedicationRequest", cbAuth.grantEvidence());
  obs.writes = {
    careBriefWriteSent: writeStep.outbound.length,
    careBriefLocalDecision: writeStep.decisions[0]?.outcome,
    rogueWrite: {
      phase: rogue.runtime.conversation(rogueWrite.conversation as string)?.phase,
      reason: rogue.runtime.conversation(rogueWrite.conversation as string)?.closedReason,
    },
    stolenGrant: stolen,
  };

  // 5. Summary: every statement cites resource id/version/source; conflicts left unresolved.
  obs.validation = cbSearch.validation;
  obs.summary = cbSearch.summary(now().toISOString());

  // 6. Maya revokes; the next read fails.
  const revocation = await signStatement(maya.ownerKey, TYP.statement, {
    type: "GrantRevocation",
    id: newUrn(),
    grant: grant?.id ?? "x",
    grantStatement: grant?.jws ?? "x",
    patient: MAYA_PARTY,
    issuedAt: now().toISOString(),
  });
  obs.revoked = (
    await authHandler.revoke(
      {
        trust: await TrustStore.load(cast.trust.get("cv-auth")),
        at: now().toISOString(),
        verifier: CV_AUTH.actor,
        issuer: TOKEN_ISSUER,
        record: (r) => auth.ledger.append(r, now().toISOString()),
      },
      revocation,
    )
  ).revoked;
  obs.afterRevocation = await read(cb.runtime, "MedicationRequest");

  const fhirAudit = JSON.stringify(fhir.ledger.entries());
  obs.auditMinimised = !/lisinopril|penicillin|atorvastatin|Systolic/i.test(fhirAudit);
  obs.auditEvents = fhir.ledger
    .entries()
    .filter((e) => e.record.type.startsWith("audit-"))
    .map((e) => ({
      type: e.record.type,
      resourceType: e.record.resourceType,
      reason: e.record.reason,
      count: e.record.count,
    }));
  obs.ledgers = [cb, auth, fhir].every((r) => verifyLedger(r.ledger.entries()).ok);
  return { obs, trace: bus.trace };
}
