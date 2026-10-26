// AUTHORED-BY Codex GPT-6.1-Sol
import type { Term } from "@rdfjs/types";
import { DatasetWrapper, NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import {
  AccessControl,
  AccessControlResource,
  Authorization,
  Matcher,
  Policy,
} from "@solid/object";
import { DataFactory, Store } from "n3";
import type { AccessDocument, ResourceAccess, SharingInput } from "../src/apps/drive/lib/sharing";

export const ACL = "http://www.w3.org/ns/auth/acl#";
export const ACP = "http://www.w3.org/ns/solid/acp#";
export const PUBLIC = "http://xmlns.com/foaf/0.1/Agent";
export const FILE = "https://example.org/drive/report";
export const ALICE = "https://example.org/alice#me";
export const BOB = "https://example.org/bob#me";
export const CAROL = "https://example.org/carol#me";
export const COMMENTS = "https://example.org/drive/report-comments/";
export class Properties extends TermWrapper {
  values(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}
export function document(
  model: "wac" | "acp" = "wac",
  inherited = false,
  resource = FILE,
): AccessDocument {
  return {
    model,
    inherited,
    governingResource: inherited ? "https://example.org/drive/" : resource,
    source: `${inherited ? "https://example.org/drive/" : resource}.${model === "wac" ? "acl" : "acr"}`,
    dataset: new Store(),
  };
}
export function context(doc: AccessDocument): ResourceAccess {
  return { resource: doc.inherited ? FILE : doc.governingResource, documents: [doc] };
}
export function input(doc = document()): SharingInput {
  return { access: context(doc) };
}
export function authorization(
  doc: AccessDocument,
  principal: string,
  modes: string[],
  target = doc.governingResource,
): Authorization {
  const auth = new Authorization(DataFactory.blankNode(), doc.dataset, DataFactory);
  auth.type.add(`${ACL}Authorization`);
  if (doc.inherited) auth.default = target;
  else auth.accessTo = target;
  if (principal === PUBLIC) auth.agentClass.add(PUBLIC);
  else auth.agent.add(principal);
  for (const mode of modes) auth.mode.add(ACL + mode);
  return auth;
}
export function matcher(doc: AccessDocument, agents: string[]): Matcher {
  const match = new Matcher(DataFactory.blankNode(), doc.dataset, DataFactory);
  for (const agent of agents) match.agent.add(agent === PUBLIC ? `${ACP}PublicAgent` : agent);
  return match;
}
export function policy(
  doc: AccessDocument,
  principal: string,
  modes: string[],
  target = doc.governingResource,
): Policy {
  const acr = new AccessControlResource(DataFactory.blankNode(), doc.dataset, DataFactory);
  acr.resource = target;
  const control = new AccessControl(DataFactory.blankNode(), doc.dataset, DataFactory);
  (doc.inherited ? acr.memberAccessControl : acr.accessControl).add(control);
  const p = new Policy(DataFactory.blankNode(), doc.dataset, DataFactory);
  control.apply.add(p);
  for (const mode of modes) p.allow.add(ACL + mode);
  p.allOf.add(matcher(doc, [principal]));
  return p;
}
export function properties(node: TermWrapper): Properties {
  return new Properties(node as Term, node.dataset, node.factory);
}

export class FixtureAcrs extends DatasetWrapper {
  get resources(): Iterable<AccessControlResource> {
    return this.subjectsOf(`${ACP}resource`, AccessControlResource);
  }
}
