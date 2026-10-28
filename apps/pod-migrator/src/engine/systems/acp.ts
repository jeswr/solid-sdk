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
function product(left: Subject[][], right: Subject[][]): Subject[][] {
  if (left.length * right.length > 64) throw new PolicyTooComplex("ACP policy exceeds 64 clauses");
  return left.flatMap((a) => right.map((b) => [...a, ...b]));
}
function matcherClauses(matcher: Matcher, dialect?: AcpDialect, negative = false): Subject[][] {
  // Source grants use the narrower established ESS subset. This requirement
  // cannot describe all active target policies; target reads validate separately.
  if (dialect === "ess" && !matcher.agent.size) return [];
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
    negative && matcher.issuer.size
      ? [{ kind: "public" }]
      : [...matcher.issuer].map((issuer) => ({ kind: "issuer", issuer })),
    negative && matcher.vc.size
      ? [{ kind: "public" }]
      : [...matcher.vc].map((vcType) => ({ kind: "vc", vcType })),
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
  return present
    ? result.map((clause) =>
        clause.some((subject) => subject.kind !== "public")
          ? clause.filter((subject) => subject.kind !== "public")
          : [{ kind: "public" }],
      )
    : [];
}
/**
 * CSS 7.2 AcpReader + AuthAuxiliaryReader use acl:* modes and resource Control.
 * The explicit ESS dialect accepts the separately documented PodSpaces forms:
 * acp:* modes, a typed root without acp:resource, and ACR-self/acp:access Read+Write
 * as Control. Editable RDF is not evidence that a server implements these forms.
 * Unknown/CSS source grants using them fail closed; denials use their broadest
 * plausible scope. Target reads use the widest plausible permissions: unsupported
 * matchers reject the path rather than silently removing a possible grant.
 */
