// AUTHORED-BY Codex GPT-6.1-Sol
import type { OdrlDuty, OdrlPolicy } from "@jeswr/solid-odrl";
import type { JsonValue } from "@jeswr/solid-vc";
import { type Node, RDF_TYPE } from "./rdf.js";
import { AGENT, type Constraint, type Limit, ODRL, type Policy, type Rule } from "./types.js";

const uri = (value: string): string => (value.includes(":") ? value : `${ODRL}${value}`);
const local = (value: string): string =>
  value.startsWith(ODRL) ? value.slice(ODRL.length) : value;
const opt = (key: string, value: JsonValue | undefined): Record<string, JsonValue> =>
  value === undefined ? {} : { [key]: value };

function encodeConstraint(c: Constraint): JsonValue {
  return {
    [`${ODRL}leftOperand`]: uri(c.leftOperand),
    [`${ODRL}operator`]: uri(c.operator),
    [`${ODRL}rightOperand`]: c.rightOperand as JsonValue,
    ...opt(`${AGENT}datatype`, c.datatype),
  };
}
function encodeDuty(d: OdrlDuty): JsonValue {
  return { [`${ODRL}action`]: uri(d.action) };
}
function encodeRule(r: Rule): JsonValue {
  return {
    [`${ODRL}action`]: uri(r.action),
    ...opt(`${ODRL}uid`, r.id),
    ...opt(`${ODRL}target`, r.target),
    ...opt(`${ODRL}assigner`, r.assigner),
    ...opt(`${ODRL}assignee`, r.assignee),
    [`${ODRL}constraint`]: (r.constraints ?? []).map(encodeConstraint),
    [`${ODRL}duty`]: (r.duties ?? []).map(encodeDuty),
  };
}
/** Lower the policy into the signed RDF graph using solid-vc's RDF writer. */
export function encodePolicy(p: Policy): JsonValue {
  return {
    [RDF_TYPE]: `${ODRL}${p.type ?? "Set"}`,
    [`${ODRL}uid`]: p.id,
    ...opt(`${ODRL}assigner`, p.assigner),
    ...opt(`${ODRL}assignee`, p.assignee),
    ...opt(`${ODRL}conflict`, p.conflict),
    ...opt(`${ODRL}profile`, p.profile as JsonValue | undefined),
    [`${ODRL}permission`]: (p.permissions ?? []).map(encodeRule),
    [`${ODRL}prohibition`]: (p.prohibitions ?? []).map(encodeRule),
    [`${ODRL}obligation`]: (p.obligations ?? []).map(encodeDuty),
  };
}
/** Lower root prohibitions into ordinary ODRL prohibition rules. */
export const encodeProhibitions = (rules: readonly Rule[]): JsonValue[] => rules.map(encodeRule);
/** Encode an executor limit as an ODRL constraint plus agent:enforcement. */
export function encodeLimit(c: Limit): JsonValue {
  return {
    ...(encodeConstraint(c) as Record<string, JsonValue>),
    [`${AGENT}enforcement`]: c.enforcement,
  };
}
function optional(n: Node, predicate: string, iri = true): string | undefined {
  return n.values(predicate).length === 0 ? undefined : iri ? n.iri(predicate) : n.text(predicate);
}
function decodeConstraint(n: Node): Constraint {
  const rights = n.values(`${ODRL}rightOperand`).map((v) => {
    if (v.termType === "NamedNode") return v.value;
    if (v.termType !== "Literal") throw new Error("Invalid right operand");
    const datatype = (v as unknown as { datatype: { value: string } }).datatype.value;
    return datatype.endsWith("#integer") || datatype.endsWith("#double")
      ? Number(v.value)
      : v.value;
  });
  if (rights.length === 0) throw new Error("Missing right operand");
  return {
    leftOperand: local(n.iri(`${ODRL}leftOperand`)),
    operator: local(n.iri(`${ODRL}operator`)) as Constraint["operator"],
    rightOperand: rights.length === 1 ? (rights[0] as string | number) : rights,
    datatype: optional(n, `${AGENT}datatype`),
  };
}
function decodeDuty(n: Node): OdrlDuty {
  return { action: local(n.iri(`${ODRL}action`)) as OdrlDuty["action"] };
}
function decodeRule(n: Node, type: Rule["type"]): Rule {
  return {
    type,
    action: local(n.iri(`${ODRL}action`)),
    id: optional(n, `${ODRL}uid`),
    target: optional(n, `${ODRL}target`),
    assigner: optional(n, `${ODRL}assigner`),
    assignee: optional(n, `${ODRL}assignee`),
    constraints: n.values(`${ODRL}constraint`).map(decodeConstraint),
    duties: n.values(`${ODRL}duty`).map(decodeDuty),
  };
}
/** Read an embedded ODRL policy through typed RDF accessors. */
export function decodePolicy(n: Node): Policy {
  const type = local(n.iri(RDF_TYPE));
  if (!["Set", "Agreement", "Offer"].includes(type)) throw new Error("Invalid policy type");
  return {
    id: n.iri(`${ODRL}uid`),
    type: type as Policy["type"],
    assigner: optional(n, `${ODRL}assigner`),
    assignee: optional(n, `${ODRL}assignee`),
    conflict: optional(n, `${ODRL}conflict`, false) as Policy["conflict"],
    profile: optional(n, `${ODRL}profile`),
    permissions: n.values(`${ODRL}permission`).map((r) => decodeRule(r, "permission")),
    prohibitions: n.values(`${ODRL}prohibition`).map((r) => decodeRule(r, "prohibition")),
    obligations: n.values(`${ODRL}obligation`).map(decodeDuty),
  };
}
/** Read root prohibitions. */
export const decodeProhibitions = (n: Node): Rule[] =>
  n.values(`${ODRL}prohibition`).map((r) => decodeRule(r, "prohibition"));
/** Read and validate the limit vocabulary. */
export function decodeLimit(n: Node): Limit {
  const c = decodeConstraint(n);
  const enforcement = n.text(`${AGENT}enforcement`);
  if (
    c.operator !== "lteq" ||
    typeof c.rightOperand !== "number" ||
    !Number.isFinite(c.rightOperand) ||
    c.rightOperand < 0 ||
    !["hard", "soft"].includes(enforcement)
  )
    throw new Error("Invalid limit");
  return {
    ...c,
    operator: "lteq",
    rightOperand: c.rightOperand,
    enforcement: enforcement as Limit["enforcement"],
  };
}
/** Phase-B policy projection: engine evaluation remains a separate seam. */
export function bindingPolicy(id: string, assigner: string, assignee: string): OdrlPolicy {
  return { id, type: "Agreement", assigner, assignee };
}
