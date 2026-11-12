// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  type ConstraintTerm,
  type EntityInvariant,
  type HasValueConstraint,
  type InvariantExpression,
  type ManifestField,
  validateConstraintTerm,
} from "@jeswr/model-runtime";
import type { Term } from "@rdfjs/types";
import { AdmissionError } from "./admission.js";
import { Graph, RDF, RDFS, SH, XSD } from "./rdf.js";
import {
  enumValues,
  type NodeShapeModel,
  type NormalizedShapes,
  propertySources,
  type ShapeConstraint,
} from "./shapes.js";

export function shapeTerm(term: Term): ConstraintTerm {
  if (term.termType === "NamedNode") return { kind: "iri", value: term.value };
  if (term.termType === "Literal" && !term.language)
    return { kind: "literal", value: term.value, datatype: term.datatype.value };
  return reject(term.value, "hasValue requires an IRI or an admitted typed literal");
}

function reject(subject: string, message: string): never {
  throw new AdmissionError([{ code: "invalid-invariant", severity: "error", subject, message }]);
}

/** Check against the conjoined field, never an incomplete merged source. */
function checkedTerm(term: ConstraintTerm, c: ShapeConstraint): ConstraintTerm {
  const field: ManifestField = {
    name: "value",
    predicate: c.pathIri,
    kind: c.kind,
    ...(c.datatype ? { datatype: c.datatype } : {}),
    ...(enumValues(c) ? { in: enumValues(c) } : {}),
    ...(c.maxCount !== undefined ? { maxCount: c.maxCount } : {}),
    guards: {
      ...(c.minLength !== undefined ? { minLength: c.minLength } : {}),
      ...(c.minInclusive !== undefined ? { minInclusive: c.minInclusive } : {}),
      ...(c.maxInclusive !== undefined ? { maxInclusive: c.maxInclusive } : {}),
      ...(c.pattern === "\\S" ? { nonBlank: true } : {}),
      ...(c.pattern === "^https://" ? { iriPattern: "https" as const } : {}),
      ...(c.pattern === "^https?://" ? { iriPattern: "http-https" as const } : {}),
    },
  };
  try {
    return validateConstraintTerm(term, field);
  } catch (error) {
    return reject(c.shapeIri, String(error));
  }
}

export function propertyHasValue(c: ShapeConstraint): HasValueConstraint | undefined {
  const sources = propertySources(c).filter((s) => s.hasValue !== undefined);
  if (!sources.length) return undefined;
  if (c.maxCount !== 1 || c.ordered || c.node || (c.hasClass && !c.conceptIris))
    return reject(c.shapeIri, "property hasValue requires an admitted scalar or enum field");
  const term = checkedTerm(sources[0]?.hasValue as ConstraintTerm, c);
  if (sources.some((s) => JSON.stringify(s.hasValue) !== JSON.stringify(term)))
    return reject(c.shapeIri, "conflicting merged hasValue constraints");
  const severity = sources.some((s) => !s.severity || s.severity === `${SH}Violation`)
    ? "Violation"
    : sources.some((s) => s.severity === `${SH}Warning`)
      ? "Warning"
      : "Info";
  return { term, severity };
}

export interface ShapeInvariants {
  byClass: Map<string, EntityInvariant[]>;
  /** Nodes fully checked by this closed parser; ordinary admission must not reinterpret them. */
  consumed: Set<string>;
  /** Collection class constraints whose targets have an entity reader. */
  collectionLinks: Set<string>;
}

