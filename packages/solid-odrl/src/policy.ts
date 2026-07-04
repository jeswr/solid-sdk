// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The ODRL policy ↔ RDF lowering + round-trip. `policyToRdf` lowers a structured
// OdrlPolicy to quads (via the typed wrapper write path — never hand-built
// triples); `policyToTurtle`/`policyToJsonLd` serialise; `policyFromRdf`/
// `parsePolicy` read a policy back from RDF (round-trip lossless on the policy
// fields). All RDF reads/writes go through src/wrappers.ts.

import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore, Quad } from "@rdfjs/types";
import { escapeIri, safeHttpIri, safeIri } from "./iri.js";
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

/**
 * Infer the XSD datatype IRI for a constraint right-operand when not given.
 * Exported (an internal cross-module helper, NOT part of the package's public
 * `index.ts` surface) so {@link decisionRecord}'s non-throwing constraint emitter
 * datatypes a recorded constraint IDENTICALLY to how a policy datatypes it.
 */
export function inferDatatype(c: OdrlConstraint, value: string | number): string | undefined {
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

/** Write a constraint node under `parent` via `odrl:constraint` (odrl:constraint). */
function writeConstraint(b: GraphBuilder, parent: NodeRef, c: OdrlConstraint): void {
  const node = b.linkBlankNode(parent, ODRL_CONSTRAINT);
  b.addIri(node, ODRL_LEFT_OPERAND, LEFT_OPERAND_IRI[c.leftOperand]);
  b.addIri(node, ODRL_OPERATOR, OPERATOR_IRI[c.operator]);
  const rights = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  for (const r of rights) {
    const safe = iriOperand(r, c.leftOperand);
    if (safe !== undefined) {
      b.addIri(node, ODRL_RIGHT_OPERAND, safe);
    } else {
      const dt = inferDatatype(c, r);
      b.addLiteral(node, ODRL_RIGHT_OPERAND, String(r), dt);
    }
  }
}

/**
 * Resolve a constraint right-operand for an IRI-valued left-operand under the SAME
 * evaluation-critical discipline as target/assignee/assigner/profile.
 *
 * A recipient/purpose/spatial/systemDevice operand is typically an ABSOLUTE IRI (an
 * http(s) resource/WebID OR a non-http concept IRI like a urn:/did: purpose); a
 * count/time is a typed literal. `evaluate()` compares constraint operands by EXACT
 * STRING, so — exactly like target/assignee — an IRI operand MUST be byte-identical
 * to its escaped form, else a serialise→parse round-trip would MUTATE it (`…/a b` →
 * `…/a%20b`) and the SAME policy would decide DIFFERENTLY in-memory vs after
 * round-trip. For a NEGATIVE operator (`neq`, `isNoneOf`) that silent escape can
 * WIDEN a permission (a constraint that should deny stops matching post-round-trip) —
 * a privilege escalation. So:
 *
 *  - not IRI-valued / not a string → `undefined` (the caller emits a typed literal,
 *    which round-trips losslessly and is injection-safe when quoted).
 *  - schemeless string → `undefined` (a plain string → a typed literal, same as
 *    above; never an IRI).
 *  - an absolute IRI (any scheme) that escaping would NOT mutate → returned
 *    byte-identical (a NamedNode operand; `safeIri` keeps urn:/did: semantics).
 *  - an absolute IRI that escaping WOULD mutate (contains a space / control /
 *    IRIREF-forbidden char) → THROW {@link OdrlSerializationError}. We do NOT
 *    silently escape an evaluation-participating operand.
 */
function iriOperand(r: string | number, left: LeftOperandName): string | undefined {
  if (typeof r !== "string" || !isIriValued(left)) {
    return undefined;
  }
  const safe = safeIri(r);
  if (safe === undefined) {
    // Schemeless (or leading/trailing-trimmable) → not an IRI; emit a literal.
    return undefined;
  }
  if (safe !== r) {
    const shown = r.length > 200 ? `${r.slice(0, 200)}…` : r;
    throw new OdrlSerializationError(
      `Refusing to serialise policy: an IRI-valued constraint right-operand (${left}) ` +
        `contains characters that require escaping, got ${JSON.stringify(shown)}. ` +
        "An evaluation-critical IRI operand must be a clean absolute IRI so the constraint " +
        "decides identically in-memory and after a serialise→parse round-trip; silently " +
        "escaping it would WIDEN a neq/isNoneOf constraint (fail-closed).",
    );
  }
  return safe;
}

/**
 * Left-operands whose right-operand is an IRI (a party/purpose/place reference).
 * Exported (internal cross-module helper, not re-exported from `index.ts`) so
 * {@link decisionRecord}'s constraint emitter decides IRI-vs-literal identically.
 */
export function isIriValued(left: LeftOperandName): boolean {
  return (
    left === "recipient" || left === "purpose" || left === "spatial" || left === "systemDevice"
  );
}

/**
 * Thrown when an EXPLICITLY-PROVIDED http(s)-contract IRI (a rule/duty/policy
 * `target`, `assignee`, `assigner`, or `profile`) cannot be made into a safe
 * http(s) IRI. We refuse to serialise rather than silently DROP it: a dropped
 * `target`/`assignee` is treated as a WILDCARD by {@link evaluate} (a rule with no
 * target matches ANY resource; with no assignee, ANY agent), so silently dropping a
 * malformed one would WIDEN the policy — a privilege escalation. Throwing is the
 * fail-closed choice that is safe for BOTH permissions (dropping would over-grant)
 * and prohibitions (dropping the whole rule would under-deny).
 */
export class OdrlSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdrlSerializationError";
  }
}

