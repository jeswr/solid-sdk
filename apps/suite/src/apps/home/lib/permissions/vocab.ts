// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Vocabulary and typed mutation pattern ported from apps/access-manager/src/lib/{acl,records}.ts.

import type { Grant, Subject } from "@jeswr/pod-access";
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { Writer } from "n3";
import { HomeSubject } from "../model/rdf";

export const ACL = "http://www.w3.org/ns/auth/acl#";
export const ACP = "http://www.w3.org/ns/solid/acp#";
export const DPV = "https://w3id.org/dpv#";
export const ODRL = "http://www.w3.org/ns/odrl/2/";
export const PUBLIC = "http://xmlns.com/foaf/0.1/Agent";
export const AUTHENTICATED = `${ACL}AuthenticatedAgent`;
export const SCOPES = ["accessTo", "default", "defaultForNew"] as const;
export const SELECTORS = ["agent", "agentClass", "agentGroup", "origin"] as const;
/** These atoms describe possible restrictions, never proof of narrower exposure. */
export function isExposureCondition(subject: Subject): boolean {
  return ["origin", "client", "issuer"].includes(subject.kind);
}
/** Order-independent conjunction identity, without parser-local source labels. */
export function clauseSignature(clause: readonly Subject[]): string {
  return JSON.stringify(
    [...new Set(clause.map((s) => JSON.stringify(Object.entries(s).sort())))].sort(),
  );
}
/** Scope and target are matched separately: one rule can govern several selected scopes. */
export function grantSignature(grant: Pick<Grant, "who" | "except" | "modes">): string {
  const modes = new Set(grant.modes);
  if (modes.has("write")) modes.add("append");
  return JSON.stringify([
    [...new Set(grant.who.map(clauseSignature))].sort(),
    clauseSignature(grant.except),
    [...modes].sort(),
  ]);
}
/** Copy a description, including nested blank nodes, for isomorphic comparison. */
export function authorizationQuads(dataset: DatasetCore, root: Term): Quad[] {
  const queue = [root];
  const seen = new Set<string>();
  const quads: Quad[] = [];
  for (const subject of queue) {
    if (seen.has(subject.value)) continue;
    seen.add(subject.value);
    for (const quad of dataset.match(subject)) {
      quads.push(quad);
      if (quad.object.termType === "BlankNode") queue.push(quad.object);
    }
  }
  return quads;
}
export function authorizationTurtle(dataset: DatasetCore, root: Term): string {
  return new Writer().quadsToString(authorizationQuads(dataset, root));
}
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
