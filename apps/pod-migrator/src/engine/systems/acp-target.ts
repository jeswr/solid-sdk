// AUTHORED-BY Codex GPT-6
import type { DatasetCore, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { ACP, RDF, RdfNode } from "../rdf.js";

/** Closed grammar for ACP targets without live enforcement validation. */
export function assertUnvalidatedTargetAcp(dataset: DatasetCore, resource: string): void {
  function refuse(): never {
    throw new TypeError(
      "Existing target ACP is outside the unvalidated-target allowlist: unestablished policy, matcher or mode",
    );
  }
  const key = (term: { termType: string; value: string }) => `${term.termType}:${term.value}`;
  const shapes = new Map<string, { type: string; predicates: string[] }>();
  const check = (term: Term | RdfNode, type: string, predicates: string[]) => {
    const id = key(term);
    const previous = shapes.get(id);
    if (previous && previous.type !== ACP + type) refuse();
    shapes.set(id, { type: ACP + type, predicates: predicates.map((p) => ACP + p) });
    return new RdfNode(term as Term, dataset, DataFactory);
  };
  const roots = new Map<string, Term>();
  for (const q of dataset) {
    if (
      q.predicate.value === `${ACP}resource` ||
      (q.predicate.value === `${RDF}type` && q.object.value === `${ACP}AccessControlResource`)
    )
      roots.set(key(q.subject), q.subject);
  }
  if (roots.size !== 1) refuse();
  const root = check([...roots.values()][0] as Term, "AccessControlResource", [
    "resource",
    "accessControl",
    "memberAccessControl",
    "access",
    "memberAccess",
  ]);
  const bindings = root.iris(`${ACP}resource`);
  if (bindings.length > 1 || (bindings.length === 1 && bindings[0] !== resource)) refuse();
  // With no resource binding, root discovery requires the exact ESS ACR type.
  for (const scope of ["accessControl", "memberAccessControl", "access", "memberAccess"]) {
    const control = scope === "access" || scope === "memberAccess";
    const policies = root.nodes(ACP + scope).flatMap((node) => {
      if (control) return [node];
      const ac = check(node, "AccessControl", ["apply"]);
      const applied = ac.nodes(`${ACP}apply`);
      if (applied.length !== 1) refuse();
      return applied;
    });
    for (const policy of policies) {
      const p = check(policy, "Policy", ["allow", "deny", "allOf", "noneOf"]);
      const allow = p.iris(`${ACP}allow`);
      const deny = p.iris(`${ACP}deny`);
      const modes = [...allow, ...deny];
      if (allow.length && deny.length) refuse();
      if (control) {
        if (modes.length !== 2 || !modes.includes(`${ACP}Read`) || !modes.includes(`${ACP}Write`))
          refuse();
      } else if (
        modes.some(
          (mode) => !["Read", "Write", "Append", "Control"].map((m) => ACP + m).includes(mode),
        )
      )
        refuse();
      const positive = p.nodes(`${ACP}allOf`);
      if (!positive.length) refuse();
      for (const matcher of [...positive, ...p.nodes(`${ACP}noneOf`)]) {
        const m = check(matcher, "Matcher", ["agent"]);
        const agents = m.iris(`${ACP}agent`);
        if (agents.length !== 1) refuse();
        const agent = agents[0] as string;
        if (
          agent.startsWith(ACP) &&
          ![`${ACP}PublicAgent`, `${ACP}AuthenticatedAgent`].includes(agent)
        )
          refuse();
      }
    }
  }
  // Validate every triple, including types, unrelated predicates and detached nodes.
  for (const q of dataset) {
    const shape = shapes.get(key(q.subject));
    if (!shape || q.graph.termType !== "DefaultGraph") refuse();
    if (q.predicate.value === `${RDF}type`) {
      if (q.object.termType !== "NamedNode" || q.object.value !== shape.type) refuse();
    } else if (!shape.predicates.includes(q.predicate.value)) refuse();
  }
}
