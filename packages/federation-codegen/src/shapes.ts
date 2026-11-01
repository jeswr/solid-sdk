// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6
/**
 * L2 (shapes) — parse a SHACL profile into a normalized shape model and produce the
 * normalized shape graph (design §5): every anonymous NodeShape / property shape
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

import { createHash } from "node:crypto";
import { literalMapper } from "@jeswr/model-runtime";
import type { Quad, Quad_Object, Quad_Subject, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { type NormalizedOntology, owlRdfsAdapter } from "./adapter.js";
import { AdmissionError } from "./admission.js";
import { Graph, parseTurtle, RDF, RDFS, SH, XSD } from "./rdf.js";

/** A scalar a closed `sh:in` value set may carry (mirrors the manifest's ManifestScalar). */
export type ShapeScalar = string | number | boolean;

/** The RDF term kind a property shape constrains its values to. */
export type ShapeKind = "iri" | "literal";

export interface ShapeConstraint {
  /** `sh:path` — the predicate IRI. */
  pathIri: string;
  /** Ordered read aliases from sh:alternativePath, excluding the canonical member. */
  aliasPredicates?: string[];
  /** `sh:name`, if declared. */
  name?: string;
  /** Resolved value kind (from `sh:nodeKind` / `sh:datatype` / `sh:class`). */
  kind: ShapeKind;
  /** `sh:datatype`, if declared (a literal field). */
  datatype?: string;
  /** `sh:class`, if declared (an IRI field constrained to a class). */
  hasClass?: string;
  /** `sh:node`, if declared (the IRI of a referenced NodeShape the value must conform to). */
  node?: string;
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
  /** Sorted additional sh:targetClass values; canonical is the unique owl:Class. */
  aliasTypeIris?: string[];
  /** Property shapes, sorted by path IRI (stable). */
  properties: ShapeConstraint[];
}

