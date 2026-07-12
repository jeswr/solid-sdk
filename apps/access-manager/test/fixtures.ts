// AUTHORED-BY Claude Fable 5
//
// Shared fixture pod: an owner with a profile (storage + inbox + type
// indexes), a root ACL (owner Control, accessTo + default), an inherited
// subtree, a directly-shared document (bob + public), a type-indexed contacts
// class, and an ODRL-shaped pending access request in the inbox.

import { createPodStub, type PodStub } from "./pod-stub.js";

export const POD = "https://pod.example/";
export const OWNER = "https://pod.example/profile/card#me";
export const BOB = "https://bob.example/profile/card#me";
export const REQUESTER = "https://app.example/agents/reader#it";
export const CONTACTS_CLASS = "http://www.w3.org/2006/vcard/ns#Individual";

export const GRANTS = `${POD}access-manager/grants/`;
export const RECEIPTS = `${POD}access-manager/receipts/`;
export const INBOX = `${POD}inbox/`;

export const PREFIXES = `
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
@prefix dpv: <https://w3id.org/dpv#> .
@prefix accm: <https://w3id.org/jeswr/accm#> .
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