export function readAcp(
  dataset: DatasetCore,
  resource: string,
  url: string,
  dialect?: AcpDialect,
  target = false,
  onInactive?: (node: string, reason: string) => void,
): EffectivePolicy {
  const result: EffectivePolicy = { grants: [], denials: [] };
  // CSS enumerates EVERY acp:resource statement, not only the requested IRI.
  // Track the entire reachable graph so detached/unknown controls fail closed.
  const key = (term: { termType: string; value: string }) =>
    JSON.stringify([term.termType, term.value]);
  const visited = new Set<string>();
  const semanticNodes = new Set<string>();
  const visit = (term: { termType: string; value: string }, predicates: string[]) => {
    semanticNodes.add(key(term));
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
    visit(term, ["resource", "accessControl", "memberAccessControl", "access", "memberAccess"]);
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
      fallback = false,
    ): void {
      visit(policy, ["allow", "deny", "allOf", "anyOf", "noneOf"]);
      const all = [...policy.allOf];
      const any = [...policy.anyOf];
      for (const matcher of [...all, ...any, ...policy.noneOf]) {
        visit(matcher, ["agent", "client", "issuer", "vc"]);
        // The source's per-matcher agent requirement is only a narrowing subset.
        // ESS also accepts policy-level client requirements and VC-only policies.
        // No trusted creator metadata is available for existing target resources.
        // Reject every unmodelled target shape, including uncertain exclusions.
        if (target && dialect === "ess") {
          if (
            !matcher.agent.size ||
            matcher.issuer.size ||
            matcher.vc.size ||
            matcher.agent.has(`${ACP}CreatorAgent`) ||
            matcher.agent.has(`${ACP}OwnerAgent`)
          )
            throw new TypeError(
              "Existing target ESS matcher requires unestablished conditions or creator metadata",
            );
        }
      }
      if (!all.length && !any.length) {
        if (target && dialect === "ess" && policy.allow.size)
          throw new TypeError("Existing target ESS grant has no established positive matcher");
        return;
      }
      const expand = (matcherDialect?: AcpDialect, negative = false): Subject[][] => {
        let clauses: Subject[][] = [[]];
        for (const matcher of all)
          clauses = product(clauses, matcherClauses(matcher, matcherDialect, negative));
        if (any.length)
          clauses = product(
            clauses,
            any.flatMap((matcher) => matcherClauses(matcher, matcherDialect, negative)),
          );
        return clauses;
      };
      const who = expand(dialect);
      // A conjunction inside noneOf cannot be flattened to OR exclusions. Fail closed.
      // For source grants, a possibly active exclusion remains restrictive even
      // outside the ESS matcher subset we can positively establish.
      const excluded = [...policy.noneOf].flatMap((matcher) =>
        matcherClauses(matcher, target ? dialect : undefined, !target && dialect === "ess"),
      );
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
        const rawModes = [...values];
        const modes = convert(rawModes);
        const uncertain =
          dialect !== "ess" &&
          (control || fallback || rawModes.some((value) => value.startsWith(ACP)));
        if (modes.size && uncertain && (target || field === "grants"))
          throw new TypeError(
            "Unsupported ACP grant or target restriction requires an established ESS dialect",
          );
        // CSS supplies neither owner, creator nor vc in AcpReader.createContext.
        // Such an exclusion can narrow a grant, but cannot weaken a source denial
        // or be trusted to restrict existing target permissions.
        const uncertainRole = (subject: Subject) =>
          subject.kind === "owner" || subject.kind === "creator" || subject.kind === "vc";
        if (target && dialect !== "ess" && [...who.flat(), ...excluded.flat()].some(uncertainRole))
          throw new TypeError("Target ACP owner/creator/vc matcher enforcement is not established");
        // Source denials use the broadest plausible interpretation. Requiring
        // an agent must never silently remove a possibly effective denial.
        let activeWho =
          !target && field === "denials" && dialect === "ess" ? expand(undefined, true) : who;
        if (field === "grants" || dialect === "css") {
          activeWho = who.filter((clause) =>
            dialect === "ess"
              ? !clause.some((subject) => subject.kind === "issuer" || subject.kind === "vc")
              : !clause.some(uncertainRole),
          );
          if (
            field === "grants" &&
            modes.size &&
            (activeWho.length !== who.length ||
              (dialect === "ess" && (!who.length || who.length !== expand().length)))
          )
            onInactive?.(
              policy.value,
              "Source grant clauses were omitted: matcher activation or enforcement is not established for the source dialect.",
            );
        }
        const canonical = rawModes.map((mode) => mode.replace(ACP, ACL));
        if (
          target &&
          !control &&
          field === "denials" &&
          canonical.includes(`${ACL}Append`) !== canonical.includes(`${ACL}Write`)
        )
          throw new TypeError("Target ACP Write/Append denial implication is ambiguous");
        if (control) {
          if (target && modes.has("read") !== modes.has("write"))
            throw new TypeError(
              "Partial target ACR permissions cannot be represented safely as Control",
            );
          const hasControl =
            field === "grants"
              ? modes.has("read") && modes.has("write")
              : modes.has("read") || modes.has("write");
          modes.clear();
          if (hasControl) modes.add("control");
        } else if (dialect === "ess" && (field === "grants" || target) && modes.delete("control")) {
          onInactive?.(
            policy.value,
            "Inactive ESS resource Control was ignored; ESS controls ACR access through access/memberAccess policies.",
          );
        }
        if (modes.size && foreign && field === "grants")
          throw new TypeError("Cannot safely place grants from another ACP resource node");
        const exclusions =
          !target && field === "denials"
            ? [...policy.noneOf].flatMap((matcher) => matcherClauses(matcher, dialect)).flat()
            : excluded.flat();
        if (modes.size)
          result[field].push({
            modes,
            who: activeWho,
            except:
              !target && (field === "denials" || dialect === "css")
                ? exclusions.filter((subject) => !uncertainRole(subject))
                : exclusions,
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
          !resources.length,
        );
    }
    for (const ac of acr.memberAccessControl) {
      visit(ac, ["apply"]);
      for (const policy of ac.apply)
        addPolicy(policy, own ? "members" : "both", false, !own, !resources.length);
    }
    for (const [predicate, scope] of [
      ["access", "resource"],
      ["memberAccess", "members"],
    ] as const)
      for (const policy of node.nodes(ACP + predicate))
        addPolicy(
          new Policy(policy as unknown as import("@rdfjs/types").Term, dataset, DataFactory),
          scope,
          true,
          !own && !auxiliary,
          !resources.length,
        );
  }
  for (const quad of dataset)
    if (
      (quad.predicate.value.startsWith(ACP) &&
        !visited.has(`${key(quad.subject)}:${quad.predicate.value}`)) ||
      (target &&
        semanticNodes.has(key(quad.subject)) &&
        quad.predicate.value !== `${RDF}type` &&
        !quad.predicate.value.startsWith(ACP))
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
    // PublicAgent is the identity element of conjunction. It activates ESS's
    // conditional matchers without weakening the client/issuer/VC condition.
    if (dialect === "ess" && ["client", "issuer", "vc"].includes(subject.kind))
      node.add(`${ACP}agent`, `${ACP}PublicAgent`);
    return node.value;
  }
  for (const [field, rules] of [
    ["allow", policy.grants],
    ["deny", policy.denials],
  ] as const)
    for (const rule of rules)
      for (const clause of rule.who) {
        if (field === "deny" && rule.modes.has("append") !== rule.modes.has("write"))
          throw new TypeError(
            "ACP denials must deny both Write and Append to prevent derived Append access",
          );
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
        if (dialect === "ess" && rule.modes.has("control")) {
          // ACR edit permissions use the same conditions as the resource's Control grant.
          const controlPolicy = new RdfNode(
            `${nodePrefix}#acr-policy-${index++}`,
            dataset,
            DataFactory,
          );
          for (const subject of clause) controlPolicy.add(`${ACP}allOf`, matcher(subject));
          for (const subject of rule.except) controlPolicy.add(`${ACP}noneOf`, matcher(subject));
          controlPolicy.add(ACP + field, `${ACP}Read`);
          controlPolicy.add(ACP + field, `${ACP}Write`);
          if (rule.appliesTo !== "members") acr.add(`${ACP}access`, controlPolicy.value);
          if (rule.appliesTo !== "resource") acr.add(`${ACP}memberAccess`, controlPolicy.value);
        }
      }
  return serialize(dataset);
}
