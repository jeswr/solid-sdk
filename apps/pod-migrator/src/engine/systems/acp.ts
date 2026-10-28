// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import { AccessControlResource, type Matcher, Policy } from "@solid/object";
import { DataFactory, Store } from "n3";
import { ACL, ACP, modeIri, RDF, RdfNode, readModes, serialize } from "../rdf.js";
import type { EffectivePolicy, Grant, Subject } from "../types.js";
export class PolicyTooComplex extends Error {
  override name = "PolicyTooComplex";
}
export type AcpDialect = "css" | "ess";
export function acpDialect(dataset: DatasetCore): AcpDialect {
  return [...dataset].some((q) =>
    [`${ACP}Read`, `${ACP}Write`, `${ACP}Append`].includes(q.object.value),
  )
    ? "ess"
    : "css";
}
function product(left: Subject[][], right: Subject[][]): Subject[][] {
  if (left.length * right.length > 64) throw new PolicyTooComplex("ACP policy exceeds 64 clauses");
  return left.flatMap((a) => right.map((b) => [...a, ...b]));
}
function matcherClauses(matcher: Matcher): Subject[][] {
  let result: Subject[][] = [[]];
  let present = false;
  const attributes: Subject[][] = [
    [...matcher.agent].map((webId) => {
      if (webId === `${ACP}PublicAgent`) return { kind: "public" };
      if (webId === `${ACP}AuthenticatedAgent`) return { kind: "authenticated" };
      if (webId === `${ACP}OwnerAgent`) return { kind: "owner" };
      if (webId === `${ACP}CreatorAgent`) return { kind: "creator" };
      return { kind: "agent", webId };
    }),
    [...matcher.client].map((clientId) =>
      clientId === `${ACP}PublicClient` ? { kind: "public" } : { kind: "client", clientId },
    ),
    [...matcher.issuer].map((issuer) => ({ kind: "issuer", issuer })),
    [...matcher.vc].map((vcType) => ({ kind: "vc", vcType })),
  ];
  // CSS's reference implementation ANDs different attributes, ORs values of one attribute.
  for (const attribute of attributes)
    if (attribute.length) {
      present = true;
      result = product(
        result,
        attribute.map((subject) => [subject]),
      );
    }
  return present ? result : [];
}
export function readAcp(dataset: DatasetCore, resource: string, url: string): EffectivePolicy {
  const result: EffectivePolicy = { grants: [], denials: [] };
  // CSS enumerates EVERY acp:resource statement, not only the requested IRI.
  // Track the entire reachable graph so detached/unknown controls fail closed.
  const key = (term: { termType: string; value: string }) =>
    JSON.stringify([term.termType, term.value]);
  const visited = new Set<string>();
  const visit = (term: { termType: string; value: string }, predicates: string[]) => {
    for (const name of predicates) visited.add(`${key(term)}:${ACP}${name}`);
  };
  const roots = new Map<string, import("@rdfjs/types").Term>();
  for (const q of dataset.match(null, DataFactory.namedNode(`${ACP}resource`)))
    roots.set(key(q.subject), q.subject);
  const hasResourceStatements = roots.size > 0;
  for (const q of dataset.match(
    null,
    DataFactory.namedNode(`${RDF}type`),
    DataFactory.namedNode(`${ACP}AccessControlResource`),
  ))
    roots.set(key(q.subject), q.subject);
  for (const term of roots.values()) {
    visit(term, ["resource", "accessControl", "memberAccessControl", "access"]);
    const acr = new AccessControlResource(term, dataset, DataFactory);
    const node = new RdfNode(term, dataset, DataFactory);
    const resources = node.iris(`${ACP}resource`);
    if (!resources.length && hasResourceStatements)
      throw new TypeError("Unplaced ACP resource node");
    if (resources.length > 1) throw new TypeError("Ambiguous ACP resource scope");
    const own = !resources.length || resources[0] === resource;
    const auxiliary = resources[0] === url;
    function addPolicy(
      policy: Policy,
      appliesTo: Grant["appliesTo"],
      control = false,
      foreign = false,
    ): void {
      visit(policy, ["allow", "deny", "allOf", "anyOf", "noneOf"]);
      const all = [...policy.allOf];
      const any = [...policy.anyOf];
      for (const matcher of [...all, ...any, ...policy.noneOf])
        visit(matcher, ["agent", "client", "issuer", "vc"]);
      if (!all.length && !any.length) return;
      let who: Subject[][] = [[]];
      for (const matcher of all) who = product(who, matcherClauses(matcher));
      if (any.length) who = product(who, any.flatMap(matcherClauses));
      // A conjunction inside noneOf cannot be flattened to OR exclusions. Fail closed.
      const excluded = [...policy.noneOf].flatMap(matcherClauses);
      if (excluded.some((clause) => clause.length !== 1))
        throw new PolicyTooComplex("Conjunctive ACP exclusions need a richer normal form");
      const convert = (values: Iterable<string>) =>
        readModes(
          [...values].map((value) =>
            value.startsWith(ACP) ? ACL + value.slice(ACP.length) : value,
          ),
        );
      for (const [field, values] of [
        ["grants", policy.allow],
        ["denials", policy.deny],
      ] as const) {
        const modes = convert(values);
        if (control) {
          const hasControl =
            field === "grants"
              ? modes.has("read") && modes.has("write")
              : modes.has("read") || modes.has("write");
          modes.clear();
          if (hasControl) modes.add("control");
        }
        if (modes.size && foreign && field === "grants")
          throw new TypeError("Cannot safely place grants from another ACP resource node");
        if (modes.size)
          result[field].push({
            modes,
            who,
            except: excluded.flat(),
            appliesTo,
            source: { url, node: policy.value },
          });
      }
    }
    for (const ac of acr.accessControl) {
      visit(ac, ["apply"]);
      for (const policy of ac.apply)
        addPolicy(
          policy,
          own ? "resource" : auxiliary ? "resource" : "both",
          !own && auxiliary,
          !own && !auxiliary,
        );
    }
    for (const ac of acr.memberAccessControl) {
      visit(ac, ["apply"]);
      for (const policy of ac.apply) addPolicy(policy, own ? "members" : "both", false, !own);
    }
    for (const policy of node.nodes(`${ACP}access`))
      addPolicy(
        new Policy(policy as unknown as import("@rdfjs/types").Term, dataset, DataFactory),
        "resource",
        true,
        !own && !auxiliary,
      );
  }
  for (const quad of dataset)
    if (
      quad.predicate.value.startsWith(ACP) &&
      !visited.has(`${key(quad.subject)}:${quad.predicate.value}`)
    )
      throw new TypeError("Unplaced or unknown ACP construct");

  return result;
}

