// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
// Adapted from Drive sharing/{rdf,sharing,apply}.ts (Codex GPT-6.1-Sol / Codex),
// origin/main and claude/project-thread-okz5l7. No dependency on the application.
import type { DatasetCore, Term } from "@rdfjs/types";
import { DatasetWrapper, SetFrom } from "@rdfjs/wrapper";
import { AccessControlResource, AclResource, type Matcher, Policy } from "@solid/object";
import { DataFactory, Store } from "n3";
import { ACL, ACP, FOAF, modeIri, RDF, RdfNode, readModes } from "../rdf.js";
import { readWac } from "../systems/wac.js";
import type { EffectivePolicy, Grant, Mode, PodImplementation, Subject } from "../types.js";
import { roleError } from "./errors.js";
import type { AgentRef } from "./types.js";

export const MATERIALIZED_FROM = "https://jeswr.org/ns/pod-access#materializedFrom";

/** Role-local provenance; the offline policy API keeps its existing grant shape. */
export interface RolePolicy extends EffectivePolicy {
  grants: (Grant & { ownAcrManagement?: boolean })[];
}

export class Properties extends RdfNode {
  terms(predicate: string) {
    return SetFrom.subjectPredicate(
      this,
      predicate,
      (term) => term as Term,
      (term: Term) => term,
    );
  }
  values(predicate: string) {
    return SetFrom.subjectPredicate(
      this,
      predicate,
      (term) => {
        if (term.termType !== "NamedNode") throw new TypeError("IRI required");
        return term.value;
      },
      (value: string) => DataFactory.namedNode(value),
    );
  }
}
class Acrs extends DatasetWrapper {
  get resources() {
    return this.subjectsOf(`${ACP}resource`, AccessControlResource);
  }
  get typed() {
    return this.subjectsOf(`${RDF}type`, AccessControlResource);
  }
}
export function properties(term: Term, dataset: DatasetCore): Properties {
  return new Properties(term, dataset, DataFactory);
}
export function roots(dataset: DatasetCore): AccessControlResource[] {
  const all = new Acrs(dataset, DataFactory);
  const values = new Map<string, AccessControlResource>();
  for (const root of [...all.resources, ...all.typed]) {
    if (
      properties(root as Term, dataset).iris(`${ACP}resource`).length ||
      root.type.has(`${ACP}AccessControlResource`)
    )
      values.set(JSON.stringify([root.termType, root.value]), root);
  }
  return [...values.values()];
}
/** Clone via typed setters, retaining annotations and foreign targets without building quads. */
function clone(term: Term, from: DatasetCore, to: DatasetCore, exclude: string[]): Properties {
  const result = properties(DataFactory.blankNode(), to);
  const original = properties(term, from);
  for (const predicate of new Set([...from.match(term)].map((q) => q.predicate.value)))
    if (!exclude.includes(predicate))
      for (const object of original.terms(predicate)) result.terms(predicate).add(object);
  return result;
}
export function agentSubject(agent: AgentRef): Subject {
  switch (agent.type) {
    case "webid":
      return { kind: "agent", webId: agent.id };
    case "group":
      return { kind: "group", group: agent.id };
    case "app":
      return { kind: "client", clientId: agent.id };
    default:
      return { kind: agent.type };
  }
}
export function subjectAgent(subject: Subject): AgentRef {
  switch (subject.kind) {
    case "agent":
      return { type: "webid", id: subject.webId };
    case "group":
      return { type: "group", id: subject.group };
    case "client":
      return { type: "app", id: subject.clientId };
    case "public":
    case "authenticated":
      return { type: subject.kind };
    default:
      throw roleError(
        "unsupported",
        "",
        "Conditional or special principals need a richer policy model",
      );
  }
}
export function agentKey(agent: AgentRef): string {
  return JSON.stringify("id" in agent ? [agent.type, agent.id] : [agent.type]);
}
function allowed(
  iris: Iterable<string>,
  model: "wac" | "acp",
  implementation: PodImplementation,
): Set<Mode> {
  const vocabulary = model === "acp" && implementation === "ess" ? ACP : ACL;
  const raw = [...iris];
  if (
    raw.some(
      (iri) =>
        !["read", "append", "write", "control"].some(
          (mode) => modeIri(mode as Mode).replace(ACL, vocabulary) === iri,
        ),
    )
  )
    throw new TypeError("Unknown access mode");
  return readModes(raw.map((iri) => iri.replace(vocabulary, ACL)));
}
function matcherSubjects(matcher: Matcher, implementation: PodImplementation): Subject[] {
  for (const q of matcher.dataset.match(matcher as Term))
    if (![`${RDF}type`, `${ACP}agent`, `${ACP}client`].includes(q.predicate.value))
      throw new TypeError("Conditional ACP matcher");
  if (matcher.client.size) {
    // PublicAgent is conjunction's identity. It activates ESS client matchers
    // without turning an app grant into a public grant.
    if (implementation === "ess" && !matcher.agent.size)
      throw new TypeError("ESS client matchers require an agent");
    if (matcher.agent.size && !matcher.agent.has(`${ACP}PublicAgent`))
      throw new TypeError("Conjoined ACP attributes");
    return [...matcher.client].map((clientId): Subject => {
      if (clientId.startsWith(ACP)) throw new TypeError("Unsupported special ACP client");
      return { kind: "client", clientId };
    });
  }
  return [
    ...[...matcher.agent].map((webId): Subject => {
      if (webId === `${ACP}PublicAgent`) return { kind: "public" };
      if (webId === `${ACP}AuthenticatedAgent`) return { kind: "authenticated" };
      if (webId.startsWith(ACP)) throw new TypeError("Unsupported special ACP agent");
      return { kind: "agent", webId };
    }),
  ];
}
function policySubjects(policy: Policy, implementation: PodImplementation): Subject[][] {
  if (policy.deny.size || policy.noneOf.size)
    throw new TypeError("ACP denial or exclusion needs a richer policy model");
  let result: Map<string, Subject> | undefined;
  const intersect = (values: Subject[]) => {
    const next = new Map(values.map((s) => [agentKey(subjectAgent(s)), s]));
    if (result === undefined || result.has('["public"]')) result = next;
    else if (!next.has('["public"]')) {
      // Distinct selectors can overlap even when their principal keys differ
      // (agent AND client, named agent AND authenticated, etc.). Never mistake
      // that conjunction for an inert policy or split it into unconditional rows.
      if (
        result.size &&
        next.size &&
        (result.size !== next.size || [...result.keys()].some((key) => !next.has(key)))
      )
        throw new TypeError("Conjoined ACP selectors need a richer policy model");
      if (!next.size) result.clear();
    }
  };
  for (const matcher of policy.allOf) intersect(matcherSubjects(matcher, implementation));
  if (policy.anyOf.size)
    intersect([...policy.anyOf].flatMap((matcher) => matcherSubjects(matcher, implementation)));
  // ESS's login requirement applies to the whole policy when any matcher has
  // clients, including a public anyOf alternative. Splitting that alternative
  // into a client-free policy (or removing its last client) would grant anonymous
  // access. Refuse projections that cannot retain this policy-level condition.
  if (
    implementation === "ess" &&
    result?.has('["public"]') &&
    [...policy.allOf, ...policy.anyOf].some((matcher) => matcher.client.size)
  )
    throw new TypeError("ESS client policy login requirements need a richer policy model");
  return [...(result?.values() ?? [])].map((subject) => [subject]);
}
/** Only ESS treats an ACR-self binding as management of the subject resource. */
function ownAcpTarget(
  target: string,
  resource: string,
  url: string,
  implementation: PodImplementation,
): boolean {
  return target === resource || (implementation === "ess" && target === url);
}
/** Role projection is a closed, unconditional subset; reject shapes it cannot preserve. */
export function readPolicy(
  dataset: Store,
  resource: string,
  url: string,
  model: "wac" | "acp",
  implementation: PodImplementation,
  selectedResource = resource,
): RolePolicy {
  for (const q of dataset) {
    if (q.graph.termType !== "DefaultGraph")
      throw new TypeError("Access RDF must use the default graph");
    const namespace = model === "wac" ? ACL : ACP;
    const names =
      model === "wac"
        ? [
            "accessTo",
            "default",
            "defaultForNew",
            "agent",
            "agentClass",
            "agentGroup",
            "mode",
            "origin",
          ]
        : [
            "resource",
            "accessControl",
            "memberAccessControl",
            "access",
            "memberAccess",
            "apply",
            "allow",
            "deny",
            "allOf",
            "anyOf",
            "noneOf",
            "agent",
            "client",
          ];
    if (
      q.predicate.value.startsWith(namespace) &&
      !names.some((name) => namespace + name === q.predicate.value)
    )
      throw new TypeError("Unknown access-control construct");
  }
  if (model === "wac") {
    for (const auth of new AclResource(dataset, DataFactory).authorizations)
      allowed(auth.mode, model, implementation);
    return readWac(dataset, resource, url, implementation);
  }
  const result: RolePolicy = { grants: [], denials: [] };
  const visited = new Set<string>();
  const visit = (term: Term) => visited.add(JSON.stringify([term.termType, term.value]));
  for (const root of roots(dataset)) {
    visit(root as Term);
    const node = properties(root as Term, dataset);
    const resources = node.iris(`${ACP}resource`);
    if (resources.length > 1) throw new TypeError("Ambiguous ACP target");
    const target = resources[0] ?? resource;
    if (!resources.length && root.value !== url) throw new TypeError("Unplaced ACP root");
    if (implementation !== "ess") {
      if (!resources.length) throw new TypeError("CSS ACP roots require a resource binding");
      if (target !== resource && root.memberAccessControl.size)
        throw new TypeError("Foreign CSS member controls need a richer scope model");
      if (target !== resource && target === selectedResource && root.accessControl.size)
        throw new TypeError(
          "CSS ancestor binding to the selected resource needs a richer scope model",
        );
      if (node.nodes(`${ACP}access`).length || node.nodes(`${ACP}memberAccess`).length)
        throw new TypeError("CSS management requires resource Control");
    }
    function add(policy: Policy, scope: Grant["appliesTo"], management: boolean) {
      visit(policy as Term);
      for (const matcher of [...policy.allOf, ...policy.anyOf, ...policy.noneOf])
        visit(matcher as Term);
      const who = policySubjects(policy, implementation);
      const modes = allowed(policy.allow, model, implementation);
      if (management) {
        if (modes.size && (modes.has("control") || !(modes.has("read") && modes.has("write"))))
          throw new TypeError("Partial ACR management");
        modes.clear();
        if (policy.allow.size) modes.add("control");
      } else if (implementation === "ess" && modes.has("control"))
        throw new TypeError("ACP management requires own ACR Read+Write");
      if (!ownAcpTarget(target, resource, url, implementation)) return;
      result.grants.push({
        modes,
        who,
        except: [],
        appliesTo: scope,
        source: { url, node: policy.value },
        // The same policy may be linked in both scopes. Classify each placement,
        // so exempting own-ACR management never discards member-ACR management.
        ownAcrManagement: management && scope === "resource",
      });
    }
    for (const [controls, scope] of [
      [root.accessControl, "resource"],
      [root.memberAccessControl, "members"],
    ] as const)
      for (const control of controls) {
        visit(control as Term);
        for (const policy of control.apply)
          add(policy, scope, implementation === "ess" && target === url);
      }
    for (const [policies, scope] of [
      [node.nodes(`${ACP}access`), "resource"],
      [node.nodes(`${ACP}memberAccess`), "members"],
    ] as const)
      for (const policy of policies)
        add(new Policy(policy as Term, dataset, DataFactory), scope, true);
  }
  for (const q of dataset)
    if (
      q.predicate.value.startsWith(ACP) &&
      !visited.has(JSON.stringify([q.subject.termType, q.subject.value]))
    )
      throw new TypeError("Detached ACP semantic node");
  return result;
}
/** Materialize the nearest WAC defaults. Container defaults continue to protect descendants. */
export function materialize(
  dataset: Store,
  governing: string,
  resource: string,
  source: string,
): Store {
  const result = new Store();
  for (const auth of new AclResource(dataset, DataFactory).authorizations) {
    const original = properties(auth as Term, dataset);
    if (
      ![...original.iris(`${ACL}default`), ...original.iris(`${ACL}defaultForNew`)].includes(
        governing,
      )
    )
      continue;
    const copied = clone(auth as Term, dataset, result, [
      `${ACL}accessTo`,
      `${ACL}default`,
      `${ACL}defaultForNew`,
    ]);
    copied.add(`${ACL}accessTo`, resource);
    copied.add(MATERIALIZED_FROM, source);
    if (resource.endsWith("/")) copied.add(`${ACL}default`, resource);
  }
  return result;
}
/** Split changed WAC principals from shared authorizations; preserve all other targets/defaults. */
export function replaceWac(
  dataset: Store,
  resource: string,
  agent: AgentRef,
  modes: readonly Mode[],
  members = false,
): void {
  const selector =
    agent.type === "webid" ? "agent" : agent.type === "group" ? "agentGroup" : "agentClass";
  const principal =
    "id" in agent
      ? agent.id
      : agent.type === "public"
        ? `${FOAF}Agent`
        : `${ACL}AuthenticatedAgent`;
  for (const auth of [...new AclResource(dataset, DataFactory).authorizations]) {
    const rule = properties(auth as Term, dataset);
    const scopes = ["accessTo", ...(members ? ["default", "defaultForNew"] : [])].filter((name) =>
      rule.values(ACL + name).has(resource),
    );
    if (!scopes.length || !rule.values(ACL + selector).has(principal)) continue;
    const copy = clone(auth as Term, dataset, dataset, [
      `${ACL}accessTo`,
      `${ACL}default`,
      `${ACL}defaultForNew`,
    ]);
    for (const scope of scopes) {
      rule.values(ACL + scope).delete(resource);
      copy.add(ACL + scope, resource);
    }
    copy.values(ACL + selector).delete(principal);
  }
  if (modes.length) {
    const rule = properties(DataFactory.blankNode(), dataset);
    rule.add(`${RDF}type`, `${ACL}Authorization`);
    rule.add(`${ACL}accessTo`, resource);
    if (members) rule.add(`${ACL}default`, resource);
    rule.add(ACL + selector, principal);
    for (const mode of modes) rule.add(`${ACL}mode`, modeIri(mode));
  }
}
/** Detach only resource and own ACR controls; defaults and policy metadata remain intact. */
export function detachAcp(
  dataset: Store,
  resource: string,
  url: string,
  implementation: PodImplementation,
): void {
  for (const root of roots(dataset)) {
    const node = properties(root as Term, dataset);
    const target = node.iris(`${ACP}resource`)[0] ?? resource;
    if (!ownAcpTarget(target, resource, url, implementation)) continue;
    node.values(`${ACP}accessControl`).clear();
    node.values(`${ACP}access`).clear();
  }
}
/** Split only the selected principal's resource/management paths, retaining shared scopes. */
export function removeAcpAgent(
  dataset: Store,
  resource: string,
  url: string,
  agent: AgentRef,
  implementation: PodImplementation,
  members = false,
): void {
  const key = agentKey(agent);
  function withoutAgent(term: Term): Term {
    if (
      !policySubjects(new Policy(term, dataset, DataFactory), implementation).some(
        (clause) => agentKey(subjectAgent(clause[0] as Subject)) === key,
      )
    )
      return term;
    const copy = clone(term, dataset, dataset, [`${ACP}allOf`, `${ACP}anyOf`]);
    for (const name of ["allOf", "anyOf"])
      for (const matcher of properties(term, dataset).nodes(ACP + name)) {
        const original = properties(matcher as Term, dataset);
        const subject = agentSubject(agent);
        const selector = subject.kind === "client" ? `${ACP}client` : `${ACP}agent`;
        const principal =
          "id" in agent
            ? agent.id
            : `${ACP}${agent.type === "public" ? "PublicAgent" : "AuthenticatedAgent"}`;
        let next: Term = matcher as Term;
        if (original.values(selector).has(principal)) {
          const split = clone(matcher as Term, dataset, dataset, []);
          split.values(selector).delete(principal);
          // Removing the last client must not leave its activation-only
          // PublicAgent behind as an unconditional public authorization.
          if (subject.kind === "client" && !split.values(selector).size)
            split.values(`${ACP}agent`).clear();
          next = split as Term;
        }
        copy.terms(ACP + name).add(next);
      }
    return copy as Term;
  }
  for (const root of roots(dataset)) {
    const node = properties(root as Term, dataset);
    const target = node.iris(`${ACP}resource`)[0] ?? resource;
    if (!ownAcpTarget(target, resource, url, implementation)) continue;
    for (const name of ["access", ...(members ? ["memberAccess"] : [])])
      for (const policy of [...node.nodes(ACP + name)]) {
        const next = withoutAgent(policy as Term);
        node.terms(ACP + name).delete(policy as Term);
        node.terms(ACP + name).add(next);
      }
    for (const name of ["accessControl", ...(members ? ["memberAccessControl"] : [])])
      for (const control of [...node.nodes(ACP + name)]) {
        const policies = properties(control as Term, dataset).nodes(`${ACP}apply`);
        const next = policies.map((policy) => withoutAgent(policy as Term));
        if (next.every((policy, index) => policy === policies[index])) continue;
        const split = clone(control as Term, dataset, dataset, [`${ACP}apply`]);
        for (const policy of next) split.terms(`${ACP}apply`).add(policy);
        node.terms(ACP + name).delete(control as Term);
        node.terms(ACP + name).add(split as Term);
      }
  }
}
/**
 * Choose the subject that anchors this resource's controls. ESS resolves an ACR by its canonical
 * URL, so ESS controls must live on that IRI: reuse it when it is unused or already this
 * resource's root (incoming annotations do not change that), and refuse any other occupant before
 * writing rather than attaching grants to a node ESS would never read. Other dialects use a fresh
 * blank root.
 */
