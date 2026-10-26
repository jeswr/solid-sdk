// AUTHORED-BY Codex GPT-6.1-Sol
import type { Term } from "@rdfjs/types";
import { DatasetWrapper, NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import {
  AccessControlResource,
  AclResource,
  Authorization,
  type Matcher,
  type Policy,
} from "@solid/object";
import { DataFactory } from "n3";
import type { AccessDocument, AccessMode, ResourceAccess } from "./types";

const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP = "http://www.w3.org/ns/solid/acp#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
// Internal discriminator, never written as an RDF term.
export const PUBLIC = "public";
const FOAF_AGENT = "http://xmlns.com/foaf/0.1/Agent";
export const MODES: readonly AccessMode[] = ["Read", "Write", "Append", "Control"];

export class SharingError extends Error {}
export interface Grant {
  principal: string;
  modes: Set<AccessMode>;
  document: AccessDocument;
  resource: string;
}

class ScopedAuthorization extends Authorization {
  values(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}
class ScopedAcr extends AccessControlResource {
  get resourceAll(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${ACP}resource`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
class Acrs extends DatasetWrapper {
  get resources(): Iterable<ScopedAcr> {
    return this.subjectsOf(`${ACP}resource`, ScopedAcr);
  }
}

function modes(values: Iterable<string>): Set<AccessMode> {
  const result = new Set<AccessMode>();
  for (const value of values) {
    const mode = MODES.find((candidate) => value === ACL + candidate);
    if (!mode) throw new SharingError("Unsupported access mode");
    result.add(mode);
  }
  return result;
}

function ancestor(parent: string, child: string): boolean {
  return parent.endsWith("/") && child !== parent && child.startsWith(parent);
}

function checkContext(context: ResourceAccess): void {
  const explicit = context.documents.filter((document) => !document.inherited);
  if (
    explicit.length > 1 ||
    (context.documents.some((d) => d.model === "wac") && context.documents.length > 1)
  ) {
    throw new SharingError("Supply the resolved effective ACL or own ACR plus ancestor ACRs");
  }
  for (const document of context.documents) {
    if (
      document.inherited
        ? !ancestor(document.governingResource, context.resource)
        : document.governingResource !== context.resource
    ) {
      throw new SharingError("Invalid governing resource");
    }
    for (const quad of document.dataset) {
      if (quad.graph.termType !== "DefaultGraph")
        throw new SharingError("Supply one document in the default graph");
    }
  }
}

function wac(document: AccessDocument, resource: string): Grant[] {
  const result: Grant[] = [];
  for (const auth of new AclResource(document.dataset, DataFactory).authorizations) {
    const scoped = new ScopedAuthorization(auth as Term, document.dataset, DataFactory);
    const targets = scoped.values(ACL + (document.inherited ? "default" : "accessTo"));
    if (!targets.has(document.governingResource)) continue;
    if (auth.origin.size || scoped.values(`${ACL}agentGroup`).size) {
      throw new SharingError("Conditional or group WAC grants cannot be summarized");
    }
    const principals = [...auth.agent];
    for (const agentClass of auth.agentClass) {
      if (agentClass !== FOAF_AGENT) throw new SharingError("Unsupported WAC agent class");
      principals.push(PUBLIC);
    }
    const allowed = modes(auth.mode);
    for (const principal of principals)
      result.push({ principal, modes: allowed, document, resource });
  }
  return result;
}

function matcherAgents(matcher: Matcher): Set<string> {
  // ACP matchers are extensible. Unknown attributes must never become unconditional grants.
  for (const quad of matcher.dataset.match(matcher as Term)) {
    if (quad.predicate.value !== `${ACP}agent` && quad.predicate.value !== RDF_TYPE) {
      throw new SharingError("Conditional ACP matchers cannot be summarized");
    }
  }
  const agents = new Set<string>();
  for (const agent of matcher.agent) {
    if (agent === `${ACP}PublicAgent`) agents.add(PUBLIC);
    else if (agent.startsWith(ACP)) throw new SharingError("Unsupported ACP special agent");
    else agents.add(agent);
  }
  return agents;
}

function policyAgents(policy: Policy): Set<string> {
  if (policy.deny.size || policy.noneOf.size)
    throw new SharingError("ACP deny/noneOf requires a richer access model");
  let agents: Set<string> | undefined;
  for (const matcher of policy.allOf) {
    const values = matcherAgents(matcher);
    agents = agents === undefined ? values : intersect(agents, values);
  }
  const any = [...policy.anyOf];
  if (any.length) {
    const values = new Set(any.flatMap((matcher) => [...matcherAgents(matcher)]));
    agents = agents === undefined ? values : intersect(agents, values);
  }
  return agents ?? new Set();
}

function intersect(left: Set<string>, right: Set<string>): Set<string> {
  if (left.has(PUBLIC)) return right;
  if (right.has(PUBLIC)) return left;
  return new Set([...left].filter((value) => right.has(value)));
}

function acp(document: AccessDocument, resource: string): Grant[] {
  const result: Grant[] = [];
  for (const acr of new Acrs(document.dataset, DataFactory).resources) {
    // Include explicit permissions on the ACR itself to recognize policy editors.
    const targets = acr.resourceAll;
    const management = !document.inherited && targets.has(document.source);
    const applies = targets.has(document.governingResource);
    if (!management && !applies) continue;
    const controls = document.inherited ? acr.memberAccessControl : acr.accessControl;
    for (const control of controls) {
      for (const policy of control.apply) {
        const allowed = modes(policy.allow);
        if (allowed.has("Control"))
          throw new SharingError("ACP policy management uses Read+Write on the ACR");
        for (const principal of policyAgents(policy)) {
          for (const target of new Set([
            ...(applies ? [resource] : []),
            ...(management ? [document.source] : []),
          ])) {
            result.push({ principal, modes: allowed, document, resource: target });
          }
        }
      }
    }
  }
  return result;
}

/** Wrappers can reject malformed foreign terms. Surface failure, never a misleading empty summary. */
export function readGrants(context: ResourceAccess): Grant[] {
  checkContext(context);
  try {
    return context.documents.flatMap((document) =>
      document.model === "wac" ? wac(document, context.resource) : acp(document, context.resource),
    );
  } catch (error) {
    if (error instanceof SharingError) throw error;
    throw new SharingError("Malformed authorization RDF", { cause: error });
  }
}
