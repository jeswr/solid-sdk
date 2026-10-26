// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  ACTION_IRI,
  IRI_TO_ACTION,
  IRI_TO_LEFT_OPERAND,
  IRI_TO_OPERATOR,
  LEFT_OPERAND_IRI,
  type OdrlDuty,
  type OdrlPolicy,
  OPERATOR_IRI,
} from "@jeswr/solid-odrl";
import type { JsonValue } from "@jeswr/solid-vc";
import { type Node, RDF_TYPE } from "./rdf.js";
import { AGENT, type Constraint, type Limit, ODRL, type Policy, type Rule } from "./types.js";

const uri = (value: string): string => (value.includes(":") ? value : `${ODRL}${value}`);
const local = (value: string): string =>
  value.startsWith(ODRL) ? value.slice(ODRL.length) : value;
const mapped = (value: string, names: Readonly<Record<string, string>>): string =>
  Object.hasOwn(names, value) ? (names[value] as string) : value;
/** Shared action identities, with explicit extension IRIs left intact. */
export const actionIri = (value: string): string => uri(mapped(value, ACTION_IRI));
/** Shared operand identities for signed RDF and external engine context. */
export const leftOperandIri = (value: string): string => uri(mapped(value, LEFT_OPERAND_IRI));
const opt = (key: string, value: JsonValue | undefined): Record<string, JsonValue> =>
  value === undefined ? {} : { [key]: value };

function supportedFields(value: object, fields: readonly string[]): void {
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw new Error("Unsupported field in mandate policy");
}

function validateScalarCardinality(operator: string, count: number): void {
  if (["eq", "neq", "gt", "gteq", "lt", "lteq"].includes(local(operator)) && count !== 1)
    throw new Error("Expected exactly one right operand for a scalar operator");
}

function encodeConstraint(c: Constraint): JsonValue {
  supportedFields(c, ["leftOperand", "operator", "rightOperand", "datatype"]);
  validateScalarCardinality(c.operator, Array.isArray(c.rightOperand) ? c.rightOperand.length : 1);
  return {
    [`${ODRL}leftOperand`]: leftOperandIri(c.leftOperand),
    [`${ODRL}operator`]: uri(mapped(c.operator, OPERATOR_IRI)),
    [`${ODRL}rightOperand`]: c.rightOperand as JsonValue,
    ...opt(`${AGENT}datatype`, c.datatype),
  };
}
function encodeDuty(d: OdrlDuty): JsonValue {
  supportedFields(d, ["action", "id", "target", "constraints"]);
  return {
    [`${ODRL}action`]: actionIri(d.action),
    ...opt(`${ODRL}uid`, d.id),
    ...opt(`${ODRL}target`, d.target),
    [`${ODRL}constraint`]: (d.constraints ?? []).map(encodeConstraint),
  };
}
function encodeRule(r: Rule): JsonValue {
  supportedFields(r, [
    "type",
    "action",
    "id",
    "target",
    "assigner",
    "assignee",
    "constraints",
    "duties",
  ]);
  return {
    [`${ODRL}action`]: actionIri(r.action),
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
  supportedFields(p, [
    "id",
    "type",
    "assigner",
    "assignee",
    "conflict",
    "profile",
    "permissions",
    "prohibitions",
    "obligations",
  ]);
  return {
    [RDF_TYPE]: `${ODRL}${p.type ?? "Set"}`,
    [`${ODRL}uid`]: p.id,
    ...opt(`${ODRL}assigner`, p.assigner),
    ...opt(`${ODRL}assignee`, p.assignee),
    ...opt(`${ODRL}conflict`, p.conflict === undefined ? undefined : uri(p.conflict)),
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
  const { enforcement, ...constraint } = c;
  return {
    ...(encodeConstraint(constraint) as Record<string, JsonValue>),
    [`${AGENT}enforcement`]: enforcement,
  };
}
function optional(n: Node, predicate: string): string | undefined {
  return n.values(predicate).length === 0 ? undefined : n.iri(predicate);
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
  const operator = mapped(n.iri(`${ODRL}operator`), IRI_TO_OPERATOR) as Constraint["operator"];
  validateScalarCardinality(operator, rights.length);
  return {
    leftOperand: mapped(n.iri(`${ODRL}leftOperand`), IRI_TO_LEFT_OPERAND),
    operator,
    rightOperand: rights.length === 1 ? (rights[0] as string | number) : rights,
    datatype: optional(n, `${AGENT}datatype`),
  };
}
function decodeDuty(n: Node): OdrlDuty {
  return {
    action: mapped(n.iri(`${ODRL}action`), IRI_TO_ACTION) as OdrlDuty["action"],
    id: optional(n, `${ODRL}uid`),
    target: optional(n, `${ODRL}target`),
    constraints: n.values(`${ODRL}constraint`).map(decodeConstraint) as OdrlDuty["constraints"],
  };
}
function decodeRule(n: Node, type: Rule["type"]): Rule {
  return {
    type,
    action: mapped(n.iri(`${ODRL}action`), IRI_TO_ACTION),
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
  const conflict = optional(n, `${ODRL}conflict`);
  if (!["Set", "Agreement", "Offer"].includes(type)) throw new Error("Invalid policy type");
  return {
    id: n.iri(`${ODRL}uid`),
    type: type as Policy["type"],
    assigner: optional(n, `${ODRL}assigner`),
    assignee: optional(n, `${ODRL}assignee`),
    conflict: conflict === undefined ? undefined : (local(conflict) as Policy["conflict"]),
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
