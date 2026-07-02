// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The ODRL policy ↔ RDF lowering + round-trip. `policyToRdf` lowers a structured
// OdrlPolicy to quads (via the typed wrapper write path — never hand-built
// triples); `policyToTurtle`/`policyToJsonLd` serialise; `policyFromRdf`/
// `parsePolicy` read a policy back from RDF (round-trip lossless on the policy
// fields). All RDF reads/writes go through src/wrappers.ts.

import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore, Quad } from "@rdfjs/types";
import { serialize } from "./serialize.js";
import type {
  OdrlConstraint,
  OdrlDuty,
  OdrlPolicy,
  OdrlRule,
  PolicyType,
  RuleType,
} from "./types.js";
import {
  ACTION_IRI,
  CONFLICT_IRI,
  IRI_TO_ACTION,
  IRI_TO_CONFLICT,
  IRI_TO_LEFT_OPERAND,
  IRI_TO_OPERATOR,
  LEFT_OPERAND_IRI,
  type LeftOperandName,
  ODRL_ACTION,
  ODRL_AGREEMENT,
  ODRL_ASSIGNEE,
  ODRL_ASSIGNER,
  ODRL_CONFLICT,
  ODRL_CONSTRAINT,
  ODRL_DUTY,
  ODRL_INLINE_CONTEXT,
  ODRL_LEFT_OPERAND,
  ODRL_OBLIGATION,
  ODRL_OFFER,
  ODRL_OPERATOR,
  ODRL_PERMISSION,
  ODRL_PROFILE,
  ODRL_PROHIBITION,
  ODRL_RIGHT_OPERAND,
  ODRL_SET,
  ODRL_TARGET,
  ODRL_UID,
  ODRLD_DELEGATED_UNDER,
  ODRLD_INLINE_CONTEXT_EXTENSION,
  type OdrlActionName,
  OPERATOR_IRI,
  type OperatorName,
  RDF_TYPE,
  XSD,
} from "./vocab.js";
import {
  allValues,
  type ConstraintNode,
  type DutyNode,
  firstIri,
  GraphBuilder,
  iriRef,
  type NodeRef,
  type PolicyNode,
  type RuleNode,
  wrapPolicy,
} from "./wrappers.js";

/** Map a policy subtype to its ODRL class IRI. */
function policyTypeIri(type: PolicyType | undefined): string {
  switch (type) {
    case "Offer":
      return ODRL_OFFER;
    case "Agreement":
      return ODRL_AGREEMENT;
    default:
      return ODRL_SET;
  }
}

/** Map an ODRL class IRI back to a policy subtype, or `undefined`. */
function policyTypeOf(iri: string): PolicyType | undefined {
  if (iri === ODRL_OFFER) return "Offer";
  if (iri === ODRL_AGREEMENT) return "Agreement";
  if (iri === ODRL_SET) return "Set";
  return undefined;
}

/** Infer the XSD datatype IRI for a constraint right-operand when not given. */
function inferDatatype(c: OdrlConstraint, value: string | number): string | undefined {
  if (c.datatype !== undefined) {
    return c.datatype;
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? `${XSD}integer` : `${XSD}decimal`;
  }
  // dateTime left-operand → typed dateTime literal (so comparison is temporal).
  if (c.leftOperand === "dateTime") {
    return `${XSD}dateTime`;
  }
  return undefined;
}

/** Write a constraint node under `parent` via `predicate` (odrl:constraint). */
function writeConstraint(b: GraphBuilder, parent: NodeRef, c: OdrlConstraint): void {
  const node = b.linkBlankNode(parent, ODRL_CONSTRAINT);
  b.addIri(node, ODRL_LEFT_OPERAND, LEFT_OPERAND_IRI[c.leftOperand]);
  b.addIri(node, ODRL_OPERATOR, OPERATOR_IRI[c.operator]);
  const rights = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  for (const r of rights) {
    // A recipient/purpose/spatial right-operand is typically an IRI; a count/time
    // is a typed literal. Heuristic: a string that looks like an absolute IRI for
    // an IRI-valued left-operand is written as an IRI, else a (typed) literal.
    if (typeof r === "string" && isIriValued(c.leftOperand) && looksLikeIri(r)) {
      b.addIri(node, ODRL_RIGHT_OPERAND, r);
    } else {
      const dt = inferDatatype(c, r);
      b.addLiteral(node, ODRL_RIGHT_OPERAND, String(r), dt);
    }
  }
}

