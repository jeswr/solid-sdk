// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import type { DataFactory, Term } from "@rdfjs/types";
import { DataFactory as Factory } from "n3";
import { expandDatatype, iriMapper, literalMapper, readLiteral } from "./datatypes.js";
import { isSafeAbsoluteIri } from "./guards.js";
import {
  type AnyManifestEntity,
  isCompositeEntity,
  type ManifestEntity,
  ManifestError,
  type ManifestField,
  type ManifestNode,
} from "./manifest.js";

export type ConstraintTerm =
  | { kind: "iri"; value: string }
  | { kind: "literal"; value: string; datatype: string };
export type ConstraintSeverity = "Violation" | "Warning" | "Info";
export interface HasValueConstraint {
  term: ConstraintTerm;
  severity: ConstraintSeverity;
}
export type InvariantExpression =
  | { op: "hasValue"; path: string; term: ConstraintTerm }
  | { op: "not"; expression: InvariantExpression }
  | { op: "and"; expressions: InvariantExpression[] }
  | { op: "or"; expressions: InvariantExpression[] }
  | {
      op: "qualified";
      path: string;
      targetClass: string;
      minCount: number;
      expression: InvariantExpression;
    };
export interface EntityInvariant {
  shape: string;
  severity: ConstraintSeverity;
  message?: string;
  expression: InvariantExpression;
}
export type InvariantOwner = ManifestEntity | ManifestNode;
export const MAX_INVARIANT_DEPTH = 4;
export const MAX_INVARIANT_ATOMS = 16;

function fail(message: string): never {
  throw new ManifestError(`invariant: ${message}`);
}
function object(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("expected an object");
  for (const key of Object.keys(raw)) if (!keys.includes(key)) fail(`unknown key ${key}`);
  return raw as Record<string, unknown>;
}
function iri(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 4096 || !isSafeAbsoluteIri(raw))
    fail("expected a safe absolute IRI");
  return raw;
}
export function constraintTerm(term: ConstraintTerm, factory: DataFactory = Factory): Term {
  return term.kind === "iri"
    ? factory.namedNode(term.value)
    : factory.literal(term.value, factory.namedNode(term.datatype));
}

/** Exact, writable RDF identity, checked against the owning field's complete scalar contract. */
export function validateConstraintTerm(raw: unknown, field: ManifestField): ConstraintTerm {
  const t = object(raw, ["kind", "value", "datatype"]);
  if (typeof t.value !== "string" || t.value.length > 4096) fail("invalid term value");
  if (field.kind === "nested" || field.collection === "ordered")
    fail("hasValue requires a scalar value field");
  let term: ConstraintTerm;
  let value: unknown;
  try {
    if (t.kind === "iri" && field.kind === "iri" && t.datatype === undefined) {
      term = { kind: "iri", value: iri(t.value) };
      value = term.value;
    } else if (
      t.kind === "literal" &&
      field.kind === "literal" &&
      t.datatype === expandDatatype(field.datatype as string)
    ) {
      term = { kind: "literal", value: t.value, datatype: iri(t.datatype) };
      const rdf = constraintTerm(term);
      value = readLiteral(rdf);
      if (!rdf.equals(literalMapper(term.datatype).from(value as never, Factory)))
        fail("literal must have the field's canonical lexical form");
    } else return fail("term is incompatible with field datatype/kind");
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    return fail("invalid literal");
  }
  const g = field.guards;
  if (field.maxCount === 0) fail("hasValue is incompatible with maxCount 0");
  if (
    field.in &&
    !field.in.some((v) =>
      constraintTerm(term).equals(
        (field.kind === "iri" ? iriMapper() : literalMapper(field.datatype as string)).from(
          v as never,
          Factory,
        ),
      ),
    )
  )
    fail("term is outside field enumeration");
  if (
    typeof value === "number" &&
    ((Number.isNaN(value) && (g?.minInclusive !== undefined || g?.maxInclusive !== undefined)) ||
      (g?.minInclusive !== undefined && value < g.minInclusive) ||
      (g?.maxInclusive !== undefined && value > g.maxInclusive))
  )
    fail("term is outside field bounds");
  if (typeof value === "string") {
    if (
      (g?.minLength !== undefined && [...value].length < g.minLength) ||
      (g?.nonBlank && !value.trim())
    )
      fail("term violates string guards");
    for (const scheme of [g?.iriPattern, g?.iriScheme])
      if (
        scheme &&
        !value.startsWith("https://") &&
        !(scheme === "http-https" && value.startsWith("http://"))
      )
        fail("term violates IRI scheme");
  }
  return term;
}
export function validateHasValue(raw: unknown, field: ManifestField): HasValueConstraint {
  const c = object(raw, ["term", "severity"]);
  if (field.collection !== undefined) fail("property hasValue requires a singleton field");
  if (
    field.default !== undefined ||
    field.defaultNow !== undefined ||
    field.materializeDefault !== undefined
  )
    fail("hasValue cannot be combined with defaults");
  return { term: validateConstraintTerm(c.term, field), severity: severity(c.severity) };
}
function severity(raw: unknown): ConstraintSeverity {
  if (raw !== "Violation" && raw !== "Warning" && raw !== "Info") fail("invalid severity");
  return raw;
}