function acpResourceRoot(
  dataset: Store,
  resource: string,
  url: string,
  implementation: PodImplementation,
): Properties {
  if (implementation !== "ess") return properties(DataFactory.blankNode(), dataset);
  const candidate = DataFactory.namedNode(url);
  const unused = !dataset.match(null, null, candidate).size && !dataset.match(candidate).size;
  // Only non-ACP statements (annotations) may point at a reused root; an ACP reference would mean
  // the node is also a control, policy or matcher, whose meaning a root's controls must not change.
  const acpReferenced = [...dataset.match(null, null, candidate)].some((quad) =>
    quad.predicate.value.startsWith(ACP),
  );
  const ownRoot =
    !acpReferenced &&
    roots(dataset).some(
      (root) =>
        root.equals(candidate) &&
        (properties(root as Term, dataset).iris(`${ACP}resource`)[0] ?? resource) === resource,
    );
  if (unused || ownRoot) return properties(candidate, dataset);
  throw roleError(
    "unsupported",
    url,
    "The access control resource's canonical subject is used by other statements, so ESS would not read new grants written elsewhere",
  );
}
/** Write the unconditional subset using the trusted dialect's modes and management. */
export function appendAcp(
  dataset: Store,
  resource: string,
  url: string,
  rows: Iterable<{ agent: AgentRef; modes: Set<Mode> }>,
  implementation: PodImplementation,
  members = false,
): void {
  const root = acpResourceRoot(dataset, resource, url, implementation);
  root.add(`${RDF}type`, `${ACP}AccessControlResource`);
  root.add(`${ACP}resource`, resource);
  const vocabulary = implementation === "ess" ? ACP : ACL;
  for (const row of rows) {
    const matcher = properties(DataFactory.blankNode(), dataset);
    const subject = agentSubject(row.agent);
    if (subject.kind === "client") {
      matcher.add(`${ACP}client`, subject.clientId);
      if (implementation === "ess") matcher.add(`${ACP}agent`, `${ACP}PublicAgent`);
    } else if (subject.kind === "agent") matcher.add(`${ACP}agent`, subject.webId);
    else if (subject.kind === "public" || subject.kind === "authenticated")
      matcher.add(
        `${ACP}agent`,
        `${ACP}${subject.kind === "public" ? "PublicAgent" : "AuthenticatedAgent"}`,
      );
    else throw roleError("unsupported", url, "ACP groups require a membership snapshot");
    const policy = properties(DataFactory.blankNode(), dataset);
    policy.terms(`${ACP}allOf`).add(matcher as Term);
    const control = properties(DataFactory.blankNode(), dataset);
    control.terms(`${ACP}apply`).add(policy as Term);
    root.terms(`${ACP}accessControl`).add(control as Term);
    if (members) root.terms(`${ACP}memberAccessControl`).add(control as Term);
    const resourceModes = new Set(row.modes);
    if (implementation === "ess") resourceModes.delete("control");
    for (const mode of resourceModes)
      policy.add(`${ACP}allow`, modeIri(mode).replace(ACL, vocabulary));
    if (row.modes.has("control") && implementation === "ess") {
      const management = properties(DataFactory.blankNode(), dataset);
      management.terms(`${ACP}allOf`).add(matcher as Term);
      management.add(`${ACP}allow`, `${vocabulary}Read`);
      management.add(`${ACP}allow`, `${vocabulary}Write`);
      root.terms(`${ACP}access`).add(management as Term);
    }
  }
  // Detached policy/matcher RDF must not acquire meaning on a later read. Keep
  // annotations, and retain semantic nodes still shared by member/other controls.
  const reachable = new Set<string>();
  const visit = (term: Term) => {
    const key = JSON.stringify([term.termType, term.value]);
    if (reachable.has(key)) return;
    reachable.add(key);
    for (const name of [
      "accessControl",
      "memberAccessControl",
      "access",
      "memberAccess",
      "apply",
      "allOf",
      "anyOf",
      "noneOf",
    ])
      for (const child of properties(term, dataset).nodes(ACP + name)) visit(child as Term);
  };
  for (const acr of roots(dataset)) visit(acr as Term);
  for (const q of [...dataset]) {
    if (!q.predicate.value.startsWith(ACP)) continue;
    if (reachable.has(JSON.stringify([q.subject.termType, q.subject.value]))) continue;
    properties(q.subject, dataset).terms(q.predicate.value).clear();
  }
}
