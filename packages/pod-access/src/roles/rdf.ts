// AUTHORED-BY Codex
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
function allowed(iris: Iterable<string>, model: "wac" | "acp"): Set<Mode> {
  const canonical = [...iris].map((iri) => (model === "acp" ? iri.replace(ACP, ACL) : iri));
  if (
    canonical.some(
      (iri) =>
        !["read", "append", "write", "control"].some((mode) => modeIri(mode as Mode) === iri),
    )
  )
    throw new TypeError("Unknown access mode");
  return readModes(canonical);
}
function matcherSubjects(matcher: Matcher): Subject[] {
  for (const q of matcher.dataset.match(matcher as Term))
    if (![`${RDF}type`, `${ACP}agent`, `${ACP}client`].includes(q.predicate.value))
      throw new TypeError("Conditional ACP matcher");
  if (matcher.agent.size && matcher.client.size) throw new TypeError("Conjoined ACP attributes");
  return [
    ...[...matcher.agent].map((webId): Subject => {
      if (webId === `${ACP}PublicAgent`) return { kind: "public" };
      if (webId === `${ACP}AuthenticatedAgent`) return { kind: "authenticated" };
      if (webId.startsWith(ACP)) throw new TypeError("Unsupported special ACP agent");
      return { kind: "agent", webId };
    }),
    ...[...matcher.client].map((clientId): Subject => ({ kind: "client", clientId })),
  ];
}
function policySubjects(policy: Policy): Subject[][] {
  if (policy.deny.size || policy.noneOf.size)
    throw new TypeError("ACP denial or exclusion needs a richer policy model");
  let result: Map<string, Subject> | undefined;
  const intersect = (values: Subject[]) => {
    const next = new Map(values.map((s) => [agentKey(subjectAgent(s)), s]));
    if (result === undefined || result.has('["public"]')) result = next;
    else if (!next.has('["public"]'))
      result = new Map([...result].filter(([key]) => next.has(key)));
  };
  for (const matcher of policy.allOf) intersect(matcherSubjects(matcher));
  if (policy.anyOf.size) intersect([...policy.anyOf].flatMap(matcherSubjects));
  return [...(result?.values() ?? [])].map((subject) => [subject]);
}
/** Role projection is a closed, unconditional subset; reject shapes it cannot preserve. */
export function readPolicy(
  dataset: Store,
  resource: string,
  url: string,
  model: "wac" | "acp",
  implementation: PodImplementation,
): EffectivePolicy {
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
      allowed(auth.mode, model);
    return readWac(dataset, resource, url, implementation);
  }
  const result: EffectivePolicy = { grants: [], denials: [] };
  const visited = new Set<string>();
  const visit = (term: Term) => visited.add(JSON.stringify([term.termType, term.value]));
  for (const root of roots(dataset)) {
    visit(root as Term);
    const node = properties(root as Term, dataset);
    const resources = node.iris(`${ACP}resource`);
    if (resources.length > 1) throw new TypeError("Ambiguous ACP target");
    const target = resources[0] ?? resource;
    if (!resources.length && root.value !== url) throw new TypeError("Unplaced ACP root");
    function add(policy: Policy, scope: Grant["appliesTo"], management: boolean) {
      visit(policy as Term);
      for (const matcher of [...policy.allOf, ...policy.anyOf, ...policy.noneOf])
        visit(matcher as Term);
      const who = policySubjects(policy);
      const modes = allowed(policy.allow, model);
      if (management) {
        if (modes.size && (modes.has("control") || !(modes.has("read") && modes.has("write"))))
          throw new TypeError("Partial ACR management");
        modes.clear();
        if (policy.allow.size) modes.add("control");
      } else if (modes.has("control"))
        throw new TypeError("ACP management requires own ACR Read+Write");
      if (target !== resource && target !== url) return;
      result.grants.push({
        modes,
        who,
        except: [],
        appliesTo: scope,
        source: { url, node: policy.value },
      });
    }
    for (const [controls, scope] of [
      [root.accessControl, "resource"],
      [root.memberAccessControl, "members"],
    ] as const)
      for (const control of controls) {
        visit(control as Term);
        for (const policy of control.apply) add(policy, scope, target === url);
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
    if (!rule.values(`${ACL}accessTo`).has(resource) || !rule.values(ACL + selector).has(principal))
      continue;
    const copy = clone(auth as Term, dataset, dataset, [
      `${ACL}accessTo`,
      `${ACL}default`,
      `${ACL}defaultForNew`,
    ]);
    rule.values(`${ACL}accessTo`).delete(resource);
    copy.add(`${ACL}accessTo`, resource);
    copy.values(ACL + selector).delete(principal);
  }
  if (modes.length) {
    const rule = properties(DataFactory.blankNode(), dataset);
    rule.add(`${RDF}type`, `${ACL}Authorization`);
    rule.add(`${ACL}accessTo`, resource);
    rule.add(ACL + selector, principal);
    for (const mode of modes) rule.add(`${ACL}mode`, modeIri(mode));
  }
}
/** Detach only resource and own ACR controls; defaults and policy metadata remain intact. */
export function detachAcp(dataset: Store, resource: string, url: string): void {
  for (const root of roots(dataset)) {
    const node = properties(root as Term, dataset);
    const targets = node.iris(`${ACP}resource`);
    if (targets.length && !targets.includes(resource) && !targets.includes(url)) continue;
    node.values(`${ACP}accessControl`).clear();
    node.values(`${ACP}access`).clear();
  }
}
/** Write the unconditional ACP subset with separate ACR Read+Write management. */
export function appendAcp(
  dataset: Store,
  resource: string,
  url: string,
  rows: Iterable<{ agent: AgentRef; modes: Set<Mode> }>,
  implementation: PodImplementation,
): void {
  const root = properties(DataFactory.blankNode(), dataset);
  root.add(`${RDF}type`, `${ACP}AccessControlResource`);
  root.add(`${ACP}resource`, resource);
  const vocabulary = implementation === "ess" ? ACP : ACL;
  for (const row of rows) {
    const matcher = properties(DataFactory.blankNode(), dataset);
    const subject = agentSubject(row.agent);
    if (subject.kind === "client") matcher.add(`${ACP}client`, subject.clientId);
    else if (subject.kind === "agent") matcher.add(`${ACP}agent`, subject.webId);
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
    for (const mode of row.modes)
      if (mode !== "control") policy.add(`${ACP}allow`, modeIri(mode).replace(ACL, vocabulary));
    if (row.modes.has("control")) {
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
