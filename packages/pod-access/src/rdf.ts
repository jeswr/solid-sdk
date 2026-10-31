// AUTHORED-BY Codex GPT-6.1-Sol
import type { RdfReadResult } from "@jeswr/storage-client";
import { StorageError } from "@jeswr/storage-client";
import {
  DatasetWrapper,
  NamedNodeAs,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  type TermWrapper,
} from "@rdfjs/wrapper";
import {
  AccessControl,
  AccessControlResource,
  AclResource,
  Authorization,
  Group,
  Matcher,
  Policy,
} from "@solid/object";
import { DataFactory } from "n3";
import type { AccessMode, Grant } from "./types.js";

export const ACL = "http://www.w3.org/ns/auth/acl#";
export const ACP = "http://www.w3.org/ns/solid/acp#";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const PUBLIC = "http://xmlns.com/foaf/0.1/Agent";
export const MODES = {
  read: `${ACL}Read`,
  write: `${ACL}Write`,
  append: `${ACL}Append`,
  control: `${ACL}Control`,
} as const;
export type Dataset = RdfReadResult["dataset"];

export function fail(code: "unsupported" | "invalid-response", url: string): never {
  throw new StorageError(code, { url, method: "GET", feature: "accessControl" });
}

/** Multi-valued versions of the upstream optional WAC getters. */
class WacRule extends Authorization {
  get targets() {
    return iris(this, `${ACL}accessTo`);
  }
  get defaults() {
    return iris(this, `${ACL}default`);
  }
  get groups() {
    return iris(this, `${ACL}agentGroup`);
  }
}

function iris(node: TermWrapper, predicate: string) {
  return SetFrom.subjectPredicate(node, predicate, NamedNodeAs.string, NamedNodeFrom.string);
}

/** Reject conditions that Grant cannot represent, rather than present them as unconditional. */
function predicates(node: TermWrapper, allowed: readonly string[], url: string) {
  for (const q of node.dataset.match(TermAs.term(node))) {
    if (!allowed.includes(q.predicate.value)) fail("unsupported", url);
  }
}

function modes(values: Iterable<string>, url: string): AccessMode[] {
  const result: AccessMode[] = [];
  for (const value of values) {
    const mode = (Object.keys(MODES) as AccessMode[]).find((key) => MODES[key] === value);
    if (mode === undefined) fail("unsupported", url);
    result.push(mode);
  }
  return result;
}

function identifier(node: TermWrapper): Pick<Grant, "id"> {
  return node.termType === "NamedNode" ? { id: node.value } : {};
}

function wacAgents(rule: WacRule, url: string): Grant["agent"][] {
  const agents: Grant["agent"][] = [...rule.agent];
  for (const value of rule.agentClass) {
    if (value === PUBLIC) agents.push({ public: true });
    else if (value === `${ACL}AuthenticatedAgent`) agents.push({ authenticated: true });
    else fail("unsupported", url);
  }
  for (const group of rule.groups) agents.push({ group });
  return agents;
}

export function wacRules(dataset: Dataset, target: string, url: string) {
  const result: WacRule[] = [];
  for (const auth of new AclResource(dataset, DataFactory).authorizations) {
    const rule = new WacRule(TermAs.term(auth), dataset, DataFactory);
    if (!rule.targets.has(target) && !rule.defaults.has(target)) continue;
    // Force typed validation of every target, including multi-target documents.
    [...rule.targets, ...rule.defaults];
    predicates(
      rule,
      [
        TYPE,
        ...["accessTo", "default", "agent", "agentClass", "agentGroup", "mode"].map((p) => ACL + p),
      ],
      url,
    );
    result.push(rule);
  }
  return result;
}

export function wacGrants(dataset: Dataset, target: string, url: string): Grant[] {
  return wacRules(dataset, target, url).flatMap((rule) => {
    const accessModes = modes(rule.mode, url);
    return wacAgents(rule, url).map((agent) => ({
      agent,
      modes: [...accessModes],
      ...identifier(rule),
    }));
  });
}

export function addWac(
  dataset: Dataset,
  target: string,
  grant: Grant,
  inherit: boolean,
  id: string,
) {
  const rule = new WacRule(id, dataset, DataFactory);
  rule.type.add(`${ACL}Authorization`);
  rule.accessTo = target;
  if (inherit) rule.default = target;
  for (const mode of grant.modes) rule.mode.add(MODES[mode]);
  if (typeof grant.agent === "string") rule.agent.add(grant.agent);
  else if ("public" in grant.agent) rule.accessibleToAny = true;
  else if ("authenticated" in grant.agent) rule.accessibleToAuthenticated = true;
  else rule.agentGroup = new Group(grant.agent.group, dataset, DataFactory);
}