/** Left-operands whose right-operand is an IRI (a party/purpose/place reference). */
function isIriValued(left: LeftOperandName): boolean {
  return (
    left === "recipient" || left === "purpose" || left === "spatial" || left === "systemDevice"
  );
}

/** A loose IRI check (absolute http(s)/urn/did or any scheme:rest). */
function looksLikeIri(v: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(v);
}

/** Write a duty node under `parent` via `predicate`. */
function writeDuty(b: GraphBuilder, parent: NodeRef, predicate: string, duty: OdrlDuty): void {
  const node = b.linkChild(parent, predicate, duty.id);
  b.addIri(node, ODRL_ACTION, ACTION_IRI[duty.action]);
  if (duty.target !== undefined) {
    b.addIri(node, ODRL_TARGET, duty.target);
  }
  for (const c of duty.constraints ?? []) {
    writeConstraint(b, node, c);
  }
}

/** Write a rule (permission/prohibition) node under the policy. */
function writeRule(
  b: GraphBuilder,
  policy: NodeRef,
  rule: OdrlRule,
  inheritedAssigner?: string,
  inheritedAssignee?: string,
): void {
  const predicate = rule.type === "prohibition" ? ODRL_PROHIBITION : ODRL_PERMISSION;
  const node = b.linkChild(policy, predicate, rule.id);
  b.addIri(node, ODRL_ACTION, ACTION_IRI[rule.action]);
  if (rule.target !== undefined) {
    b.addIri(node, ODRL_TARGET, rule.target);
  }
  const assignee = rule.assignee ?? inheritedAssignee;
  if (assignee !== undefined) {
    b.addIri(node, ODRL_ASSIGNEE, assignee);
  }
  const assigner = rule.assigner ?? inheritedAssigner;
  if (assigner !== undefined) {
    b.addIri(node, ODRL_ASSIGNER, assigner);
  }
  for (const c of rule.constraints ?? []) {
    writeConstraint(b, node, c);
  }
  // Duties only condition a permission (ODRL `odrl:duty`).
  if (rule.type === "permission") {
    for (const duty of rule.duties ?? []) {
      writeDuty(b, node, ODRL_DUTY, duty);
    }
  }
}

/**
 * Lower a structured {@link OdrlPolicy} to RDF quads (an `odrl:Policy` graph)
 * through the typed wrapper write path.
 */
export function policyToRdf(policy: OdrlPolicy): Quad[] {
  const b = new GraphBuilder();
  const subject = iriRef(policy.id);
  b.addIri(subject, RDF_TYPE, policyTypeIri(policy.type));
  // ODRL `uid` is the policy's identifier — set it to the policy IRI.
  b.addIri(subject, ODRL_UID, policy.id);
  for (const p of toArray(policy.profile)) {
    b.addIri(subject, ODRL_PROFILE, p);
  }
  if (policy.assigner !== undefined) {
    b.addIri(subject, ODRL_ASSIGNER, policy.assigner);
  }
  if (policy.assignee !== undefined) {
    b.addIri(subject, ODRL_ASSIGNEE, policy.assignee);
  }
  if (policy.conflict !== undefined) {
    b.addIri(subject, ODRL_CONFLICT, CONFLICT_IRI[policy.conflict]);
  }
  if (policy.delegatedUnder !== undefined) {
    b.addIri(subject, ODRLD_DELEGATED_UNDER, policy.delegatedUnder);
  }
  for (const rule of policy.permissions ?? []) {
    writeRule(b, subject, { ...rule, type: "permission" }, policy.assigner, policy.assignee);
  }
  for (const rule of policy.prohibitions ?? []) {
    writeRule(b, subject, { ...rule, type: "prohibition" }, policy.assigner, policy.assignee);
  }
  for (const duty of policy.obligations ?? []) {
    writeDuty(b, subject, ODRL_OBLIGATION, duty);
  }
  return b.quads();
}

