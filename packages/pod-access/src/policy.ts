// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { modes, parent } from "./rdf.js";
import type {
  AccessDocument,
  AccessSystem,
  EffectivePolicy,
  Grant,
  Mode,
  PodImplementation,
  Subject,
} from "./types.js";
/** Return a policy with no grants or denials. */
export function emptyPolicy(): EffectivePolicy {
  return { grants: [], denials: [] };
}
/** Select resource or member rules and normalize them to resource scope. */
export function scopePolicy(
  policy: EffectivePolicy,
  scope: "resource" | "members",
): EffectivePolicy {
  const select = (rules: Grant[]) =>
    rules
      .filter((rule) => rule.appliesTo === scope || rule.appliesTo === "both")
      .map((rule) => ({ ...rule, appliesTo: "resource" as const }));
  return { grants: select(policy.grants), denials: select(policy.denials) };
}
/** Require a selected, resource-normalized scope before translation or proof. @internal */
export function assertResourceScope(policy: EffectivePolicy): void {
  for (const rule of [...policy.grants, ...policy.denials])
    if (rule.appliesTo !== "resource")
      throw new TypeError("Policy must be normalized with scopePolicy before translation or proof");
}
/** Combine rules without discarding denials or evaluating their conditions. */
export function unionPolicies(...policies: EffectivePolicy[]): EffectivePolicy {
  return { grants: policies.flatMap((p) => p.grants), denials: policies.flatMap((p) => p.denials) };
}
/** Pass sourceImplementation only for source reads; target proofs stay additive. */
export function effectivePolicy(
  system: AccessSystem,
  url: string,
  root: string,
  documents: ReadonlyMap<string, Pick<AccessDocument, "policy"> | undefined>,
  sourceImplementation?: PodImplementation,
): EffectivePolicy {
  const found: EffectivePolicy[] = [];
  // ESS documentation supports both additive and default-only member grants.
  // Intersect those readings for sources; targets retain the additive reading.
  const explicitEssGrants =
    system === "acp" &&
    sourceImplementation === "ess" &&
    (documents.get(url)?.policy.explicit === true ||
      (documents.get(url)?.policy.grants.some((rule) => rule.appliesTo !== "members") ?? false));
  let current: string | undefined = url;
  while (current !== undefined) {
    const doc = documents.get(current);
    if (doc) {
      const scoped = scopePolicy(doc.policy, current === url ? "resource" : "members");
      if (explicitEssGrants && current !== url) scoped.grants = [];
      found.push(scoped);
      if (system === "wac") break;
    }
    current = parent(current, root);
  }
  return unionPolicies(...found);
}
/** Grant all modes to one owner, optionally including descendants. */
export function ownerPolicy(webId: string, members = false): EffectivePolicy {
  return {
    grants: [
      {
        modes: new Set(modes),
        who: [[{ kind: "agent", webId }]],
        except: [],
        appliesTo: members ? "both" : "resource",
        source: { url: webId, node: webId },
      },
    ],
    denials: [],
  };
}
/** Compose descendant defaults using WAC replacement or ACP additive inheritance. */
export function effectiveMembers(
  system: AccessSystem,
  url: string,
  root: string,
  documents: ReadonlyMap<string, AccessDocument | undefined>,
): EffectivePolicy {
  const found: EffectivePolicy[] = [];
  let current: string | undefined = url;
  while (current !== undefined) {
    const doc = documents.get(current);
    if (doc) {
      found.push(scopePolicy(doc.policy, "members"));
      if (system === "wac") break;
    }
    current = parent(current, root);
  }
  return unionPolicies(...found);
}
/** Produce a stable symbolic key for a principal or condition. */
export function subjectKey(subject: Subject): string {
  switch (subject.kind) {
    case "agent":
      return JSON.stringify([subject.kind, subject.webId]);
    case "group":
      return JSON.stringify([subject.kind, subject.group]);
    case "client":
      return JSON.stringify([subject.kind, subject.clientId]);
    case "issuer":
      return JSON.stringify([subject.kind, subject.issuer]);
    case "vc":
      return JSON.stringify([subject.kind, subject.vcType]);
    case "origin":
      return JSON.stringify([subject.kind, subject.origin]);
    default:
      return subject.kind;
  }
}
/** Trusted owner identities and public group snapshots used by the symbolic proof. */
export interface ProofContext {
  sourceOwner?: string;
  targetOwner?: string;
  groups?: ReadonlyMap<string, readonly string[]>;
}
type Tri = boolean | undefined;
function and(values: Tri[]): Tri {
  return values.includes(false) ? false : values.every((v) => v === true) ? true : undefined;
}
function or(values: Tri[]): Tri {
  return values.includes(true) ? true : values.every((v) => v === false) ? false : undefined;
}
function not(value: Tri): Tri {
  return value === undefined ? undefined : !value;
}
/**
 * Prove implication between resource-normalized policies for the same selected scope.
 * Call scopePolicy separately for resource and member proofs. Unknown/group conditions stay symbolic.
 */