export interface NormalizedShapes {
  /** Shape/list nodes skolemized; path roots retain deterministic blank labels (SHACL semantics). */
  quads: Quad[];
  /** Explicit input ontology subclass edges, for checking composite sh:class targets. */
  superClasses?: Record<string, string[]>;
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

function rejectAlias(subject: string, message: string): never {
  throw new AdmissionError([{ code: "invalid-read-alias", severity: "error", subject, message }]);
}

/** Only the bounded, flat alternativePath form is supported; all other paths fail closed. */
function resolvePath(
  graph: Graph,
  property: Term,
  ontology?: NormalizedOntology,
): {
  pathIri: string;
  aliasPredicates?: string[];
} {
  const paths = graph.objects(property, `${SH}path`);
  const path = paths[0];
  if (paths.length !== 1 || !path) rejectAlias(property.value, "expected exactly one sh:path");
  if (path.termType === "NamedNode") return { pathIri: path.value };
  if (path.termType !== "BlankNode") rejectAlias(property.value, "unsupported complex sh:path");
  const triples = graph.store.getQuads(path, null, null, null);
  const heads = graph.objects(path, `${SH}alternativePath`);
  if (triples.length !== 1 || heads.length !== 1 || !heads[0]) {
    rejectAlias(property.value, "only a flat sh:alternativePath is supported");
  }
  const members = rdfList(graph, heads[0]);
  if (
    !members ||
    members.length < 2 ||
    members.length > 4 ||
    members.some((m) => m.termType !== "NamedNode")
  ) {
    rejectAlias(property.value, "sh:alternativePath requires 2 to 4 IRI members");
  }
  const iris = members.map((m) => m.value);
  if (new Set(iris).size !== iris.length)
    rejectAlias(property.value, "duplicate alternativePath member");
  const declared = new Set(ontology?.properties.map((p) => p.iri));
  const canonical = iris.filter((iri) => declared.has(iri));
  if (canonical.length !== 1 || !canonical[0]) {
    rejectAlias(property.value, "alternativePath must contain exactly one ontology property");
  }
  return { pathIri: canonical[0], aliasPredicates: iris.filter((iri) => iri !== canonical[0]) };
}

/**
 * Parse SHACL into a normalized model. Complex-path roots retain stable blank labels.
 * `shapesBase` is the namespace the skolem IRIs are minted under.
 * The normalized ontology selects alias canonicals; raw quads supply subclass ancestry.
 * The legacy third-argument quad form uses the default OWL/RDFS adapter.
 */
export function parseShapes(
  shapesTtl: string,
  shapesBase: string,
  ontology?: NormalizedOntology,
  ontologyQuads?: Quad[],
): NormalizedShapes;
export function parseShapes(
  shapesTtl: string,
  shapesBase: string,
  ontologyQuads: Quad[],
): NormalizedShapes;
export function parseShapes(
  shapesTtl: string,
  shapesBase: string,
  ontologyOrQuads?: NormalizedOntology | Quad[],
  ontologyQuads: Quad[] = [],
): NormalizedShapes {
  const ontology = Array.isArray(ontologyOrQuads)
    ? owlRdfsAdapter.adapt(ontologyOrQuads)
    : ontologyOrQuads;
  const sourceQuads = Array.isArray(ontologyOrQuads) ? ontologyOrQuads : ontologyQuads;
  const quads = parseTurtle(shapesTtl);
  const graph = new Graph(quads);

  // Group targets by SHAPE, never by class: extra targets are read aliases.
  const subjects = new Map<string, Term>();
  for (const q of graph.store.getQuads(null, `${SH}targetClass`, null, null)) {
    subjects.set(`${q.subject.termType}:${q.subject.value}`, q.subject);
  }
  const nodeShapeSubjects = [...subjects.values()]
    .map((subject) => {
      const targets = graph.objects(subject, `${SH}targetClass`);
      if (targets.some((t) => t.termType !== "NamedNode") || targets.length > 5) {
        rejectAlias(subject.value, "targetClass must be IRIs with at most four aliases");
      }
      const iris = targets.map((t) => t.value).sort();
      if (iris.length === 1) return { subject, targetClass: iris[0] as string };
      const declared = new Set(
        ontology?.classes.filter((c) => c.owlClass === true).map((c) => c.iri),
      );
      const canonical = iris.filter((iri) => declared.has(iri));
      if (canonical.length !== 1 || !canonical[0]) {
        rejectAlias(
          subject.value,
          "multiple targetClass values require exactly one ontology owl:Class",
        );
      }
      return {
        subject,
        targetClass: canonical[0],
        aliasTypeIris: iris.filter((iri) => iri !== canonical[0]),
      };
    })
    .sort((a, b) => a.targetClass.localeCompare(b.targetClass));
  if (new Set(nodeShapeSubjects.map((s) => s.targetClass)).size !== nodeShapeSubjects.length) {
    rejectAlias(shapesBase, "multiple NodeShapes for one canonical targetClass");
  }

  // Blank-node → skolem IRI map (deterministic from class + path local names).
  const skolem = new Map<string, string>();
  // SHACL interprets an IRI-valued sh:path as a predicate, regardless of its
  // outgoing triples. Complex-path roots MUST stay blank, with stable labels.
  const pathRoots = new Set<string>();
  const nodeShapes: NodeShapeModel[] = [];

  for (const { subject, targetClass, aliasTypeIris } of nodeShapeSubjects) {
    const classLocal = localName(targetClass);
    const shapeIri = `${shapesBase}${classLocal}Shape`;
    if (subject.termType === "BlankNode") skolem.set(subject.value, shapeIri);

    const usedPropIris = new Set<string>();
    const properties: ShapeConstraint[] = [];
    for (const propObj of graph.objects(subject, `${SH}property`)) {
      const { pathIri, aliasPredicates } = resolvePath(graph, propObj, ontology);
      const pathRoot = graph.object(propObj, `${SH}path`);
      if (aliasPredicates && pathRoot?.termType === "BlankNode") pathRoots.add(pathRoot.value);
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
        ...(aliasPredicates ? { aliasPredicates } : {}),
        kind: resolveKind(nodeKind, datatype),
        shapeIri: propObj.termType === "NamedNode" ? propObj.value : propShapeIri,
      };
      const name = graph.value(propObj, `${SH}name`);
      if (name !== undefined) constraint.name = name;
      if (datatype !== undefined) constraint.datatype = datatype;
      const hasClass = graph.value(propObj, `${SH}class`);
      if (hasClass !== undefined) constraint.hasClass = hasClass;
      // sh:node — a reference to another NodeShape the value must conform to. A NamedNode
      // reference names a link to a structured sub-node (the composite driver reads it);
      // an inline blank-node sh:node is skolemized elsewhere, so only a named reference is
      // carried here (the composite binds nodes by their NodeShape target class / config).
      const nodeRef = graph.object(propObj, `${SH}node`);
      if (nodeRef !== undefined && nodeRef.termType === "NamedNode") {
        constraint.node = nodeRef.value;
      }
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
    nodeShapes.push({
      iri: subject.termType === "NamedNode" ? subject.value : shapeIri,
      targetClass,
      ...(aliasTypeIris ? { aliasTypeIris } : {}),
      properties,
    });
  }

  const fields = nodeShapes.flatMap((shape) => shape.properties);
  const canonicalPredicates = new Set(fields.map((field) => field.pathIri));
  const aliases = new Set<string>();
  for (const field of fields) {
    for (const alias of field.aliasPredicates ?? []) {
      if (canonicalPredicates.has(alias) || aliases.has(alias)) {
        rejectAlias(field.shapeIri, "alias overlaps another field predicate or alias");
      }
      aliases.add(alias);
    }
  }

  // Any remaining blank nodes (e.g. nested lists) get a deterministic skolem by a
  // canonical key over the triples they participate in.
  skolemizeRemaining(quads, skolem, shapesBase);

  // Rewrite the graph: replace mapped blank nodes with their skolem IRIs.
  const rewritten: Quad[] = quads.map((q) => {
    const subject = rewriteTerm(q.subject, skolem, pathRoots);
    const object = rewriteTerm(q.object, skolem, pathRoots);
    if (subject === q.subject && object === q.object) return q;
    return DataFactory.quad(
      subject as Quad_Subject,
      q.predicate as Quad["predicate"],
      object as Quad_Object,
    );
  });

  const allowedBlanks = new Set(
    [...pathRoots].map((id) => stablePathLabel(skolem.get(id) as string)),
  );
  if (
    rewritten.some((q) =>
      [q.subject, q.object].some(
        (term) => term.termType === "BlankNode" && !allowedBlanks.has(term.value),
      ),
    )
  ) {
    throw new Error("shapes skolemization left an unmapped blank node");
  }

  const superClasses: Record<string, string[]> = Object.create(null);
  for (const q of sourceQuads) {
    if (
      q.predicate.value === `${RDFS}subClassOf` &&
      q.subject.termType === "NamedNode" &&
      q.object.termType === "NamedNode"
    ) {
      const parents = superClasses[q.subject.value] ?? [];
      parents.push(q.object.value);
      superClasses[q.subject.value] = parents;
    }
  }
  return { quads: rewritten, nodeShapes, superClasses };
}

function stablePathLabel(iri: string): string {
  return `path_${createHash("sha256").update(iri).digest("hex")}`;
}

function rewriteTerm(term: Term, skolem: Map<string, string>, pathRoots: Set<string>): Term {
  if (term.termType === "BlankNode") {
    const iri = skolem.get(term.value);
    if (iri !== undefined)
      return pathRoots.has(term.value)
        ? DataFactory.blankNode(stablePathLabel(iri))
        : DataFactory.namedNode(iri);
  }
  return term;
}

/** Assign deterministic skolem IRIs to any blank node not already mapped. */
function skolemizeRemaining(quads: Quad[], skolem: Map<string, string>, shapesBase: string): void {
  const ids = new Set<string>();
  for (const q of quads)
    for (const term of [q.subject, q.object]) {
      if (term.termType === "BlankNode" && !skolem.has(term.value)) ids.add(term.value);
    }
  let colors = new Map([...ids].map((id) => [id, "blank"]));
  const key = (term: Term): string => {
    if (term.termType === "BlankNode")
      return skolem.get(term.value) ?? colors.get(term.value) ?? "blank";
    return JSON.stringify(term);
  };
  // Propagate anchored property identities through every RDF-list cell. Hashes keep
  // the refinement bounded in size; neither blank labels nor input quad order enter it.
  for (let round = 0; round <= ids.size; round++) {
    const next = new Map<string, string>();
    for (const id of ids) {
      const edges: string[] = [];
      for (const q of quads) {
        if (q.subject.termType === "BlankNode" && q.subject.value === id)
          edges.push(`s ${q.predicate.value} ${key(q.object)}`);
        if (q.object.termType === "BlankNode" && q.object.value === id)
          edges.push(`o ${key(q.subject)} ${q.predicate.value}`);
      }
      next.set(id, createHash("sha256").update(edges.sort().join("|")).digest("hex"));
    }
    colors = next;
  }
  [...ids]
    .sort((a, b) => (colors.get(a) as string).localeCompare(colors.get(b) as string))
    .forEach((id, index) => {
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
