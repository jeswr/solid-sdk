// AUTHORED-BY Claude Fable 5
//
// The Ada & Bex demo scenario — INERT SAMPLE DATA for the ?demo mode, matching
// the Solid Walkthrough narrative exactly:
//   • Ada owns a pod with a /health/ folder (results, notes, a symptom diary).
//   • /health/ is shared with Dr. Bex (Read, a direct grant on the folder);
//     /profile/card is public (Read); the Clinic App reads the health files
//     via the folder grant (inherited, acl:default).
//   • The inbox holds ONE pending request: the Clinic App asking for Read on
//     Ada's health data for 30 days (purpose: care coordination) — it resolves
//     to a concrete file list before approval.
//   • History carries the consent receipts: shared with Dr. Bex, approved the
//     Clinic App (health data, Read, 30d), and one earlier revoked Clinic
//     App grant.
//
// Everything lives on RFC-2606-style example domains: none of these IRIs can
// ever be dereferenced for real, and the demo fetch never leaves memory. The
// documents are Turtle FIXTURES (hand-written sample data, mirroring
// test/fixtures.ts) — not an app write path; all real writes still go through
// the typed accessors in src/lib.

import type { Session } from "../auth/SessionContext.js";
import { createDemoPod, type DemoPod } from "./pod.js";

/** Ada — the demo pod owner. */
export const DEMO_POD = "https://ada.example/";
export const ADA = "https://ada.example/profile/card#me";
/** Dr. Bex — Ada's doctor (direct Read grant on /health/). */
export const BEX = "https://bex.example/profile/card#me";
/** The Clinic App — holds an inherited folder grant + the pending request. */
export const CLINIC = "https://clinic.example/id#app";

/** The "Health" data class (a demo-only class IRI; label derives to "Health"). */
export const HEALTH_CLASS = "https://vocab.example/health#Health";
/** The care-coordination purpose (label derives to "Care Coordination"). */
export const CARE_COORDINATION = "https://vocab.example/purpose#CareCoordination";

export const DEMO_INBOX = `${DEMO_POD}inbox/`;
export const DEMO_REQUEST = `${DEMO_INBOX}request-clinic.ttl`;
export const DEMO_GRANTS = `${DEMO_POD}access-manager/grants/`;
export const DEMO_RECEIPTS = `${DEMO_POD}access-manager/receipts/`;

export const HEALTH = `${DEMO_POD}health/`;
export const BLOOD = `${HEALTH}results/blood.ttl`;
export const PANEL = `${HEALTH}results/panel.ttl`;
export const NOTES = `${HEALTH}notes.ttl`;
export const DIARY = `${HEALTH}diary.ttl`;

/** Demo grant/receipt ids (sample values — receipts are named receipt-<id>.ttl). */
const BEX_GRANT_ID = "4c1f9a2e77d3";
const CLINIC_GRANT_ID = "9b8e21c4f0a7";
const OLD_CLINIC_GRANT_ID = "5d0a3c9b1e88";

const PREFIXES = `
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
@prefix dpv: <https://w3id.org/dpv#> .
@prefix accm: <https://w3id.org/jeswr/accm#> .
`;

/** Ada's profile: storage + inbox + the public type index; publicly readable. */
function adaProfile(): string {
  return `${PREFIXES}
<${ADA}> a foaf:Person ;
  foaf:name "Ada" ;
  pim:storage <${DEMO_POD}> ;
  ldp:inbox <${DEMO_INBOX}> ;
  solid:publicTypeIndex <${DEMO_POD}settings/publicTypeIndex.ttl> .
`;
}

/** Dr. Bex's profile — only read so the UI can show her name. */
function bexProfile(): string {
  return `${PREFIXES}
<${BEX}> a foaf:Person ;
  foaf:name "Dr. Bex" .
`;
}

/** The Clinic App's identity document — only read for its display name. */
function clinicProfile(): string {
  return `${PREFIXES}
<${CLINIC}> foaf:name "Clinic App" .
`;
}

/** Root ACL: Ada alone controls the pod; everything inherits from here. */
function rootAcl(): string {
  return `${PREFIXES}
<${DEMO_POD}.acl#owner> a acl:Authorization ;
  acl:agent <${ADA}> ;
  acl:accessTo <${DEMO_POD}> ;
  acl:default <${DEMO_POD}> ;
  acl:mode acl:Read, acl:Write, acl:Control .
`;
}

/**
 * /health/ ACL — the heart of the scenario:
 *   #bex    → Dr. Bex reads the folder (direct on /health/) and, via
 *             acl:default, everything inside it;
 *   #clinic → the Clinic App reads the folder's CONTENTS only (acl:default,
 *             no acl:accessTo) — so the health files show it as INHERITED
 *             from the folder grant.
 */