export function assertNotWider(
  source: EffectivePolicy,
  target: EffectivePolicy,
  context: ProofContext = {},
): void {
  assertResourceScope(source);
  assertResourceScope(target);
  const variables = new Map<string, Subject>();
  const assignment = new Map<string, boolean>();
  function subjectValue(subject: Subject, side: "source" | "target"): Tri {
    if (subject.kind === "public") return true;
    if (subject.kind === "owner") {
      const webId = side === "target" ? context.targetOwner : context.sourceOwner;
      if (webId) return subjectValue({ kind: "agent", webId }, side);
    }
    if (subject.kind === "group" && context.groups?.has(subject.group))
      return or(
        (context.groups.get(subject.group) as readonly string[]).map((webId) =>
          subjectValue({ kind: "agent", webId }, side),
        ),
      );
    const key = subjectKey(subject);
    variables.set(key, subject);
    return assignment.get(key);
  }
  let budget = 65536;
  function ruleValue(rule: Grant, side: "source" | "target"): Tri {
    if (--budget === 0) throw new TypeError("Access proof is too complex");
    return and([
      or(rule.who.map((clause) => and(clause.map((subject) => subjectValue(subject, side))))),
      ...rule.except.map((subject) => not(subjectValue(subject, side))),
    ]);
  }
  function access(policy: EffectivePolicy, mode: Mode, side: "source" | "target"): Tri {
    return and([
      or(policy.grants.filter((rule) => rule.modes.has(mode)).map((rule) => ruleValue(rule, side))),
      not(
        or(
          policy.denials
            .filter((rule) => rule.modes.has(mode))
            .map((rule) => ruleValue(rule, side)),
        ),
      ),
    ]);
  }
  function compatible(): boolean {
    const singletons = new Set<string>();
    const authenticated = assignment.get(subjectKey({ kind: "authenticated" }));
    for (const [key, subject] of variables)
      if (assignment.get(key) === true) {
        if (subject.kind === "agent" && authenticated === false) return false;
        if (["agent", "client", "issuer", "origin"].includes(subject.kind)) {
          if (singletons.has(subject.kind)) return false;
          singletons.add(subject.kind);
        }
      }
    return true;
  }
  for (const mode of modes) {
    variables.clear();
    assignment.clear();
    budget = 65536;
    function counterexample(): boolean {
      if (!compatible()) return false;
      const value = and([
        access(target, mode, "target"),
        not(access(source, mode, "source")),
        context.targetOwner
          ? not(subjectValue({ kind: "agent", webId: context.targetOwner }, "target"))
          : true,
      ]);
      if (value !== undefined) return value;
      const key = [...variables.keys()].find((key) => !assignment.has(key)) as string;
      assignment.set(key, false);
      if (counterexample()) return true;
      assignment.set(key, true);
      const found = counterexample();
      assignment.delete(key);
      return found;
    }
    if (counterexample()) throw new TypeError(`Planned policy widens ${mode} access`);
  }
}
/** Check normalized policies in both directions; return false for invalid scopes or failed proofs. */
export function policiesEqual(
  a: EffectivePolicy,
  b: EffectivePolicy,
  context: ProofContext = {},
): boolean {
  try {
    assertNotWider(a, b, context);
    assertNotWider(b, a, context);
    return true;
  } catch {
    return false;
  }
}