/** Coerce a `string | string[] | undefined` to a string array. */
function toArray(v: string | readonly string[] | undefined): readonly string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v as string];
}

/** Serialise a policy to Turtle (default) or another n3 format. */
export function policyToTurtle(policy: OdrlPolicy, format?: string): Promise<string> {
  return serialize(policyToRdf(policy), format);
}

/**
 * Build the JSON-LD document for a policy: a deterministic projection of the SAME
 * policy (kept in lock-step with the RDF quads) with the pinned inline `@context`.
 * A consumer parses it via `@jeswr/fetch-rdf` (which handles `application/ld+json`)
 * — see {@link parsePolicy}.
 */
export function policyToJsonLd(policy: OdrlPolicy): Record<string, unknown> {
  // The delegation-profile context terms are added ONLY when the policy uses one,
  // so a plain ODRL policy's document (incl. its @context) is unchanged by the
  // profile's existence.
  const context =
    policy.delegatedUnder !== undefined
      ? { ...ODRL_INLINE_CONTEXT, ...ODRLD_INLINE_CONTEXT_EXTENSION }
      : ODRL_INLINE_CONTEXT;
  const doc: Record<string, unknown> = {
    "@context": context,
    "@id": policy.id,
    "@type": `odrl:${policy.type ?? "Set"}`,
    uid: { "@id": policy.id },
  };
  const profiles = toArray(policy.profile);
  if (profiles.length > 0) {
    doc.profile = profiles.map((p) => ({ "@id": p }));
  }
  if (policy.assigner !== undefined) doc.assigner = { "@id": policy.assigner };
  if (policy.assignee !== undefined) doc.assignee = { "@id": policy.assignee };
  if (policy.conflict !== undefined) doc.conflict = { "@id": CONFLICT_IRI[policy.conflict] };
  if (policy.delegatedUnder !== undefined) doc.delegatedUnder = { "@id": policy.delegatedUnder };
  if (policy.permissions && policy.permissions.length > 0) {
    doc.permission = policy.permissions.map((r) => ruleJsonLd(r, policy));
  }
  if (policy.prohibitions && policy.prohibitions.length > 0) {
    doc.prohibition = policy.prohibitions.map((r) => ruleJsonLd(r, policy));
  }
  if (policy.obligations && policy.obligations.length > 0) {
    doc.obligation = policy.obligations.map((d) => dutyJsonLd(d));
  }
  return doc;
}

function ruleJsonLd(rule: OdrlRule, policy: OdrlPolicy): Record<string, unknown> {
  const node: Record<string, unknown> = {};
  if (rule.id !== undefined) node["@id"] = rule.id;
  node.action = { "@id": ACTION_IRI[rule.action] };
  if (rule.target !== undefined) node.target = { "@id": rule.target };
  const assignee = rule.assignee ?? policy.assignee;
  if (assignee !== undefined) node.assignee = { "@id": assignee };
  const assigner = rule.assigner ?? policy.assigner;
  if (assigner !== undefined) node.assigner = { "@id": assigner };
  if (rule.constraints && rule.constraints.length > 0) {
    node.constraint = rule.constraints.map((c) => constraintJsonLd(c));
  }
  if (rule.type === "permission" && rule.duties && rule.duties.length > 0) {
    node.duty = rule.duties.map((d) => dutyJsonLd(d));
  }
  return node;
}

function dutyJsonLd(duty: OdrlDuty): Record<string, unknown> {
  const node: Record<string, unknown> = {};
  if (duty.id !== undefined) node["@id"] = duty.id;
  node.action = { "@id": ACTION_IRI[duty.action] };
  if (duty.target !== undefined) node.target = { "@id": duty.target };
  if (duty.constraints && duty.constraints.length > 0) {
    node.constraint = duty.constraints.map((c) => constraintJsonLd(c));
  }
  return node;
}

