// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Fable 5
// AUTHORED-BY Claude Opus 5.5
//
// Shared fixture pod: an owner with a profile (storage + inbox + type
// indexes), a root ACL (owner Control, accessTo + default), an inherited
// subtree, a directly-shared document (bob + public), a type-indexed contacts
// class, and an ODRL-shaped pending access request in the inbox.

import { Parser, Store } from "n3";
import { deriveGrantId } from "../../src/requests-solid/approval.js";
import { set, turtle } from "../../src/requests-solid/rdf.js";
import { ACCM } from "../../src/requests-solid/vocab.js";
import { createPodStub, type PodStub } from "./pod-stub.js";

export const POD = "https://pod.example/";
export const OWNER = "https://pod.example/profile/card#me";
export const BOB = "https://bob.example/profile/card#me";
export const REQUESTER = "https://app.example/agents/reader#it";
export const CONTACTS_CLASS = "http://www.w3.org/2006/vcard/ns#Individual";

export const GRANTS = `${POD}access-manager/grants/`;
export const RECEIPTS = `${POD}access-manager/receipts/`;
export const INBOX = `${POD}inbox/`;
/** The owner-only folder holding decision records, grants and receipts. */
export const RECORDS = `${POD}settings/access-records/`;
/** The fixture pod's pending request. */
export const REQUEST = `${INBOX}request-1.ttl`;

export const PREFIXES = `
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
@prefix dpv: <https://w3id.org/dpv#> .
@prefix accm: <https://jeswr.org/ns/accm#> .
@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
`;

export function rootAclTurtle(): string {
  return `${PREFIXES}
<${POD}.acl#owner> a acl:Authorization ;
  acl:agent <${OWNER}> ;
  acl:accessTo <${POD}> ;
  acl:default <${POD}> ;
  acl:mode acl:Read, acl:Write, acl:Control .
`;
}

export function profileTurtle(): string {
  return `${PREFIXES}
<${OWNER}> a foaf:Person ;
  foaf:name "Owner O." ;
  pim:storage <${POD}> ;
  ldp:inbox <${INBOX}> ;
  solid:publicTypeIndex <${POD}settings/publicTypeIndex.ttl> ;
  solid:oidcIssuer <https://idp.example/> .
`;
}

export function publicTypeIndexTurtle(): string {
  return `${PREFIXES}
<${POD}settings/publicTypeIndex.ttl#contacts> a solid:TypeRegistration ;
  solid:forClass vcard:Individual ;
  solid:instanceContainer <${POD}contacts/> .
`;
}

/** A well-formed ODRL access request for the contacts data class. */
export function accessRequestTurtle(requestUrl: string): string {
  return `${PREFIXES}
<${requestUrl}> a odrl:Offer ;
  odrl:uid <${requestUrl}> ;
  accm:dataClass <${CONTACTS_CLASS}> ;
  odrl:permission [
    odrl:assignee <${REQUESTER}> ;
    odrl:action odrl:read ;
    odrl:target <${CONTACTS_CLASS}> ;
    odrl:constraint [
      odrl:leftOperand odrl:purpose ;
      odrl:operator odrl:eq ;
      odrl:rightOperand <https://w3id.org/dpv#ServiceProvision>
    ] , [
      odrl:leftOperand odrl:dateTime ;
      odrl:operator odrl:lteq ;
      odrl:rightOperand "2027-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>
    ]
  ] .
`;
}

/** A document .acl directly sharing with bob (Read) and the public (Read). */
export function reportAclTurtle(): string {
  const url = `${POD}docs/report.ttl`;
  return `${PREFIXES}
<${url}.acl#owner> a acl:Authorization ;
  acl:agent <${OWNER}> ;
  acl:accessTo <${url}> ;
  acl:mode acl:Read, acl:Write, acl:Control .
<${url}.acl#shared> a acl:Authorization ;
  acl:agent <${BOB}> ;
  acl:agentClass foaf:Agent ;
  acl:accessTo <${url}> ;
  acl:mode acl:Read .
`;
}