function healthAcl(): string {
  return `${PREFIXES}
<${HEALTH}.acl#owner> a acl:Authorization ;
  acl:agent <${ADA}> ;
  acl:accessTo <${HEALTH}> ;
  acl:default <${HEALTH}> ;
  acl:mode acl:Read, acl:Write, acl:Control .
<${HEALTH}.acl#bex> a acl:Authorization ;
  acl:agent <${BEX}> ;
  acl:accessTo <${HEALTH}> ;
  acl:default <${HEALTH}> ;
  acl:mode acl:Read .
<${HEALTH}.acl#clinic> a acl:Authorization ;
  acl:agent <${CLINIC}> ;
  acl:default <${HEALTH}> ;
  acl:mode acl:Read .
`;
}

/** /profile/card ACL: Ada controls it; ANYONE on the web can read it. */
function profileCardAcl(): string {
  const card = `${DEMO_POD}profile/card`;
  return `${PREFIXES}
<${card}.acl#owner> a acl:Authorization ;
  acl:agent <${ADA}> ;
  acl:accessTo <${card}> ;
  acl:mode acl:Read, acl:Write, acl:Control .
<${card}.acl#public> a acl:Authorization ;
  acl:agentClass foaf:Agent ;
  acl:accessTo <${card}> ;
  acl:mode acl:Read .
`;
}

/** The "Health" type-index registration: exactly the three health files. */
function publicTypeIndex(): string {
  return `${PREFIXES}
<${DEMO_POD}settings/publicTypeIndex.ttl#health> a solid:TypeRegistration ;
  rdfs:label "Health" ;
  solid:forClass <${HEALTH_CLASS}> ;
  solid:instance <${BLOOD}>, <${PANEL}>, <${NOTES}> .
`;
}

/**
 * The ONE pending inbox request: the Clinic App asks for Read on Ada's health
 * data for 30 days, purpose care coordination. No accm:status → Pending.
 */
function clinicRequest(): string {
  return `${PREFIXES}
<${DEMO_REQUEST}> a odrl:Offer ;
  odrl:uid <${DEMO_REQUEST}> ;
  accm:dataClass <${HEALTH_CLASS}> ;
  odrl:permission [
    odrl:assignee <${CLINIC}> ;
    odrl:action odrl:read ;
    odrl:target <${HEALTH_CLASS}> ;
    odrl:constraint [
      odrl:leftOperand odrl:purpose ;
      odrl:operator odrl:eq ;
      odrl:rightOperand <${CARE_COORDINATION}>
    ] , [
      odrl:leftOperand odrl:dateTime ;
      odrl:operator odrl:lteq ;
      odrl:rightOperand "2026-08-09T00:00:00Z"^^xsd:dateTime
    ]
  ] .
`;
}

/** Active grant record: /health/ shared with Dr. Bex (Read). */
function bexGrant(): string {
  const url = `${DEMO_GRANTS}grant-${BEX_GRANT_ID}.ttl`;
  return `${PREFIXES}
<${url}> a odrl:Agreement ;
  odrl:uid <${url}> ;
  odrl:permission [
    odrl:assigner <${ADA}> ;
    odrl:assignee <${BEX}> ;
    odrl:action odrl:read ;
    odrl:target <${HEALTH}>
  ] ;
  accm:grantId "${BEX_GRANT_ID}" ;
  accm:schemaVersion "1" ;
  accm:agent <${BEX}> ;
  accm:resolvesTo <${HEALTH}> ;
  accm:mode acl:Read ;
  dct:created "2026-06-12T09:30:00Z"^^xsd:dateTime .
`;
}

/** Active grant record: the Clinic App approval (health data, Read, 30 days). */
function clinicGrant(): string {
  const url = `${DEMO_GRANTS}grant-${CLINIC_GRANT_ID}.ttl`;
  return `${PREFIXES}
<${url}> a odrl:Agreement ;
  odrl:uid <${url}> ;
  odrl:permission [
    odrl:assigner <${ADA}> ;
    odrl:assignee <${CLINIC}> ;
    odrl:action odrl:read ;
    odrl:target <${BLOOD}> ;
    odrl:constraint [
      odrl:leftOperand odrl:purpose ;
      odrl:operator odrl:eq ;
      odrl:rightOperand <${CARE_COORDINATION}>
    ] , [
      odrl:leftOperand odrl:dateTime ;
      odrl:operator odrl:lteq ;
      odrl:rightOperand "2026-07-31T00:00:00Z"^^xsd:dateTime
    ]
  ] ;
  accm:grantId "${CLINIC_GRANT_ID}" ;
  accm:schemaVersion "1" ;
  accm:agent <${CLINIC}> ;
  accm:resolvesTo <${BLOOD}>, <${PANEL}>, <${NOTES}> ;
  accm:mode acl:Read ;
  dct:created "2026-07-01T14:00:00Z"^^xsd:dateTime .
`;
}

