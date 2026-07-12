// AUTHORED-BY Claude Fable 5
//
// The Ada & Bex demo scenario — INERT SAMPLE DATA for the ?demo mode, matching
// the Solid Walkthrough narrative exactly:
//   • Ada owns a pod with a /health/ folder (results, notes, a symptom diary).
//   • /health/ is shared with Dr. Bex (Read, a DIRECT grant on the folder,
//     with acl:default) — so Bex reads every file INSIDE /health/ by
//     INHERITANCE. WAC inheritance preserves the authorized AGENT: the
//     inherited access on the health files is attributed to DR. BEX, never
//     transferred to any app. /profile/card is public (Read, direct).
//   • The Clinic App holds NO active grant. It was granted once before, Ada
//     REVOKED it (see history), and it is now RE-requesting: the inbox holds
//     its ONE pending request (Read, the "health" data class, requested term
//     30 days, purpose: care coordination) — resolved to the concrete file
//     list before approval. While pending it must NOT appear as an authorized
//     agent anywhere.
//   • History carries the consent receipts: shared /health/ with Dr. Bex
//     (Read); approved the Clinic App — health data (Read, 30-day term);
//     revoked the Clinic App's access. The 30-day term is the
//     REQUESTED/RECORDED term on the request/receipt — plain WAC has no
//     server-side temporal enforcement, so a grant persists until REVOKED
//     (as the revocation receipt shows).
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
/** The Clinic App — NO active grant (revoked once); ONE pending re-request. */
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
/** The Clinic App's ONE past grant: approved 2026-04-14, revoked 2026-05-02. */
const REVOKED_CLINIC_GRANT_ID = "5d0a3c9b1e88";

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
 * /health/ ACL — the heart of the scenario. ONE non-owner authorization:
 *   #bex → Dr. Bex reads the folder (direct, acl:accessTo) and, via
 *          acl:default, everything inside it — so every health file shows
 *          Read access INHERITED from the folder grant, attributed to DR. BEX.
 * WAC inheritance preserves the authorized agent; it never transfers a grant
 * to another party. The Clinic App has NO entry here: its request is only
 * PENDING in the inbox (its previous grant was revoked — see the receipts).
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
 * The ONE pending inbox request: the Clinic App RE-asks for Read on Ada's
 * health data (its earlier grant was revoked — see the receipts), requested
 * term 30 days, purpose care coordination. No accm:status → Pending. The
 * dateTime constraint is the REQUESTED term (recorded metadata, not a
 * server-enforced expiry — plain WAC has none).
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

/**
 * The Clinic App's PAST grant record — approved 2026-04-14, REVOKED
 * 2026-05-02 (accm:revokedAt ⇒ never listed among active grants). Kept as the
 * audit-trail snapshot the revocation pipeline leaves behind. The dateTime
 * constraint is the RECORDED 30-day requested term (2026-04-14 → 2026-05-14):
 * metadata only, never a server-enforced expiry — the grant ended because Ada
 * revoked it, not because the term lapsed.
 */
function revokedClinicGrant(): string {
  const url = `${DEMO_GRANTS}grant-${REVOKED_CLINIC_GRANT_ID}.ttl`;
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
      odrl:rightOperand "2026-05-14T00:00:00Z"^^xsd:dateTime
    ]
  ] ;
  accm:grantId "${REVOKED_CLINIC_GRANT_ID}" ;
  accm:schemaVersion "1" ;
  accm:agent <${CLINIC}> ;
  accm:resolvesTo <${BLOOD}>, <${PANEL}> ;
  accm:mode acl:Read ;
  dct:created "2026-04-14T10:15:00Z"^^xsd:dateTime ;
  accm:revokedAt "2026-05-02T08:45:00Z"^^xsd:dateTime .
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

/**
 * Receipt: "Approved Clinic App — health data (Read, 30-day term)" … then
 * "Revoked Clinic App access". ONE receipt document, exactly as the app's own
 * revocation pipeline leaves it: dct:created keeps the approval date (the
 * "Approved" history beat, with the purpose + the recorded 30-day term via
 * the linked grant record), and the CAS revocation flip added
 * dpv:ConsentWithdrawn + accm:revokedAt (the "Revoked" beat).
 */
function revokedClinicReceipt(): string {
  const url = `${DEMO_RECEIPTS}receipt-${REVOKED_CLINIC_GRANT_ID}.ttl`;
  return `${PREFIXES}
<${url}> a dpv:ConsentRecord ;
  dpv:hasDataSubject <${ADA}> ;
  dpv:hasRecipient <${CLINIC}> ;
  dpv:hasPurpose <${CARE_COORDINATION}> ;
  dpv:hasConsentStatus dpv:ConsentWithdrawn ;
  dpv:hasLegalBasis dpv:Consent ;
  accm:grantId "${REVOKED_CLINIC_GRANT_ID}" ;
  accm:grantRef <${DEMO_GRANTS}grant-${REVOKED_CLINIC_GRANT_ID}.ttl> ;
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
    [`${DEMO_GRANTS}grant-${REVOKED_CLINIC_GRANT_ID}.ttl`]: revokedClinicGrant(),
    [`${DEMO_RECEIPTS}receipt-${BEX_GRANT_ID}.ttl`]: bexReceipt(),
    [`${DEMO_RECEIPTS}receipt-${REVOKED_CLINIC_GRANT_ID}.ttl`]: revokedClinicReceipt(),
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
