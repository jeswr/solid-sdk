// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  CONFLICT_IRI,
  IRI_TO_ACTION,
  IRI_TO_LEFT_OPERAND,
  IRI_TO_OPERATOR,
  ODRL,
  type OdrlPolicy,
  policyFromRdf,
} from "@jeswr/solid-odrl";
import type { Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { NS, normalizeLiteral, RdfNode } from "./rdf.js";

type Shape = "policy" | "permission" | "prohibition" | "duty" | "constraint";
interface Field {
  required?: boolean;
  many?: boolean;
  values?: readonly string[];
  child?: Shape;
  operand?: boolean;
}
const action = { required: true, values: Object.keys(IRI_TO_ACTION) };
const constraints: Field = { many: true, child: "constraint" };
const rule = {
  [`${ODRL}action`]: action,
  [`${ODRL}target`]: {},
  [`${ODRL}assignee`]: {},
  [`${ODRL}assigner`]: {},
  [`${ODRL}constraint`]: constraints,
};
const shapes: Record<Shape, Record<string, Field>> = {
  policy: {
    [`${NS.rdf}type`]: {
      required: true,
      values: ["Policy", "Set", "Offer", "Agreement"].map((s) => ODRL + s),
    },
    [`${ODRL}uid`]: {},
    [`${ODRL}assigner`]: {},
    [`${ODRL}assignee`]: {},
    [`${ODRL}conflict`]: { values: Object.values(CONFLICT_IRI) },
    [`${ODRL}permission`]: { many: true, child: "permission" },
    [`${ODRL}prohibition`]: { many: true, child: "prohibition" },
    [`${ODRL}obligation`]: { many: true, child: "duty" },
  },
  permission: {
    ...rule,
    [`${NS.rdf}type`]: { values: [`${ODRL}Permission`] },
    [`${ODRL}duty`]: { many: true, child: "duty" },
  },
  prohibition: { ...rule, [`${NS.rdf}type`]: { values: [`${ODRL}Prohibition`] } },
  duty: {
    [`${NS.rdf}type`]: { values: [`${ODRL}Duty`] },
    [`${ODRL}action`]: action,
    [`${ODRL}target`]: {},
    [`${ODRL}constraint`]: constraints,
  },
  constraint: {
    [`${NS.rdf}type`]: { values: [`${ODRL}Constraint`] },
    [`${ODRL}leftOperand`]: { required: true, values: Object.keys(IRI_TO_LEFT_OPERAND) },
    [`${ODRL}operator`]: { required: true, values: Object.keys(IRI_TO_OPERATOR) },
    [`${ODRL}rightOperand`]: { required: true, many: true, operand: true },
  },
};
const reject = () => {
  throw new Error("Unsupported or malformed memory policy");
};
const key = (term: Term) => `${term.termType}:${term.value}`;

/** Validate the evaluator's RDF subset before accepting its permissive projection. */
export async function readMemoryPolicy(body: string, id: string): Promise<OdrlPolicy> {
  const dataset = await parseRdf(body, "text/turtle", { baseIRI: id });
  const policy = policyFromRdf(dataset);
  if (!policy) throw new Error("No memory policy in policy document");
  if (policy.id !== id) reject();
  const visited = new Set<string>();
  const subjects = new Set<string>();
  function visit(subject: Term, shape: Shape): void {
    if (subject.termType !== "NamedNode" && subject.termType !== "BlankNode") reject();
    const role = `${key(subject)}:${shape}`;
    if (visited.has(role)) return;
    visited.add(role);
    subjects.add(key(subject));
    const node = new RdfNode(subject, dataset);
    const fields = shapes[shape];
    for (const q of dataset) {
      if (q.subject.equals(subject) && !Object.hasOwn(fields, q.predicate.value)) reject();
    }
    for (const [predicate, field] of Object.entries(fields)) {
      const terms = node.terms(predicate);
      if ((field.required && terms.size === 0) || (!field.many && terms.size > 1)) reject();
      for (const term of terms) {
        if (field.child) visit(term, field.child);
        else if (field.operand && term.termType === "Literal") {
          if (term.language) reject();
          normalizeLiteral(term);
        } else if (term.termType !== "NamedNode") reject();
        if (field.values && !field.values.includes(term.value)) reject();
      }
    }
    if (shape === "constraint") {
      const rights = [...node.terms(`${ODRL}rightOperand`)];
      const kinds = rights.map((t) => (t.termType === "Literal" ? t.datatype.value : t.termType));
      if (new Set(kinds).size !== 1) reject();
      if (
        !["isAnyOf", "isAllOf", "isNoneOf"]
          .map((s) => ODRL + s)
          .includes(node.oneIri(`${ODRL}operator`)) &&
        rights.length !== 1
      )
        reject();
    }
  }
  visit(DataFactory.namedNode(id), "policy");
  const uid = new RdfNode(id, dataset).terms(`${ODRL}uid`);
  if ([...uid].some((term) => term.value !== id)) reject();
  for (const q of dataset) {
    if (!subjects.has(key(q.subject))) reject();
  }
  return policy;
}
