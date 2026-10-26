// AUTHORED-BY Codex GPT-6
import type { OdrlDuty, OdrlPolicy, OdrlRule } from "@jeswr/solid-odrl";
import { ACTION_IRI, evaluate, IRI_TO_ACTION, policyFromRdf } from "@jeswr/solid-odrl";
import type { DatasetCore, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { PolicyIdentifierCollisionError, PolicySubjectUnsupportedError } from "./errors.js";
import type { PolicyContext, PolicyResult } from "./types.js";

const ODRL = "http://www.w3.org/ns/odrl/2/";
const empty = (): PolicyResult => ({ allow: false, matched: [], unmet: [] });
const key = (term: Term) => `${term.termType}:${term.value}`;

/** Add trace IDs to the parsed model; never rewrite the RDF or its evaluation inputs. */
function identifiedPolicy(data: DatasetCore, policy: OdrlPolicy): OdrlPolicy {
  const quads = [...data];
  // solid-odrl projects a subject's value into policy.id, losing its term type.
  // Recover it from recognized policy type assertions, never unrelated subjects.
  const subjects = new Map<string, Term>();
  const rdfType = DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  const policyTypes = ["Policy", "Set", "Offer", "Agreement"].map((name) =>
    DataFactory.namedNode(ODRL + name),
  );
  for (const q of quads) {
    if (
      q.subject.value === policy.id &&
      q.predicate.equals(rdfType) &&
      policyTypes.some((type) => q.object.equals(type))
    ) {
      subjects.set(key(q.subject), q.subject);
    }
  }
  const [subject] = subjects.values();
  if (subjects.size !== 1 || !subject) throw new PolicySubjectUnsupportedError(policy.id);
  const root = subject;
  const namedNodes = new Set<string>();
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      if (term.termType === "NamedNode") namedNodes.add(term.value);
      else if (term.termType === "Literal") namedNodes.add(term.datatype.value);
    }
  }
  const rules = new Map<string, string>();
  const duties = new Map<string, string>();
  const identify = (term: Term, kind: "rule" | "duty", ids: Map<string, string>) => {
    if (!ids.has(key(term))) {
      const id =
        term.termType === "NamedNode" ? term.value : `${policy.id}#${kind}-${ids.size + 1}`;
      if (term.termType !== "NamedNode" && namedNodes.has(id)) {
        throw new PolicyIdentifierCollisionError(id);
      }
      ids.set(key(term), id);
    }
  };
  // Dataset iteration order is the document order available at this API boundary.
  for (const q of quads) {
    if (
      q.subject.equals(root) &&
      ["permission", "prohibition"].some((name) => q.predicate.value === ODRL + name)
    ) {
      identify(q.object, "rule", rules);
    }
  }
  for (const q of quads) {
    if (
      (rules.has(key(q.subject)) && q.predicate.value === `${ODRL}duty`) ||
      (q.subject.equals(root) && q.predicate.value === `${ODRL}obligation`)
    ) {
      identify(q.object, "duty", duties);
    }
  }
  // solid-odrl drops nodes with no recognized action. Align its projected arrays
  // with the same valid references, retaining all other semantics in its model.
  function references(owner: Term, relation: string): Term[] {
    return [...data.match(owner, DataFactory.namedNode(ODRL + relation))]
      .map((q) => q.object)
      .filter((node) =>
        [...data.match(node, DataFactory.namedNode(`${ODRL}action`))].some(
          (q) => q.object.termType === "NamedNode" && Object.hasOwn(IRI_TO_ACTION, q.object.value),
        ),
      );
  }
  function dutyIds(
    values: readonly OdrlDuty[] | undefined,
    owner: Term,
    relation: string,
  ): OdrlDuty[] {
    const terms = references(owner, relation);
    return (values ?? []).map((duty, i) => ({ ...duty, id: duties.get(key(terms[i] as Term)) }));
  }
  function ruleIds(values: readonly OdrlRule[] | undefined, relation: string): OdrlRule[] {
    const terms = references(root, relation);
    return (values ?? []).map((rule, i) => {
      const term = terms[i] as Term;
      return {
        ...rule,
        id: rules.get(key(term)),
        duties: dutyIds(rule.duties, term, "duty"),
      };
    });
  }
  return {
    ...policy,
    permissions: ruleIds(policy.permissions, "permission"),
    prohibitions: ruleIds(policy.prohibitions, "prohibition"),
    obligations: dutyIds(policy.obligations, root, "obligation"),
  };
}

/** solid-odrl remains authoritative until a compatible WASM adapter is specified. */
export function evaluatePolicy(data: DatasetCore, ctx: PolicyContext): PolicyResult {
  const policy = policyFromRdf(data);
  if (!policy) return empty();
  const identified = identifiedPolicy(data, policy);
  const action =
    (Object.hasOwn(IRI_TO_ACTION, ctx.action) ? IRI_TO_ACTION[ctx.action] : undefined) ??
    (Object.hasOwn(ACTION_IRI, ctx.action) ? (ctx.action as keyof typeof ACTION_IRI) : undefined);
  if (!action) return empty();
  const result = evaluate(
    identified,
    {
      action,
      target: ctx.target,
      agent: ctx.assignee,
      attributes: ctx.purpose === undefined ? {} : { purpose: ctx.purpose },
    },
    { now: ctx.now },
  );
  const identifier = (id: string | undefined): string => {
    if (id === undefined) throw new Error("Policy trace is missing an identifier");
    return id;
  };
  return {
    allow: result.decision === "permit",
    matched: [...result.matchedPermissions, ...result.matchedProhibitions].map((rule) =>
      identifier(rule.id),
    ),
    unmet: result.duties.filter((duty) => !duty.fulfilled).map((duty) => identifier(duty.id)),
  };
}