export async function writeAcp(
  policy: EffectivePolicy,
  resource: string,
  url: string,
  dialect: AcpDialect = "css",
  nodePrefix = url,
): Promise<string> {
  const dataset = new Store();
  const acr = new RdfNode(url, dataset, DataFactory);
  acr.add(`${RDF}type`, `${ACP}AccessControlResource`);
  acr.add(`${ACP}resource`, resource);
  // CSS evaluates ACL-mode policies for the ACR URL itself; ESS uses acp:access.
  const ownerControl = new RdfNode(`${nodePrefix}#acr-owner`, dataset, DataFactory);
  ownerControl.add(`${ACP}resource`, url);
  let index = 0;
  function matcher(subject: Subject): string {
    const node = new RdfNode(`${nodePrefix}#matcher-${index++}`, dataset, DataFactory);
    node.add(`${RDF}type`, `${ACP}Matcher`);
    switch (subject.kind) {
      case "agent":
        node.add(`${ACP}agent`, subject.webId);
        break;
      case "public":
        node.add(`${ACP}agent`, `${ACP}PublicAgent`);
        break;
      case "authenticated":
        node.add(`${ACP}agent`, `${ACP}AuthenticatedAgent`);
        break;
      case "owner":
        node.add(`${ACP}agent`, `${ACP}OwnerAgent`);
        break;
      case "creator":
        node.add(`${ACP}agent`, `${ACP}CreatorAgent`);
        break;
      case "client":
        node.add(`${ACP}client`, subject.clientId);
        break;
      case "issuer":
        node.add(`${ACP}issuer`, subject.issuer);
        break;
      case "vc":
        node.add(`${ACP}vc`, subject.vcType);
        break;
      default:
        throw new TypeError("Unsupported ACP subject");
    }
    return node.value;
  }
  for (const [field, rules] of [
    ["allow", policy.grants],
    ["deny", policy.denials],
  ] as const)
    for (const rule of rules)
      for (const clause of rule.who) {
        const p = new RdfNode(`${nodePrefix}#policy-${index++}`, dataset, DataFactory);
        const ac = new RdfNode(`${nodePrefix}#control-${index++}`, dataset, DataFactory);
        p.add(`${RDF}type`, `${ACP}Policy`);
        ac.add(`${ACP}apply`, p.value);
        for (const subject of clause) p.add(`${ACP}allOf`, matcher(subject));
        for (const subject of rule.except) p.add(`${ACP}noneOf`, matcher(subject));
        for (const mode of rule.modes) {
          if (dialect === "ess" && mode === "control") continue;
          p.add(ACP + field, dialect === "css" ? modeIri(mode) : modeIri(mode).replace(ACL, ACP));
        }
        if (rule.appliesTo !== "members") acr.add(`${ACP}accessControl`, ac.value);
        if (rule.appliesTo !== "resource") acr.add(`${ACP}memberAccessControl`, ac.value);
        if (rule.modes.has("control")) {
          // ACR edit permissions use the same conditions as the resource's Control grant.
          const controlPolicy = new RdfNode(
            `${nodePrefix}#acr-policy-${index++}`,
            dataset,
            DataFactory,
          );
          for (const subject of clause) controlPolicy.add(`${ACP}allOf`, matcher(subject));
          for (const subject of rule.except) controlPolicy.add(`${ACP}noneOf`, matcher(subject));
          controlPolicy.add(ACP + field, `${dialect === "ess" ? ACP : ACL}Read`);
          controlPolicy.add(ACP + field, `${dialect === "ess" ? ACP : ACL}Write`);
          acr.add(`${ACP}access`, controlPolicy.value);
          const access = new RdfNode(`${nodePrefix}#acr-control-${index++}`, dataset, DataFactory);
          access.add(`${ACP}apply`, controlPolicy.value);
          ownerControl.add(`${ACP}accessControl`, access.value);
        }
      }
  return serialize(dataset);
}