/**
 * Validate an EXPLICIT http(s)-contract IRI for an EVALUATION-CRITICAL field
 * (`target`, `assignee`, `assigner`, `profile` — the ones {@link evaluate} compares
 * by EXACT STRING). `undefined` in → `undefined` out (the field is genuinely absent
 * — a legitimate wildcard the caller chose). Otherwise it must be a safe http(s) IRI
 * that ESCAPING WOULD NOT MUTATE, else it THROWS {@link OdrlSerializationError}:
 *
 *  - not an http(s) IRI → throw (dropping it would widen the policy to a wildcard —
 *    a privilege escalation).
 *  - would be MUTATED by escaping (contains a space / control / IRIREF-forbidden
 *    char) → throw. This is load-bearing: if we silently escaped it, the RAW
 *    in-memory policy (`…/a b`) and the serialise→parse round-trip (`…/a%20b`) would
 *    carry DIFFERENT target/assignee strings and `evaluate()` would give DIFFERENT
 *    decisions for the SAME policy. Rejecting a would-mutate value guarantees
 *    in-memory == serialised == parsed for these fields. A clean absolute http(s)
 *    IRI passes through BYTE-IDENTICAL.
 *
 * (Non-evaluation fields like a constraint right-operand keep the general
 * escape-for-serialisation behaviour via {@link safeIri}, since their round-trip
 * identity is not compared.)
 */
function requireHttpIri(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const shown = value.length > 200 ? `${value.slice(0, 200)}…` : value;
  const safe = safeHttpIri(value);
  if (safe === undefined) {
    throw new OdrlSerializationError(
      `Refusing to serialise policy: ${field} must be an http(s) IRI, got ${JSON.stringify(shown)}. ` +
        "Dropping it would widen the policy to a wildcard (fail-closed).",
    );
  }
  if (safe !== value) {
    throw new OdrlSerializationError(
      `Refusing to serialise policy: ${field} contains characters that require escaping, got ${JSON.stringify(
        shown,
      )}. An evaluation-critical IRI (target/assignee/assigner/profile) must be a clean absolute ` +
        "http(s) IRI so it evaluates identically in-memory and after a serialise→parse round-trip.",
    );
  }
  return safe;
}

