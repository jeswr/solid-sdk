// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
// AUTHORED-BY Claude Fable 5
//
// Vocabulary IRIs used by the access manager. Everything here is an EXISTING
// published vocabulary (WAC, LDP, Solid, FOAF, ODRL 2.2, DPV 2.2, DCT, PROV-O)
// except the three `accm:` UX/status labels, which live under the suite
// namespace at https://jeswr.org/ns/; w3id.org/jeswr is a read-only legacy alias.

export const ACL = {
  ns: "http://www.w3.org/ns/auth/acl#",
  Authorization: "http://www.w3.org/ns/auth/acl#Authorization",
  accessTo: "http://www.w3.org/ns/auth/acl#accessTo",
  default: "http://www.w3.org/ns/auth/acl#default",
  agent: "http://www.w3.org/ns/auth/acl#agent",
  agentClass: "http://www.w3.org/ns/auth/acl#agentClass",
  agentGroup: "http://www.w3.org/ns/auth/acl#agentGroup",
  origin: "http://www.w3.org/ns/auth/acl#origin",
  mode: "http://www.w3.org/ns/auth/acl#mode",
  Read: "http://www.w3.org/ns/auth/acl#Read",
  Write: "http://www.w3.org/ns/auth/acl#Write",
  Append: "http://www.w3.org/ns/auth/acl#Append",
  Control: "http://www.w3.org/ns/auth/acl#Control",
  AuthenticatedAgent: "http://www.w3.org/ns/auth/acl#AuthenticatedAgent",
} as const;

export const FOAF = {
  Agent: "http://xmlns.com/foaf/0.1/Agent",
  name: "http://xmlns.com/foaf/0.1/name",
} as const;

export const LDP = {
  contains: "http://www.w3.org/ns/ldp#contains",
  inbox: "http://www.w3.org/ns/ldp#inbox",
  Container: "http://www.w3.org/ns/ldp#Container",
  BasicContainer: "http://www.w3.org/ns/ldp#BasicContainer",
} as const;

export const SOLID = {
  publicTypeIndex: "http://www.w3.org/ns/solid/terms#publicTypeIndex",
  privateTypeIndex: "http://www.w3.org/ns/solid/terms#privateTypeIndex",
  TypeRegistration: "http://www.w3.org/ns/solid/terms#TypeRegistration",
  forClass: "http://www.w3.org/ns/solid/terms#forClass",
  instance: "http://www.w3.org/ns/solid/terms#instance",
  instanceContainer: "http://www.w3.org/ns/solid/terms#instanceContainer",
} as const;

export const PIM = {
  storage: "http://www.w3.org/ns/pim/space#storage",
} as const;

export const RDF = {
  type: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
} as const;

export const RDFS = {
  label: "http://www.w3.org/2000/01/rdf-schema#label",
} as const;

export const DCT = {
  created: "http://purl.org/dc/terms/created",
  modified: "http://purl.org/dc/terms/modified",
  description: "http://purl.org/dc/terms/description",
} as const;

export const XSD = {
  dateTime: "http://www.w3.org/2001/XMLSchema#dateTime",
  string: "http://www.w3.org/2001/XMLSchema#string",
} as const;

export const PROV = {
  wasGeneratedBy: "http://www.w3.org/ns/prov#wasGeneratedBy",
  actedOnBehalfOf: "http://www.w3.org/ns/prov#actedOnBehalfOf",
  generatedAtTime: "http://www.w3.org/ns/prov#generatedAtTime",
} as const;

/**
 * DPV 2.2 (Final CG Report, https://w3id.org/dpv#) — the consent-record terms
 * the proposal §2.1 pins for receipts (ISO/IEC TS 27560-profile shape).
 */
export const DPV = {
  ns: "https://w3id.org/dpv#",
  ConsentRecord: "https://w3id.org/dpv#ConsentRecord",
  hasDataSubject: "https://w3id.org/dpv#hasDataSubject",
  hasRecipient: "https://w3id.org/dpv#hasRecipient",
  hasPurpose: "https://w3id.org/dpv#hasPurpose",
  hasProcessing: "https://w3id.org/dpv#hasProcessing",
  hasConsentStatus: "https://w3id.org/dpv#hasConsentStatus",
  hasLegalBasis: "https://w3id.org/dpv#hasLegalBasis",
  Consent: "https://w3id.org/dpv#Consent",
  ConsentGiven: "https://w3id.org/dpv#ConsentGiven",
  ConsentRefused: "https://w3id.org/dpv#ConsentRefused",
  ConsentWithdrawn: "https://w3id.org/dpv#ConsentWithdrawn",
  ConsentRequested: "https://w3id.org/dpv#ConsentRequested",
} as const;

export const ODRL = {
  ns: "http://www.w3.org/ns/odrl/2/",
  Offer: "http://www.w3.org/ns/odrl/2/Offer",
  Agreement: "http://www.w3.org/ns/odrl/2/Agreement",
  purpose: "http://www.w3.org/ns/odrl/2/purpose",
} as const;

/**
 * The three suite-minted `accm:` terms (proposal §2.2: labels + server/app-derived
 * state, never enforcement weight) plus the request state machine of §3.5.
 * Home: https://jeswr.org/ns/accm#; w3id.org/jeswr/accm# is a read-only legacy alias.
 */
export const ACCM = {
  ns: NS.ACCESS_MANAGER,
  DataClass: `${NS.ACCESS_MANAGER}DataClass`,
  dataClass: `${NS.ACCESS_MANAGER}dataClass`,
  resolvesTo: `${NS.ACCESS_MANAGER}resolvesTo`,
  // Request/grant lifecycle state (client-side pipeline, §3.5).
  status: `${NS.ACCESS_MANAGER}status`,
  Pending: `${NS.ACCESS_MANAGER}Pending`,
  Approving: `${NS.ACCESS_MANAGER}Approving`,
  Approved: `${NS.ACCESS_MANAGER}Approved`,
  Denied: `${NS.ACCESS_MANAGER}Denied`,
  grantId: `${NS.ACCESS_MANAGER}grantId`,
  grantRef: `${NS.ACCESS_MANAGER}grantRef`,
  requestRef: `${NS.ACCESS_MANAGER}requestRef`,
  revokedAt: `${NS.ACCESS_MANAGER}revokedAt`,
  schemaVersion: `${NS.ACCESS_MANAGER}schemaVersion`,
  mode: `${NS.ACCESS_MANAGER}mode`,
  agent: `${NS.ACCESS_MANAGER}agent`,
} as const;