export function revokeWac(dataset: Dataset, target: string, key: string, url: string): boolean {
  let changed = false;
  for (const rule of wacRules(dataset, target, url)) {
    let selected = false;
    if (rule.termType === "NamedNode" && rule.value === key) {
      rule.targets.delete(target);
      rule.defaults.delete(target);
      selected = true;
    } else if (rule.agent.has(key) || rule.groups.has(key)) {
      if ([...rule.targets, ...rule.defaults].some((value) => value !== target))
        fail("unsupported", url);
      rule.agent.delete(key);
      rule.groups.delete(key);
      selected = true;
    }
    if (!selected) continue;
    changed = true;
    if (
      (rule.targets.size === 0 && rule.defaults.size === 0) ||
      wacAgents(rule, url).length === 0
    ) {
      rule.type.clear();
      rule.targets.clear();
      rule.defaults.clear();
      rule.agent.clear();
      rule.agentClass.clear();
      rule.groups.clear();
      rule.mode.clear();
    }
  }
  return changed;
}

class Acrs extends DatasetWrapper {
  get resources() {
    return [
      ...this.instancesOf(`${ACP}AccessControlResource`, AccessControlResource),
      ...this.subjectsOf(`${ACP}resource`, AccessControlResource),
      ...this.subjectsOf(`${ACP}accessControl`, AccessControlResource),
      ...this.subjectsOf(`${ACP}memberAccessControl`, AccessControlResource),
    ];
  }
}

export function acr(dataset: Dataset, target: string, url: string): AccessControlResource {
  const candidates = new Map<string, AccessControlResource>();
  for (const root of new Acrs(dataset, DataFactory).resources) {
    if (root.resource === target || (root.resource === undefined && root.value === url)) {
      candidates.set(`${root.termType}:${root.value}`, root);
    }
  }
  if (candidates.size > 1) fail("invalid-response", url);
  if (candidates.size === 1) return [...candidates.values()][0] as AccessControlResource;
  // Empty ACRs can be populated; a conflicting existing root cannot be repurposed.
  if ([...dataset.match(DataFactory.namedNode(url))].length > 0) fail("invalid-response", url);
  return new AccessControlResource(url, dataset, DataFactory);
}

function acpAgent(value: string, url: string): Grant["agent"] {
  if (value === `${ACP}PublicAgent`) return { public: true };
  if (value === `${ACP}AuthenticatedAgent`) return { authenticated: true };
  if (value === `${ACP}CreatorAgent` || value === `${ACP}OwnerAgent`) fail("unsupported", url);
  return value;
}

export function acpEntries(root: AccessControlResource, url: string) {
  const entries: { control: AccessControl; grant: Grant }[] = [];
  const seen = new Set<string>();
  for (const control of [...root.accessControl, ...root.memberAccessControl]) {
    const key = `${control.termType}:${control.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    predicates(control, [TYPE, `${ACP}apply`], url);
    for (const policy of control.apply) {
      predicates(
        policy,
        [TYPE, `${ACP}allow`, `${ACP}deny`, `${ACP}allOf`, `${ACP}anyOf`, `${ACP}noneOf`],
        url,
      );
      if (
        policy.deny.size > 0 ||
        policy.anyOf.size > 0 ||
        policy.noneOf.size > 0 ||
        policy.allOf.size !== 1
      )
        fail("unsupported", url);
      const matcher = [...policy.allOf][0] as Matcher;
      predicates(matcher, [TYPE, `${ACP}agent`], url);
      if (matcher.agent.size !== 1) fail("unsupported", url);
      const agent = [...matcher.agent][0] as string;
      entries.push({
        control,
        grant: {
          agent: acpAgent(agent, url),
          modes: modes(policy.allow, url),
          ...identifier(policy),
        },
      });
    }
  }
  return entries;
}

export function addAcp(
  root: AccessControlResource,
  target: string,
  grant: Grant,
  inherit: boolean,
  id: string,
) {
  const control = new AccessControl(`${id}-control`, root.dataset, DataFactory);
  const policy = new Policy(id, root.dataset, DataFactory);
  const matcher = new Matcher(`${id}-matcher`, root.dataset, DataFactory);
  root.type.add(`${ACP}AccessControlResource`);
  root.resource = target;
  control.type.add(`${ACP}AccessControl`);
  policy.type.add(`${ACP}Policy`);
  matcher.type.add(`${ACP}Matcher`);
  root.accessControl.add(control);
  if (inherit) root.memberAccessControl.add(control);
  control.apply.add(policy);
  policy.allOf.add(matcher);
  for (const mode of grant.modes) policy.allow.add(MODES[mode]);
  matcher.agent.add(
    typeof grant.agent === "string"
      ? grant.agent
      : "public" in grant.agent
        ? `${ACP}PublicAgent`
        : `${ACP}AuthenticatedAgent`,
  );
}

export function revokeAcp(root: AccessControlResource, key: string, url: string): boolean {
  let changed = false;
  for (const { control, grant } of acpEntries(root, url)) {
    if (grant.id !== key && grant.agent !== key) continue;
    if (control.apply.size !== 1) fail("unsupported", url);
    // Unlink locally. Definitions may be referenced by other ACRs or policies.
    root.accessControl.delete(control);
    root.memberAccessControl.delete(control);
    changed = true;
  }
  return changed;
}