/** Receipt: "Shared /health/ with Dr. Bex (Read)". */
function bexReceipt(): string {
  const url = `${DEMO_RECEIPTS}receipt-${BEX_GRANT_ID}.ttl`;
  return `${PREFIXES}
<${url}> a dpv:ConsentRecord ;
  dpv:hasDataSubject <${ADA}> ;
  dpv:hasRecipient <${BEX}> ;
  dpv:hasConsentStatus dpv:ConsentGiven ;
  dpv:hasLegalBasis dpv:Consent ;
  accm:grantId "${BEX_GRANT_ID}" ;
  accm:grantRef <${DEMO_GRANTS}grant-${BEX_GRANT_ID}.ttl> ;
  accm:resolvesTo <${HEALTH}> ;
  dct:created "2026-06-12T09:30:00Z"^^xsd:dateTime .
`;
}

/** Receipt: "Approved Clinic App — health data (Read, 30d)". */
function clinicReceipt(): string {
  const url = `${DEMO_RECEIPTS}receipt-${CLINIC_GRANT_ID}.ttl`;
  return `${PREFIXES}
<${url}> a dpv:ConsentRecord ;
  dpv:hasDataSubject <${ADA}> ;
  dpv:hasRecipient <${CLINIC}> ;
  dpv:hasPurpose <${CARE_COORDINATION}> ;
  dpv:hasConsentStatus dpv:ConsentGiven ;
  dpv:hasLegalBasis dpv:Consent ;
  accm:grantId "${CLINIC_GRANT_ID}" ;
  accm:grantRef <${DEMO_GRANTS}grant-${CLINIC_GRANT_ID}.ttl> ;
  accm:resolvesTo <${BLOOD}>, <${PANEL}>, <${NOTES}> ;
  dct:created "2026-07-01T14:00:00Z"^^xsd:dateTime .
`;
}

/** Receipt: "Revoked Clinic App access" (an earlier, withdrawn grant). */
function oldClinicReceipt(): string {
  const url = `${DEMO_RECEIPTS}receipt-${OLD_CLINIC_GRANT_ID}.ttl`;
  return `${PREFIXES}
<${url}> a dpv:ConsentRecord ;
  dpv:hasDataSubject <${ADA}> ;
  dpv:hasRecipient <${CLINIC}> ;
  dpv:hasPurpose <${CARE_COORDINATION}> ;
  dpv:hasConsentStatus dpv:ConsentWithdrawn ;
  dpv:hasLegalBasis dpv:Consent ;
  accm:grantId "${OLD_CLINIC_GRANT_ID}" ;
  accm:resolvesTo <${BLOOD}>, <${PANEL}> ;
  dct:created "2026-04-14T10:15:00Z"^^xsd:dateTime ;
  accm:revokedAt "2026-05-02T08:45:00Z"^^xsd:dateTime .
`;
}

function healthDoc(url: string, title: string): string {
  return `${PREFIXES}<${url}> dct:title "${title}" .`;
}

/** The complete demo pod contents (URL → Turtle). */
export function demoFixtures(): Record<string, string> {
  return {
    [`${DEMO_POD}profile/card`]: adaProfile(),
    [`${DEMO_POD}profile/card.acl`]: profileCardAcl(),
    [`${DEMO_POD}.acl`]: rootAcl(),
    [`${HEALTH}.acl`]: healthAcl(),
    [BLOOD]: healthDoc(BLOOD, "Blood test results"),
    [PANEL]: healthDoc(PANEL, "Metabolic panel results"),
    [NOTES]: healthDoc(NOTES, "Care notes"),
    [DIARY]: healthDoc(DIARY, "Symptom diary"),
    [`${DEMO_POD}settings/publicTypeIndex.ttl`]: publicTypeIndex(),
    [DEMO_REQUEST]: clinicRequest(),
    [`${DEMO_GRANTS}grant-${BEX_GRANT_ID}.ttl`]: bexGrant(),
    [`${DEMO_GRANTS}grant-${CLINIC_GRANT_ID}.ttl`]: clinicGrant(),
    [`${DEMO_RECEIPTS}receipt-${BEX_GRANT_ID}.ttl`]: bexReceipt(),
    [`${DEMO_RECEIPTS}receipt-${CLINIC_GRANT_ID}.ttl`]: clinicReceipt(),
    [`${DEMO_RECEIPTS}receipt-${OLD_CLINIC_GRANT_ID}.ttl`]: oldClinicReceipt(),
    // Dr. Bex's + the Clinic App's identity docs (display names only).
    ["https://bex.example/profile/card"]: bexProfile(),
    ["https://clinic.example/id"]: clinicProfile(),
  };
}

/**
 * The demo session: Ada's WebID over the read-only fixture pod. The same
 * `{ webId, fetch }` seam the real LoginController fills — with a fetch that
 * can only read fixtures and throws on any write.
 */
export function createDemoSession(): { session: Session; pod: DemoPod } {
  const pod = createDemoPod(demoFixtures());
  return { session: { webId: ADA, fetch: pod.fetch }, pod };
}