function constraintJsonLd(c: OdrlConstraint): Record<string, unknown> {
  const node: Record<string, unknown> = {
    leftOperand: { "@id": LEFT_OPERAND_IRI[c.leftOperand] },
    operator: { "@id": OPERATOR_IRI[c.operator] },
  };
  const rights = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  const emitted = rights.map((r) => {
    if (typeof r === "string" && isIriValued(c.leftOperand) && looksLikeIri(r)) {
      return { "@id": r };
    }
    const dt = inferDatatype(c, r);
    return dt !== undefined ? { "@value": String(r), "@type": dt } : String(r);
  });
  node.rightOperand = emitted.length === 1 ? emitted[0] : emitted;
  return node;
}

/**
 * Read a structured {@link OdrlPolicy} back from an already-parsed RDF dataset.
 * Returns the FIRST well-formed policy found, or `undefined` if there is none.
 */
export function policyFromRdf(dataset: DatasetCore): OdrlPolicy | undefined {
  for (const node of wrapPolicy(dataset).policies()) {
    const policy = projectPolicy(node);
    if (policy !== undefined) {
      return policy;
    }
  }
  return undefined;
}

/**
 * Parse a policy from a Turtle/JSON-LD string (or an already-parsed dataset).
 * Convenience over {@link policyFromRdf} that does the parse via `@jeswr/fetch-rdf`
 * (the sanctioned parser — never a bespoke one).
 */
export async function parsePolicy(
  input: string | DatasetCore,
  contentType = "text/turtle",
  baseIRI?: string,
): Promise<OdrlPolicy | undefined> {
  const dataset =
    typeof input === "string"
      ? await parseRdf(input, contentType, baseIRI ? { baseIRI } : {})
      : input;
  return policyFromRdf(dataset);
}

/** The first recognised ODRL policy subtype among a node's rdf:type terms. */
function firstPolicyType(
  types: ReadonlySet<{ termType: string; value: string }>,
): PolicyType | undefined {
  for (const t of types) {
    if (t.termType === "NamedNode") {
      const pt = policyTypeOf(t.value);
      if (pt !== undefined) {
        return pt;
      }
    }
  }
  return undefined;
}

/** Project the `profile` field: omitted (none), a scalar (one), or an array (many). */
function profileField(profiles: readonly string[]): { profile?: string | readonly string[] } {
  if (profiles.length === 0) {
    return {};
  }
  return { profile: profiles.length === 1 ? profiles[0] : profiles };
}

/** Project a {@link PolicyNode} to a plain {@link OdrlPolicy}, or `undefined`. */
function projectPolicy(node: PolicyNode): OdrlPolicy | undefined {
  const type = firstPolicyType(node.types);
  const profiles = [...node.profiles].filter((t) => t.termType === "NamedNode").map((t) => t.value);
  const assigner = firstIri(node.assigners);
  const assignee = firstIri(node.assignees);

  const conflictIri = firstIri(node.conflicts);
  const conflict = conflictIri !== undefined ? IRI_TO_CONFLICT[conflictIri] : undefined;
  const delegatedUnder = firstIri(node.delegatedUnders);

  const permissions = [...node.permissions]
    .map((r) => projectRule(r, "permission"))
    .filter((r): r is OdrlRule => r !== undefined);
  const prohibitions = [...node.prohibitions]
    .map((r) => projectRule(r, "prohibition"))
    .filter((r): r is OdrlRule => r !== undefined);
  const obligations = [...node.obligations]
    .map((d) => projectDuty(d))
    .filter((d): d is OdrlDuty => d !== undefined);

  return {
    id: node.value,
    ...(type !== undefined && { type }),
    ...profileField(profiles),
    ...(assigner !== undefined && { assigner }),
    ...(assignee !== undefined && { assignee }),
    ...(conflict !== undefined && { conflict }),
    ...(delegatedUnder !== undefined && { delegatedUnder }),
    ...(permissions.length > 0 && { permissions }),
    ...(prohibitions.length > 0 && { prohibitions }),
    ...(obligations.length > 0 && { obligations }),
  };
}