/** Build the standard pod. */
export function buildPod(): PodStub {
  const pod = createPodStub();
  pod.seed(`${POD}.acl`, rootAclTurtle());
  pod.seed(`${POD}profile/card`, profileTurtle());
  pod.seed(`${POD}settings/publicTypeIndex.ttl`, publicTypeIndexTurtle());
  pod.seed(
    `${POD}contacts/alice.ttl`,
    `${PREFIXES}<${POD}contacts/alice.ttl#it> a vcard:Individual .`,
  );
  pod.seed(
    `${POD}contacts/carol.ttl`,
    `${PREFIXES}<${POD}contacts/carol.ttl#it> a vcard:Individual .`,
  );
  pod.seed(`${POD}docs/report.ttl`, `${PREFIXES}<${POD}docs/report.ttl> a foaf:Document .`);
  pod.seed(`${POD}docs/report.ttl.acl`, reportAclTurtle());
  pod.seed(`${INBOX}request-1.ttl`, accessRequestTurtle(`${INBOX}request-1.ttl`));
  return pod;
}

/** The records key sealed into a pod's records folder ACL (parsed as RDF), if it has one. */
export function sealedKey(pod: PodStub): string | undefined {
  const acl = `${RECORDS}.acl`;
  const body = pod.body(acl);
  if (body === undefined) return undefined;
  const store = new Store(new Parser({ baseIRI: acl }).parse(body));
  return store.getObjects(acl, `${ACCM.ns}recordsKey`, null)[0]?.value;
}

/** What a request asks for, by data type, as the inbox projects it. */
export type Asked = Record<string, readonly string[]>;

/**
 * The URL of the owner's decision record for a request, derived exactly as `decide()` does from
 * the pod's sealed records key, the request id, its requester, what it asks for and the
 * generation (0 for the first decision at that request URL).
 */
export async function decisionUrl(
  pod: PodStub,
  {
    id = REQUEST,
    requester = REQUESTER,
    asked = { [CONTACTS_CLASS]: ["read"] },
    generation = 0,
    key = sealedKey(pod),
  }: {
    id?: string;
    requester?: string;
    asked?: Asked;
    generation?: number;
    key?: string | undefined;
  } = {},
): Promise<string> {
  if (key === undefined) throw new Error("The records folder is not sealed yet");
  const name = await deriveGrantId(
    id,
    [
      `key ${key}`,
      `agent ${requester}`,
      `generation ${generation}`,
      ...Object.entries(asked).map(([type, modes]) => `${type} ${[...modes].sort().join(",")}`),
    ],
    OWNER,
    "decision-1",
  );
  return `${RECORDS}decision-${name}.ttl`;
}

/** The grant id `decide()` derives for an approval recorded at `slot`. */
export const grantIdFor = (slot: string, targets: readonly string[]) =>
  deriveGrantId(slot, targets, OWNER);

/** The receipt URL of a denial recorded at `slot`. */
export const denialReceiptUrl = async (slot: string) =>
  `${RECORDS}receipt-${await deriveGrantId(slot, [], OWNER, "denial")}.ttl`;

/** The name the previous design gave a pinned decision; only ever planted by tests now. */
export const legacyIntentUrl = async (id = REQUEST) =>
  `${RECORDS}intent-${await deriveGrantId(id, [`agent ${REQUESTER}`, `${CONTACTS_CLASS} read`], OWNER, "intent-2")}.ttl`;

/** Serialise a decision record (or a forgery of one) with n3, as the owner would store it. */
export async function recordTurtle(
  url: string,
  {
    id = REQUEST,
    outcome,
    snapshot,
  }: { id?: string; outcome?: string; snapshot?: string | object },
): Promise<string> {
  const dataset = new Store();
  set(dataset, url, ACCM.requestRef, id, true);
  if (outcome !== undefined) set(dataset, url, `${ACCM.ns}outcome`, outcome);
  if (snapshot !== undefined)
    set(
      dataset,
      url,
      `${ACCM.ns}snapshot`,
      typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot),
    );
  return turtle(dataset);
}
