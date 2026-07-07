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

import { literalMapper } from "@jeswr/model-runtime";
import type { Quad, Quad_Object, Quad_Subject, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { Graph, parseTurtle, RDF, SH, XSD } from "./rdf.js";

/** A scalar a closed `sh:in` value set may carry (mirrors the manifest's ManifestScalar). */
export type ShapeScalar = string | number | boolean;

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
  /** `sh:severity`, if declared (the full IRI, e.g. `${SH}Violation`). */
  severity?: string;
  /**
   * `sh:in` — the closed value set, extracted from its RDF list to scalars. An
   * EMPTY array signals a present-but-malformed / empty `sh:in` (admission flags it).
   */
  in?: ShapeScalar[];
  /** `sh:minInclusive` (numeric lower bound), if declared. */
  minInclusive?: number;
  /** `sh:maxInclusive` (numeric upper bound), if declared. */
  maxInclusive?: number;
  /** `sh:minLength` (minimum string length), if declared. */
  minLength?: number;
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

/**
 * Coerce an RDF list member term to a manifest scalar (by literal datatype). The
 * numeric datatype set is NOT re-enumerated here — a field is numeric iff the
 * audited runtime's `literalMapper` resolves its datatype to `jsType === "number"`,
 * the SAME resolution `emit.ts` types against. Single-sourcing it through the
 * runtime means an `sh:in` enum can never disagree with the emitted TS / runtime
 * numeric treatment (this previously drifted for the unsigned XSD integer subtypes,
 * which `emit.ts` maps to `number` but a local set here omitted).
 */
function termToScalar(term: Term): ShapeScalar {
  if (term.termType === "Literal") {
    const dt = (term as Term & { datatype?: { value: string } }).datatype?.value;
    if (dt === `${XSD}boolean`) return term.value === "true" || term.value === "1";
    if (dt !== undefined && literalMapper(dt).jsType === "number") {
      const n = Number(term.value);
      if (Number.isFinite(n)) return n;
    }
    return term.value;
  }
  // NamedNode (an IRI value set) — carry the IRI string.
  return term.value;
}

/**
 * Walk an RDF list from `head` (`rdf:first`/`rdf:rest` → `rdf:nil`) into its member
 * terms. Returns `undefined` for a malformed list so a bad `sh:in` fails CLOSED
 * rather than silently truncating / first-picking. A list is malformed when: an
 * interior node is not a blank node / IRI; a node does not carry EXACTLY ONE
 * `rdf:first` AND EXACTLY ONE `rdf:rest` (a branching / duplicated link is rejected,
 * never silently resolved to its first object); the chain cycles; or it does not
 * terminate at the `rdf:nil` NamedNode (a literal / blank node whose lexical value
 * merely equals the nil IRI is NOT a valid terminator).
 */
function rdfList(graph: Graph, head: Term): Term[] | undefined {
  const Nil = `${RDF}nil`;
  const out: Term[] = [];
  const seen = new Set<string>();
  let node: Term = head;
  while (true) {
    // Termination: a well-formed list ends at the rdf:nil NamedNode.
    if (node.termType === "NamedNode" && node.value === Nil) return out;
    if (node.termType !== "NamedNode" && node.termType !== "BlankNode") return undefined;
    if (seen.has(node.value)) return undefined; // cycle guard
    seen.add(node.value);
    const firsts = graph.objects(node, `${RDF}first`);
    const rests = graph.objects(node, `${RDF}rest`);
    // Exactly one first + one rest per list node — a duplicate/branching link is
    // malformed, not silently first-picked (the old graph.object() single-take).
    if (firsts.length !== 1 || rests.length !== 1) return undefined;
    const first = firsts[0];
    const rest = rests[0];
    if (first === undefined || rest === undefined) return undefined;
    out.push(first);
    node = rest;
  }
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
      // sh:in — a closed value set (RDF list). An unparseable/nil list yields [] so
      // admission can flag it (present-but-empty ⇒ malformed enum).
      const inHead = graph.object(propObj, `${SH}in`);
      if (inHead !== undefined) {
        const members = rdfList(graph, inHead);
        constraint.in = members === undefined ? [] : members.map(termToScalar);
      }
      const minInclusive = numberOr(graph.value(propObj, `${SH}minInclusive`));
      if (minInclusive !== undefined) constraint.minInclusive = minInclusive;
      const maxInclusive = numberOr(graph.value(propObj, `${SH}maxInclusive`));
      if (maxInclusive !== undefined) constraint.maxInclusive = maxInclusive;
      const minLength = numberOr(graph.value(propObj, `${SH}minLength`));
      if (minLength !== undefined) constraint.minLength = minLength;
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