/** Parse the ORIGINAL graph at each call, independently of the compiled manifest. */
export function shapeInvariants(shapes: NormalizedShapes): ShapeInvariants {
  const graph = new Graph(shapes.quads);
  const consumed = new Set<string>();
  const collectionLinks = new Set<string>();
  const byClass = new Map<string, EntityInvariant[]>();
  const incoming = new Map<string, number>();
  const key = (t: Term) => JSON.stringify([t.termType, t.value]);
  for (const q of graph.store) incoming.set(key(q.object), (incoming.get(key(q.object)) ?? 0) + 1);
  const one = (node: Term | string, key: string): Term => {
    const terms = graph.objects(node, `${SH}${key}`);
    if (terms.length !== 1 || !terms[0])
      return reject(typeof node === "string" ? node : node.value, `expected one sh:${key}`);
    return terms[0];
  };
  const take = (node: Term): void => {
    if (
      !["BlankNode", "NamedNode"].includes(node.termType) ||
      consumed.has(node.value) ||
      incoming.get(key(node)) !== 1
    )
      reject(node.value, "expression/list nodes must be used once (no reuse or cycles)");
    consumed.add(node.value);
  };
  const closed = (node: Term | string, allowed: string[]): void => {
    for (const q of graph.store.getQuads(node as Term, null, null, null))
      if (!allowed.includes(q.predicate.value))
        reject(q.subject.value, `unsupported expression predicate ${q.predicate.value}`);
  };
  for (const shape of shapes.nodeShapes) {
    const invariants: EntityInvariant[] = [];
    for (const shapeIri of shape.shapeIris ?? [shape.iri]) {
      let atoms = 0;
      const parse = (node: Term, focus: NodeShapeModel, depth: number): InvariantExpression => {
        if (depth > 4) reject(shapeIri, "logical depth exceeds 4");
        take(node);
        const operators = ["not", "and", "or"].filter(
          (op) => graph.objects(node, `${SH}${op}`).length,
        );
        if (operators.length) {
          if (operators.length !== 1)
            reject(node.value, "expression must have exactly one operator");
          const op = operators[0] as "not" | "and" | "or";
          closed(node, [`${SH}${op}`]);
          return logical(op, one(node, op), focus, depth);
        }
        if (++atoms > 16) reject(shapeIri, "total atoms exceeds 16");
        const path = one(node, "path");
        if (path.termType !== "NamedNode")
          reject(node.value, "expression paths must be single predicate IRIs");
        const c = focus.properties.find((p) => p.pathIri === path.value);
        if (!c || c.aliasPredicates || c.ordered)
          return reject(node.value, "path must identify a direct field on the current entity");
        if (graph.objects(node, `${SH}hasValue`).length) {
          closed(node, [`${SH}path`, `${SH}hasValue`]);
          if (
            c.kind === "iri" &&
            c.hasClass &&
            !c.conceptIris &&
            c.maxCount !== 1 &&
            shapes.nodeShapes.some((s) => s.targetClass === c.hasClass)
          )
            for (const source of propertySources(c)) collectionLinks.add(source.shapeIri);
          return {
            op: "hasValue",
            path: path.value,
            term: checkedTerm(shapeTerm(one(node, "hasValue")), c),
          };
        }
        closed(node, [`${SH}path`, `${SH}qualifiedMinCount`, `${SH}qualifiedValueShape`]);
        const n = one(node, "qualifiedMinCount");
        if (
          n.termType !== "Literal" ||
          n.datatype.value !== `${XSD}integer` ||
          !/^\+?\d+$/.test(n.value) ||
          !Number.isSafeInteger(Number(n.value)) ||
          Number(n.value) < 1 ||
          Number(n.value) > 16
        )
          reject(node.value, "qualified minimum must be a positive xsd:integer <= 16");
        const target = c.node
          ? shapes.nodeShapes.find((s) => (s.shapeIris ?? [s.iri]).includes(c.node as string))
          : shapes.nodeShapes.find((s) => s.targetClass === c.hasClass);
        if (c.kind !== "iri" || !target || (!c.node && !c.compositeLink && c.maxCount === 1))
          return reject(
            node.value,
            "qualified path requires a composite link or class-linked IRI collection with a projected target",
          );
        if (!c.node) for (const source of propertySources(c)) collectionLinks.add(source.shapeIri);
        return {
          op: "qualified",
          path: path.value,
          targetClass: target.targetClass,
          minCount: Number(n.value),
          expression: parse(one(node, "qualifiedValueShape"), target, depth),
        };
      };
      const logical = (
        op: "not" | "and" | "or",
        operand: Term,
        focus: NodeShapeModel,
        depth: number,
      ): InvariantExpression => {
        if (depth > 4) reject(shapeIri, "logical depth exceeds 4");
        if (op === "not") return { op, expression: parse(operand, focus, depth + 1) };
        const expressions: InvariantExpression[] = [];
        let cell = operand;
        while (!(cell.termType === "NamedNode" && cell.value === `${RDF}nil`)) {
          take(cell);
          closed(cell, [`${RDF}first`, `${RDF}rest`]);
          const first = graph.objects(cell, `${RDF}first`),
            rest = graph.objects(cell, `${RDF}rest`);
          if (first.length !== 1 || rest.length !== 1 || !first[0] || !rest[0])
            reject(cell.value, "malformed logical RDF list");
          if (expressions.length >= 16) reject(cell.value, "logical list exceeds 16 operands");
          expressions.push(parse(first[0] as Term, focus, depth + 1));
          cell = rest[0] as Term;
        }
        if (!expressions.length) reject(shapeIri, "logical lists must be non-empty");
        return { op, expressions };
      };
      for (const op of ["not", "and", "or"] as const) {
        if (!graph.objects(shapeIri, `${SH}${op}`).length) continue;
        closed(shapeIri, [
          `${RDF}type`,
          `${SH}targetClass`,
          `${SH}property`,
          `${SH}not`,
          `${SH}and`,
          `${SH}or`,
          `${SH}message`,
          `${SH}severity`,
          `${RDFS}label`,
          `${RDFS}comment`,
        ]);
        const severity = graph.objects(shapeIri, `${SH}severity`);
        if (
          severity.length > 1 ||
          (severity[0] &&
            (severity[0].termType !== "NamedNode" ||
              ![`${SH}Violation`, `${SH}Warning`, `${SH}Info`].includes(severity[0].value)))
        )
          reject(shapeIri, "invalid invariant severity");
        const message = graph.objects(shapeIri, `${SH}message`);
        if (
          message.length > 1 ||
          message.some(
            (t) => t.termType !== "Literal" || (!t.language && t.datatype.value !== `${XSD}string`),
          )
        )
          reject(shapeIri, "expected at most one literal message");
        invariants.push({
          shape: shapeIri,
          severity: (severity[0]?.value.slice(SH.length) ??
            "Violation") as EntityInvariant["severity"],
          expression: logical(op, one(shapeIri, op), shape, 0),
          ...(message[0] ? { message: message[0].value } : {}),
        });
      }
    }
    if (invariants.length) byClass.set(shape.targetClass, invariants);
    for (const c of shape.properties) {
      for (const source of propertySources(c))
        if (graph.objects(source.shapeIri, `${SH}hasValue`).length > 1)
          reject(source.shapeIri, "expected one sh:hasValue");
      propertyHasValue(c);
    }
  }
  return { byClass, consumed, collectionLinks };
}
