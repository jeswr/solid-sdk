// AUTHORED-BY Codex GPT-6.1-Sol
// Vocabulary and typed mutation pattern ported from apps/access-manager/src/lib/{acl,records}.ts.
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { HomeSubject } from "../model/rdf";

export const ACL = "http://www.w3.org/ns/auth/acl#";
export const ACP = "http://www.w3.org/ns/solid/acp#";
export const DPV = "https://w3id.org/dpv#";
export const ODRL = "http://www.w3.org/ns/odrl/2/";
export const PUBLIC = "http://xmlns.com/foaf/0.1/Agent";
export const AUTHENTICATED = `${ACL}AuthenticatedAgent`;
export const SCOPES = ["accessTo", "default", "defaultForNew"] as const;
export const SELECTORS = ["agent", "agentClass", "agentGroup", "origin"] as const;
export class AccessNode extends HomeSubject {
  values(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}
export class UnsupportedAccessError extends Error {
  override name = "UnsupportedAccessError";
  constructor() {
    super("This access policy cannot be safely interpreted or changed");
  }
}