export function invariantOwners(entities: AnyManifestEntity[]): InvariantOwner[] {
  return entities.flatMap<InvariantOwner>((e) => (isCompositeEntity(e) ? e.nodes : [e]));
}

/** Validate every path in its own entity context, including the qualified target context. */
export function validateEntityInvariants(entities: AnyManifestEntity[]): void {
  const owners = invariantOwners(entities);
  const groups = new Map<InvariantOwner, ReadonlyMap<string, ManifestNode>>();
  for (const entity of entities) {
    if (!isCompositeEntity(entity)) continue;
    const nodes = new Map(entity.nodes.map((node) => [node.name, node]));
    for (const node of entity.nodes) groups.set(node, nodes);
  }
  for (const owner of owners) {
    if (owner.invariants === undefined) continue;
    if (
      !Array.isArray(owner.invariants) ||
      !owner.invariants.length ||
      owner.invariants.length > 64
    )
      fail("invariants must contain 1 to 64 constraints");
    const atomsByShape = new Map<string, number>();
    const seen = new Set<unknown>();
    owner.invariants = owner.invariants.map((raw) => {
      const c = object(raw, ["shape", "severity", "message", "expression"]);
      const shape = iri(c.shape);
      const parse = (
        rawExpr: unknown,
        focus: InvariantOwner,
        depth: number,
      ): InvariantExpression => {
        if (depth > MAX_INVARIANT_DEPTH || seen.has(rawExpr))
          fail("expression depth or reuse bound exceeded");
        seen.add(rawExpr);
        const e = object(rawExpr, [
          "op",
          "path",
          "term",
          "targetClass",
          "minCount",
          "expression",
          "expressions",
        ]);
        const keys = (allowed: string[]) => object(e, allowed);
        if (e.op === "not") {
          keys(["op", "expression"]);
          return { op: "not", expression: parse(e.expression, focus, depth + 1) };
        }
        if (e.op === "and" || e.op === "or") {
          keys(["op", "expressions"]);
          if (!Array.isArray(e.expressions) || !e.expressions.length || e.expressions.length > 16)
            fail("logical list must contain 1 to 16 expressions");
          return {
            op: e.op,
            expressions: e.expressions.map((child) => parse(child, focus, depth + 1)),
          };
        }
        const atoms = (atomsByShape.get(shape) ?? 0) + 1;
        atomsByShape.set(shape, atoms);
        if (atoms > MAX_INVARIANT_ATOMS) fail("too many atoms");
        const path = iri(e.path);
        const fields = focus.fields.filter((f) => f.predicate === path);
        if (fields.length !== 1 || !fields[0])
          fail("path must identify one field on the current entity");
        const field = fields[0];
        // Atoms read the raw path predicate exactly as SHACL does; a read alias would make the
        // runtime's field and the atom disagree, so it is not understood (fail closed).
        if (field.aliasPredicates?.length) fail("invariant paths cannot carry read aliases");
        if (e.op === "hasValue") {
          keys(["op", "path", "term"]);
          return {
            op: "hasValue",
            path,
            term: validateConstraintTerm(
              e.term,
              field.kind === "nested" ? { ...field, kind: "iri" } : field,
            ),
          };
        }
        if (e.op !== "qualified") fail("unknown operator");
        keys(["op", "path", "targetClass", "minCount", "expression"]);
        if (field.kind !== "nested" && (field.kind !== "iri" || field.collection !== "set"))
          fail("qualified path requires a composite link or IRI collection");
        if (
          !Number.isInteger(e.minCount) ||
          (e.minCount as number) < 1 ||
          (e.minCount as number) > 16
        )
          fail("qualified minimum must be 1 to 16");
        const targetClass = iri(e.targetClass);
        const targets = owners.filter((o) => o.typeIris.includes(targetClass));
        if (targets.length !== 1 || !targets[0]) fail("qualified target must identify one entity");
        const target = targets[0];
        if (field.kind === "nested" && groups.get(focus)?.get(field.node as string) !== target)
          fail("qualified target differs from link target");
        return {
          op: "qualified",
          path,
          targetClass,
          minCount: e.minCount as number,
          expression: parse(e.expression, target, depth),
        };
      };
      const result: EntityInvariant = {
        shape,
        severity: severity(c.severity),
        expression: parse(c.expression, owner, 0),
      };
      if (c.message !== undefined) {
        if (typeof c.message !== "string" || c.message.length > 4096) fail("invalid message");
        result.message = c.message;
      }
      return result;
    });
  }
}