/** Write a duty node under `parent` via `predicate`. */
function writeDuty(b: GraphBuilder, parent: NodeRef, predicate: string, duty: OdrlDuty): void {
  // duty.id is a SUBJECT id that may legitimately be a non-http absolute IRI
  // (urn:/uuid:) — it is made breakout-proof at the GraphBuilder chokepoint
  // (escapeIri), so it is NOT dropped here.
  const node = b.linkChild(parent, predicate, duty.id);
  b.addIri(node, ODRL_ACTION, ACTION_IRI[duty.action]);
  const dutyTarget = requireHttpIri(duty.target, "duty.target");
  if (dutyTarget !== undefined) {
    b.addIri(node, ODRL_TARGET, dutyTarget);
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
  // rule.id is a SUBJECT id that may legitimately be a non-http absolute IRI
  // (urn:/uuid:) — made breakout-proof at the GraphBuilder chokepoint, not dropped.
  const node = b.linkChild(policy, predicate, rule.id);
  b.addIri(node, ODRL_ACTION, ACTION_IRI[rule.action]);
  const target = requireHttpIri(rule.target, "rule.target");
  if (target !== undefined) {
    b.addIri(node, ODRL_TARGET, target);
  }
  const assignee = requireHttpIri(rule.assignee ?? inheritedAssignee, "rule.assignee");
  if (assignee !== undefined) {
    b.addIri(node, ODRL_ASSIGNEE, assignee);
  }
  const assigner = requireHttpIri(rule.assigner ?? inheritedAssigner, "rule.assigner");
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
  // policy.id is the SUBJECT and its own uid — it may legitimately be a non-http
  // absolute IRI (urn:/uuid:), so it is NOT http-restricted here; the GraphBuilder
  // chokepoint (escapeIri) makes it breakout-proof for both the subject and uid.
  const subject = iriRef(policy.id);
  b.addIri(subject, RDF_TYPE, policyTypeIri(policy.type));
  // ODRL `uid` is the policy's identifier — set it to the policy IRI.
  b.addIri(subject, ODRL_UID, policy.id);
  for (const p of toArray(policy.profile)) {
    const safeProfile = requireHttpIri(p, "policy.profile");
    if (safeProfile !== undefined) {
      b.addIri(subject, ODRL_PROFILE, safeProfile);
    }
  }
  const policyAssigner = requireHttpIri(policy.assigner, "policy.assigner");
  if (policyAssigner !== undefined) {
    b.addIri(subject, ODRL_ASSIGNER, policyAssigner);
  }
  const policyAssignee = requireHttpIri(policy.assignee, "policy.assignee");
  if (policyAssignee !== undefined) {
    b.addIri(subject, ODRL_ASSIGNEE, policyAssignee);
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
  // Same sanitisation + fail-closed rule as the RDF path (policyToRdf): id fields
  // are escaped scheme-agnostically (escapeIri); http(s)-contract fields go through
  // requireHttpIri (throws on an unsafe EXPLICIT value rather than silently dropping
  // it to a wildcard). Keeps the two serialisations in lock-step so a policy the RDF
  // path REFUSES can never be smuggled out as JSON-LD. The delegation-profile
  // context terms are added ONLY when the policy uses one, so a plain ODRL policy's
  // document (incl. its @context) is unchanged by the profile's existence.
  const id = escapeIri(policy.id);
  const context =
    policy.delegatedUnder !== undefined
      ? { ...ODRL_INLINE_CONTEXT, ...ODRLD_INLINE_CONTEXT_EXTENSION }
      : ODRL_INLINE_CONTEXT;
  const doc: Record<string, unknown> = {
    "@context": context,
    "@id": id,
    "@type": `odrl:${policy.type ?? "Set"}`,
    uid: { "@id": id },
  };
  const profiles = toArray(policy.profile);
  const emittedProfiles = profiles
    .map((p) => requireHttpIri(p, "policy.profile"))
    .filter((p): p is string => p !== undefined);
  if (emittedProfiles.length > 0) {
    doc.profile = emittedProfiles.map((p) => ({ "@id": p }));
  }
  const jsonAssigner = requireHttpIri(policy.assigner, "policy.assigner");
  if (jsonAssigner !== undefined) doc.assigner = { "@id": jsonAssigner };
  const jsonAssignee = requireHttpIri(policy.assignee, "policy.assignee");
  if (jsonAssignee !== undefined) doc.assignee = { "@id": jsonAssignee };
  if (policy.conflict !== undefined) doc.conflict = { "@id": CONFLICT_IRI[policy.conflict] };
  // Escape the delegation-parent IRI exactly like the policy/rule/duty @id fields
  // (and like the RDF path's GraphBuilder chokepoint): delegatedUnder is a
  // subject-position id that may legitimately be a non-http absolute IRI, so it is
  // escaped scheme-agnostically (escapeIri) rather than http-restricted. Leaving it
  // raw would let a forbidden octet survive a JSON-LD serialise→parse round-trip and
  // silently break delegation-chain equality checks — the same escaping-parity class
  // as the audit-injection guard.
  if (policy.delegatedUnder !== undefined)
    doc.delegatedUnder = { "@id": escapeIri(policy.delegatedUnder) };
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
  if (rule.id !== undefined) node["@id"] = escapeIri(rule.id);
  node.action = { "@id": ACTION_IRI[rule.action] };
  const target = requireHttpIri(rule.target, "rule.target");
  if (target !== undefined) node.target = { "@id": target };
  const assignee = requireHttpIri(rule.assignee ?? policy.assignee, "rule.assignee");
  if (assignee !== undefined) node.assignee = { "@id": assignee };
  const assigner = requireHttpIri(rule.assigner ?? policy.assigner, "rule.assigner");
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
  if (duty.id !== undefined) node["@id"] = escapeIri(duty.id);
  node.action = { "@id": ACTION_IRI[duty.action] };
  const target = requireHttpIri(duty.target, "duty.target");
  if (target !== undefined) node.target = { "@id": target };
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
    // Mirror the RDF path (writeConstraint) exactly, incl. the evaluation-critical
    // reject-if-escaping-would-mutate rule for an IRI-valued operand (iriOperand),
    // so a policy the RDF path REFUSES can never be smuggled out as JSON-LD. A safe
    // ABSOLUTE IRI (any scheme — http(s)/urn:/did:) is an `@id`; a schemeless value
    // is a (typed) literal.
    const safe = iriOperand(r, c.leftOperand);
    if (safe !== undefined) {
      return { "@id": safe };
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