/** Project a {@link RuleNode} to a plain {@link OdrlRule}, or `undefined` if malformed. */
function projectRule(node: RuleNode, type: RuleType): OdrlRule | undefined {
  const action = actionOf(node.actions);
  if (action === undefined) {
    return undefined;
  }
  const target = firstIri(node.targets);
  const assignee = firstIri(node.assignees);
  const assigner = firstIri(node.assigners);
  const constraints = [...node.constraints]
    .map((c) => projectConstraint(c))
    .filter((c): c is OdrlConstraint => c !== undefined);
  const duties =
    type === "permission"
      ? [...node.duties].map((d) => projectDuty(d)).filter((d): d is OdrlDuty => d !== undefined)
      : [];

  const id = node.termType === "NamedNode" ? node.value : undefined;
  return {
    type,
    action,
    ...(id !== undefined && { id }),
    ...(target !== undefined && { target }),
    ...(assignee !== undefined && { assignee }),
    ...(assigner !== undefined && { assigner }),
    ...(constraints.length > 0 && { constraints }),
    ...(duties.length > 0 && { duties }),
  };
}

/** Project a {@link DutyNode} to a plain {@link OdrlDuty}, or `undefined`. */
function projectDuty(node: DutyNode): OdrlDuty | undefined {
  const action = actionOf(node.actions);
  if (action === undefined) {
    return undefined;
  }
  const target = firstIri(node.targets);
  const constraints = [...node.constraints]
    .map((c) => projectConstraint(c))
    .filter((c): c is OdrlConstraint => c !== undefined);
  const id = node.termType === "NamedNode" ? node.value : undefined;
  return {
    action,
    ...(id !== undefined && { id }),
    ...(target !== undefined && { target }),
    ...(constraints.length > 0 && { constraints }),
  };
}

/** Project a {@link ConstraintNode} to a plain {@link OdrlConstraint}, or `undefined`. */
function projectConstraint(node: ConstraintNode): OdrlConstraint | undefined {
  const leftIri = firstIri(node.leftOperands);
  const opIri = firstIri(node.operators);
  if (leftIri === undefined || opIri === undefined) {
    return undefined;
  }
  const left = IRI_TO_LEFT_OPERAND[leftIri];
  const op = IRI_TO_OPERATOR[opIri] as OperatorName | undefined;
  if (left === undefined || op === undefined) {
    return undefined;
  }
  const values = allValues(node.rightOperands);
  if (values.length === 0) {
    return undefined;
  }
  // Single value → scalar; multiple → array. Numeric literals are coerced to number.
  const coerced = values.map((v) => coerceValue(v.value, v.datatype, v.isIri));
  const rightOperand = coerced.length === 1 ? (coerced[0] as string | number) : coerced;
  // Preserve the datatype only when it carries information beyond inference.
  const dt = values[0]?.datatype;
  return {
    leftOperand: left,
    operator: op,
    rightOperand,
    ...(dt !== undefined && !values[0]?.isIri && { datatype: dt }),
  };
}

/** Coerce a parsed right-operand value to number (for numeric XSD types) or string. */
function coerceValue(value: string, datatype: string | undefined, isIri: boolean): string | number {
  if (isIri) {
    return value;
  }
  if (
    datatype === `${XSD}integer` ||
    datatype === `${XSD}decimal` ||
    datatype === `${XSD}double` ||
    datatype === `${XSD}float` ||
    datatype === `${XSD}long` ||
    datatype === `${XSD}int`
  ) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}

/** Map a rule/duty action term set to the ODRL action short name, if recognised. */
function actionOf(
  actions: ReadonlySet<{ termType: string; value: string }>,
): OdrlActionName | undefined {
  for (const a of actions) {
    if (a.termType === "NamedNode") {
      const name = IRI_TO_ACTION[a.value];
      if (name !== undefined) {
        return name;
      }
    }
  }
  return undefined;
}

// Re-export the reverse maps so consumers reading raw IRIs don't reach into vocab.
export { IRI_TO_ACTION, IRI_TO_LEFT_OPERAND, IRI_TO_OPERATOR };
