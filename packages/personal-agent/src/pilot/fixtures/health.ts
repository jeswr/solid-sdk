/**
 * SYNTHETIC US health-summary (UC-04) fixture: patient agent, authorisation service and FHIR
 * resource service identities and owner mandates, the token-issuer identity and the synthetic
 * patient id. Used by BOTH the in-process scenario (`scenarios/fhir.ts`) and the durable roles
 * (`roles/health.ts`). Everything is synthetic: two wholly synthetic patients (Maya, Noah) and a
 * clinic enrollment register binding each patient principal to one compartment, hand-authored
 * Synthea-like resources, no real clinic. Not SMART-on-FHIR/OAuth, not HIPAA compliance, not
 * clinical advice.
 */
import { scopedUrn } from "../core/canonical.js";
import { AUTHZ_OP, type EnrollmentsFile, FHIR_SEARCH_OP } from "../domains/fhir.js";
import { PURPOSE } from "../profile/vocabulary.js";
import { mandateOf, permit } from "../scenarios/common.js";

export const MAYA_PARTY = "https://maya.example/#me";
export const CAREBRIEF = {
  name: "carebrief",
  party: MAYA_PARTY,
  actor: "https://carebrief.example/agents/brief#agent",
  operator: "https://carebrief.example/#org",
};
export const CV_AUTH = {
  name: "cv-auth",
  party: "https://cedarvalley.example/#org",
  actor: "https://cedarvalley.example/agents/authorization#service",
  operator: "https://cedarvalley.example/#org",
};
export const CV_FHIR = {
  name: "cv-fhir",
  party: "https://cedarvalley.example/#org",
  actor: "https://cedarvalley.example/agents/fhir#service",
  operator: "https://cedarvalley.example/#org",
};
/** A second resource server of the same organisation (grants are NOT for it: wrong audience). */
export const CV_ARCHIVE = {
  name: "cv-archive",
  party: "https://cedarvalley.example/#org",
  actor: "https://cedarvalley.example/agents/fhir-archive#service",
  operator: "https://cedarvalley.example/#org",
};
export const BIRCH = {
  name: "birch-auth",
  party: "https://birchclinic.example/#org",
  actor: "https://birchclinic.example/agents/authorization#service",
  operator: "https://birchclinic.example/#org",
};
export const ROGUE = {
  name: "rogue-app",
  party: "https://rogue.example/#org",
  actor: "https://rogue.example/agents/app#agent",
  operator: "https://rogue.example/#org",
};
/** A SECOND synthetic patient with her/his own agent (cross-patient negative cases). */
export const NOAH_PARTY = "https://noah.example/#me";
export const CAREBRIEF_NOAH = {
  name: "carebrief-noah",
  party: NOAH_PARTY,
  actor: "https://carebrief.example/agents/brief-noah#agent",
  operator: "https://carebrief.example/#org",
};
export const TOKEN_ISSUER = "https://cedarvalley.example/#token-issuer";
export const PATIENT_ID = "synthetic-maya";
export const NOAH_PATIENT_ID = "synthetic-noah";

/**
 * The clinic's (synthetic) enrollment register: which authenticated patient principal owns
 * which compartment. Written by `synthetic-health`; provisioned into the authorisation service
 * by the CLINIC operator (`--role-input enrollments=FILE`).
 */
export function syntheticEnrollments(at: Date): EnrollmentsFile {
  return {
    version: 1,
    clinic: CV_AUTH.party,
    enrollments: [
      { principal: MAYA_PARTY, patientId: PATIENT_ID, enrolledAt: at.toISOString() },
      { principal: NOAH_PARTY, patientId: NOAH_PATIENT_ID, enrolledAt: at.toISOString() },
    ],
    synthetic: true,
  };
}

/** The patient agent may request authorisation and READ; it has no write entitlement. */
export function patientAgentMandate() {
  return mandateOf("patient-summary", [
    permit("use", AUTHZ_OP.id, [PURPOSE.personalHealthSummary], [CV_AUTH.party, BIRCH.party]),
    permit("read", FHIR_SEARCH_OP.id, [PURPOSE.personalHealthSummary], [CV_FHIR.party]),
  ]);
}

export function authorisationServerMandate() {
  return mandateOf("authorization-server", [
    permit("use", AUTHZ_OP.id, [PURPOSE.personalHealthSummary]),
  ]);
}

/** A deliberately never-matching target: the resource server gets no outbound authority. */
export function resourceServerMandate() {
  return mandateOf("resource-server", [
    permit("read", scopedUrn("target", FHIR_SEARCH_OP.id, "none"), [PURPOSE.personalHealthSummary]),
  ]);
}
