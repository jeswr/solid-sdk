// AUTHORED-BY Claude Opus 4.8
/**
 * L2 (shapes) — parse a SHACL profile into a normalized shape model and produce the
 * SKOLEMIZED shape graph (design §5): every anonymous NodeShape / property shape
 * blank node is promoted to a deterministic named IRI, so the emitted `shapes.ttl`
 * is byte-reproducible (no blank-node label nondeterminism) and the manifest can
 * key stably off it. shapes.ttl is THE STABLE WAIST — everything below it (manifest,
 * runtime, forms) is input-language-agnostic.
 *
 * NOTE: for the current estate the OWL→SHACL derivation is nearly vacuous (the
 * constraint payload arrives via the hand-authored profile), so P0 takes the
 * profile's shapes AS the merged shapes; L2's derivation earns its keep as
 * ontologies tighten (design §5).
 */

import type { Quad, Quad_Object, Quad_Subject, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { Graph, parseTurtle, RDF, SH } from "./rdf.js";

/** The RDF term kind a property shape constrains its values to. */
export type ShapeKind = "iri" | "literal";

export interface ShapeConstraint {
  /** `sh:path` — the predicate IRI. */
  pathIri: string;
  /** `sh:name`, if declared. */
  name?: string;
  /** Resolved value kind (from `sh:nodeKind` / `sh:datatype` / `sh:class`). */
  kind: ShapeKind;
  /** `sh:datatype`, if declared (a literal field). */
  datatype?: string;
  /** `sh:class`, if declared (an IRI field constrained to a class). */
  hasClass?: string;
  minCount?: number;
  maxCount?: number;
  /** `sh:pattern`, if declared. */
  pattern?: string;
  /** `sh:severity`, if declared. */
  severity?: string;
  /** The skolemized IRI of the property shape (was a blank node). */
  shapeIri: string;
}

export interface NodeShapeModel {
  /** The skolemized NodeShape IRI (was a blank node). */
  iri: string;
  /** `sh:targetClass`. */
  targetClass: string;
  /** Property shapes, sorted by path IRI (stable). */
  properties: ShapeConstraint[];
}

export interface NormalizedShapes {
  /** The skolemized shape graph — byte-reproducible when serialised. */
  quads: Quad[];
  /** The node shapes, sorted by target class (stable). */
  nodeShapes: NodeShapeModel[];
}

/** The local name of an IRI (after the last `#` or `/`). */
export function localName(iri: string): string {
  const cut = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
  return cut >= 0 ? iri.slice(cut + 1) : iri;
}

function numberOr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function resolveKind(nodeKind: string | undefined, datatype: string | undefined): ShapeKind {
  if (nodeKind === `${SH}IRI` || nodeKind === `${SH}BlankNodeOrIRI`) return "iri";
  if (nodeKind === `${SH}Literal`) return "literal";
  if (datatype !== undefined) return "literal";
  // sh:class / no nodeKind + no datatype ⇒ an IRI-valued class instance.
  return "iri";
}

/**
 * Parse a SHACL profile into a normalized shape model with a skolemized graph.
 * `shapesBase` is the namespace the skolem IRIs are minted under.
 */
export function parseShapes(shapesTtl: string, shapesBase: string): NormalizedShapes {
  const quads = parseTurtle(shapesTtl);
  const graph = new Graph(quads);

  // NodeShapes = subjects carrying sh:targetClass.
  const nodeShapeSubjects: Array<{ subject: Term; targetClass: string }> = [];
  for (const q of graph.store.getQuads(null, `${SH}targetClass`, null, null)) {
    if (q.object.termType === "NamedNode") {
      nodeShapeSubjects.push({ subject: q.subject, targetClass: q.object.value });
    }
  }
  nodeShapeSubjects.sort((a, b) => a.targetClass.localeCompare(b.targetClass));

  // Blank-node → skolem IRI map (deterministic from class + path local names).
  const skolem = new Map<string, string>();
  const nodeShapes: NodeShapeModel[] = [];

  for (const { subject, targetClass } of nodeShapeSubjects) {
    const classLocal = localName(targetClass);
    const shapeIri = `${shapesBase}${classLocal}Shape`;
    if (subject.termType === "BlankNode") skolem.set(subject.value, shapeIri);

    const usedPropIris = new Set<string>();
    const properties: ShapeConstraint[] = [];
    for (const propObj of graph.objects(subject, `${SH}property`)) {
      const pathIri = graph.value(propObj, `${SH}path`);
      if (pathIri === undefined) continue; // a property shape must name a path
      const pathLocal = localName(pathIri);
      let propShapeIri = `${shapesBase}${classLocal}-${pathLocal}`;
      let n = 2;
      while (usedPropIris.has(propShapeIri))
        propShapeIri = `${shapesBase}${classLocal}-${pathLocal}-${n++}`;
      usedPropIris.add(propShapeIri);
      if (propObj.termType === "BlankNode") skolem.set(propObj.value, propShapeIri);

      const nodeKind = graph.value(propObj, `${SH}nodeKind`);
      const datatype = graph.value(propObj, `${SH}datatype`);
      const constraint: ShapeConstraint = {
        pathIri,
        kind: resolveKind(nodeKind, datatype),
        shapeIri: propShapeIri,
      };
      const name = graph.value(propObj, `${SH}name`);
      if (name !== undefined) constraint.name = name;
      if (datatype !== undefined) constraint.datatype = datatype;
      const hasClass = graph.value(propObj, `${SH}class`);
      if (hasClass !== undefined) constraint.hasClass = hasClass;
      const minCount = numberOr(graph.value(propObj, `${SH}minCount`));
      if (minCount !== undefined) constraint.minCount = minCount;
      const maxCount = numberOr(graph.value(propObj, `${SH}maxCount`));
      if (maxCount !== undefined) constraint.maxCount = maxCount;
      const pattern = graph.value(propObj, `${SH}pattern`);
      if (pattern !== undefined) constraint.pattern = pattern;
      const severity = graph.value(propObj, `${SH}severity`);
      if (severity !== undefined) constraint.severity = severity;
      properties.push(constraint);
    }
    properties.sort((a, b) => a.pathIri.localeCompare(b.pathIri));
    nodeShapes.push({ iri: shapeIri, targetClass, properties });
  }

  // Any remaining blank nodes (e.g. nested lists) get a deterministic skolem by a
  // canonical key over the triples they participate in.
  skolemizeRemaining(quads, skolem, shapesBase);

  // Rewrite the graph: replace mapped blank nodes with their skolem IRIs.
  const rewritten: Quad[] = quads.map((q) => {
    const subject = rewriteTerm(q.subject, skolem);
    const object = rewriteTerm(q.object, skolem);
    if (subject === q.subject && object === q.object) return q;
    return DataFactory.quad(
      subject as Quad_Subject,
      q.predicate as Quad["predicate"],
      object as Quad_Object,
    );
  });

  if (
    rewritten.some((q) => q.subject.termType === "BlankNode" || q.object.termType === "BlankNode")
  ) {
    throw new Error("shapes skolemization left an unmapped blank node");
  }

  return { quads: rewritten, nodeShapes };
}

function rewriteTerm(term: Term, skolem: Map<string, string>): Term {
  if (term.termType === "BlankNode") {
    const iri = skolem.get(term.value);
    if (iri !== undefined) return DataFactory.namedNode(iri);
  }
  return term;
}

/** Assign deterministic skolem IRIs to any blank node not already mapped. */
function skolemizeRemaining(quads: Quad[], skolem: Map<string, string>, shapesBase: string): void {
  const keyOf = new Map<string, string[]>();
  for (const q of quads) {
    if (q.subject.termType === "BlankNode" && !skolem.has(q.subject.value)) {
      const arr = keyOf.get(q.subject.value) ?? [];
      arr.push(`s ${q.predicate.value} ${q.object.termType}:${q.object.value}`);
      keyOf.set(q.subject.value, arr);
    }
    if (q.object.termType === "BlankNode" && !skolem.has(q.object.value)) {
      const arr = keyOf.get(q.object.value) ?? [];
      arr.push(`o ${q.subject.termType}:${q.subject.value} ${q.predicate.value}`);
      keyOf.set(q.object.value, arr);
    }
  }
  const canonical = [...keyOf.entries()]
    .map(([id, keys]) => ({ id, key: keys.slice().sort().join("|") }))
    .sort((a, b) => a.key.localeCompare(b.key));
  canonical.forEach(({ id }, index) => {
    skolem.set(id, `${shapesBase}n${index}`);
  });
}

/** Whether the graph declares a NodeShape (a `sh:NodeShape` typed subject). */
export function hasNodeShape(shapesTtl: string): boolean {
  const graph = new Graph(parseTurtle(shapesTtl));
  return (
    graph.store.getQuads(null, `${RDF}type`, DataFactory.namedNode(`${SH}NodeShape`), null).length >
    0
  );
}
