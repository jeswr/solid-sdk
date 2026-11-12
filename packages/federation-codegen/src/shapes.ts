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
import { isSafeAbsoluteIri, literalMapper, readLiteral } from "@jeswr/model-runtime";
import type { Quad, Quad_Object, Quad_Subject, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { type NormalizedOntology, owlRdfsAdapter } from "./adapter.js";
import { AdmissionError } from "./admission.js";
import { type CodegenConfig, isCompositeConfig } from "./config.js";
import { shapeInvariants, shapeTerm } from "./invariants.js";
import { mergeNodeShapes } from "./merge.js";
import { compareStrings, Graph, parseTurtle, RDF, RDFS, SH, XSD } from "./rdf.js";

/** A scalar a closed `sh:in` value set may carry (mirrors the manifest's ManifestScalar). */
export type ShapeScalar = string | number | boolean;

/** The RDF term kind a property shape constrains its values to. */
export type ShapeKind = "iri" | "literal";

export interface ShapeConstraint {
  /** Config-projected structural edge, including class-only nested links. */
  compositeLink?: true;
  hasValue?: import("@jeswr/model-runtime").ConstraintTerm;
  /** Config-selected ordered encoding; validated against the complete item shape. */
  ordered?: { position: string; value: string };
  /** `sh:path` — the predicate IRI. */
  pathIri: string;
  /** Ordered read aliases from sh:alternativePath, excluding the canonical member. */
  aliasPredicates?: string[];
  /** `sh:name`, if declared. */
  name?: string;
  /** Resolved value kind (from `sh:nodeKind` / `sh:datatype` / `sh:class`). */
  kind: ShapeKind;
  /** Explicit node kind, retained for cross-shape conflict detection. */
  nodeKind?: string;
  /** `sh:datatype`, if declared (a literal field). */
  datatype?: string;
  /** `sh:class`, if declared (an IRI field constrained to a class). */
  hasClass?: string;
  /** Closed, sorted named instances of hasClass from the input ontology. */
  conceptIris?: string[];
  /** Original constraints when several NodeShapes constrain this path. */
  sources?: ShapeConstraint[];
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
  /** All original shape identities when multiple shapes target this class. */
  shapeIris?: string[];
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

/** Original property shapes remain available to closed admission and diagnostics. */
export function propertySources(c: ShapeConstraint): ShapeConstraint[] {
  return c.sources ?? [c];
}

/** Conjoin an explicit sh:in with the ontology's closed concept identities. */
export function enumValues(c: ShapeConstraint): ShapeScalar[] | undefined {
  if (c.conceptIris === undefined) return c.in;
  return c.in === undefined ? c.conceptIris : c.conceptIris.filter((iri) => c.in?.includes(iri));
}

/**
 * Implicit class targets have no exact projection in the current manifest. SHACL
 * activates them from the SHAPES graph alone (a shape that is a SHACL instance of
 * rdfs:Class, i.e. through rdf:type then rdfs:subClassOf* in that graph), so the
 * ontology is deliberately not consulted: its own class declarations are not targets.
 */
export function implicitClassTargets(quads: readonly Quad[]): string[] {
  const key = (term: Term) => `${term.termType}:${term.value}`;
  const shapes = new Map<string, Term>();
  const types = new Map<string, Term[]>();
  const parents = new Map<string, Term[]>();
  for (const q of quads) {
    if (
      q.predicate.value.startsWith(SH) ||
      (q.predicate.value === `${RDF}type` &&
        [`${SH}NodeShape`, `${SH}PropertyShape`].includes(q.object.value))
    )
      shapes.set(key(q.subject), q.subject);
  }
  for (const graph of [quads])
    for (const q of graph) {
      const index =
        q.predicate.value === `${RDF}type`
          ? types
          : q.predicate.value === `${RDFS}subClassOf`
            ? parents
            : undefined;
      if (index) {
        const values = index.get(key(q.subject)) ?? [];
        values.push(q.object);
        index.set(key(q.subject), values);
      }
    }
  let reads = 0;
  const found: string[] = [];
  for (const [id, shape] of shapes) {
    const pending = [...(types.get(id) ?? [])];
    const seen = new Set<string>();
    while (pending.length) {
      if (++reads > 10000)
        throw new TypeError("implicit class target inspection exceeds the 10,000-read budget");
      const type = pending.pop() as Term;
      if (type.termType !== "NamedNode" && type.termType !== "BlankNode") continue;
      if (
        type.termType === "NamedNode" &&
        [`${RDFS}Class`, "http://www.w3.org/2002/07/owl#Class"].includes(type.value)
      ) {
        found.push(shape.value);
        break;
      }
      const typeKey = key(type);
      if (seen.has(typeKey)) continue;
      seen.add(typeKey);
      pending.push(...(parents.get(typeKey) ?? []));
    }
  }
  return found;
}

/** RDF permits co-typing; disjoint focus sets cannot be proved from this profile. */
export function sharedAliasPredicates(shapes: NormalizedShapes): string[] {
  const owners = new Map<string, ShapeConstraint[]>();
  for (const shape of shapes.nodeShapes)
    for (const property of shape.properties) {
      const prior = owners.get(property.pathIri) ?? [];
      prior.push(property);
      owners.set(property.pathIri, prior);
    }
  return [...owners]
    .filter(
      ([, properties]) =>
        properties.length > 1 && properties.some((property) => property.aliasPredicates?.length),
    )
    .map(([predicate]) => predicate);
}

/** The local name of an IRI (after the last `#` or `/`). */
export function localName(iri: string): string {
  const cut = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
  return cut >= 0 ? iri.slice(cut + 1) : iri;
}

function rejectParameter(subject: string, parameter: string): never {
  throw new AdmissionError([
    {
      code: "invalid-shacl-parameter",
      severity: "error",
      subject,
      message: `malformed ${SH}${parameter}: invalid term kind, datatype or lexical form`,
    },
  ]);
}

const COUNT_PARAMETERS = new Set(["minCount", "maxCount", "minLength", "maxLength"]);
const BOUND_PARAMETERS = new Set(["minInclusive", "maxInclusive", "minExclusive", "maxExclusive"]);
const IRI_PARAMETERS = new Set(["datatype", "class", "nodeKind", "severity"]);

/** Validate raw terms BEFORE any value-only projection can erase their RDF types. */
function validateParameters(quads: Quad[]): void {
  const severityOwners = new Set<string>();
  for (const q of quads) {
    if (!q.predicate.value.startsWith(SH)) continue;
    const parameter = q.predicate.value.slice(SH.length);
    const term = q.object;
    const reject = () => rejectParameter(q.subject.value, parameter);
    if (parameter === "severity") {
      const owner = `${q.subject.termType}:${q.subject.value}`;
      if (severityOwners.has(owner)) reject();
      severityOwners.add(owner);
    }
    if (COUNT_PARAMETERS.has(parameter) || BOUND_PARAMETERS.has(parameter)) {
      if (term.termType !== "Literal") rejectParameter(q.subject.value, parameter);
      if (COUNT_PARAMETERS.has(parameter) && term.datatype.value !== `${XSD}integer`) reject();
      if (literalMapper(term.datatype.value).jsType !== "number") reject();
      let value: unknown;
      try {
        value = readLiteral(term);
      } catch {
        reject();
      }
      if (typeof value !== "number" || !Number.isFinite(value))
        rejectParameter(q.subject.value, parameter);
      if (COUNT_PARAMETERS.has(parameter) && (!Number.isSafeInteger(value) || value < 0)) reject();
    } else if (parameter === "pattern" || parameter === "flags") {
      if (term.termType !== "Literal" || term.datatype.value !== `${XSD}string`) reject();
    } else if (IRI_PARAMETERS.has(parameter)) {
      if (term.termType !== "NamedNode" || !isSafeAbsoluteIri(term.value)) reject();
      if (
        parameter === "severity" &&
        ![`${SH}Violation`, `${SH}Warning`, `${SH}Info`].includes(term.value)
      )
        reject();
    }
  }
}

/** Decode enum members with exactly the runtime's strict datatype readers. */
function termToScalar(term: Term, constraint: ShapeConstraint): ShapeScalar {
  const reject = () => rejectParameter(constraint.shapeIri, "in");
  if (constraint.kind === "iri") {
    if (term.termType !== "NamedNode" || !isSafeAbsoluteIri(term.value)) return reject();
    return term.value;
  }
  if (term.termType !== "Literal" || term.datatype.value !== constraint.datatype) return reject();
  let value: unknown;
  try {
    value = readLiteral(term);
    // ManifestScalar retains values only. Reject an enum whose original RDF
    // identity cannot be reproduced by the runtime's canonical literal writer.
    const canonical = literalMapper(term.datatype.value).from(value as never, DataFactory);
    if (!term.equals(canonical)) return reject();
  } catch {
    return reject();
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // Date objects / infinities have no lossless ManifestScalar representation.
  return reject();
}

function parameterNumber(graph: Graph, subject: Term, parameter: string): number | undefined {
  const term = graph.object(subject, `${SH}${parameter}`);
  return term === undefined ? undefined : (readLiteral(term) as number);
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
  config?: CodegenConfig,
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
  config?: CodegenConfig,
): NormalizedShapes {
  if (!isSafeAbsoluteIri(shapesBase)) throw new TypeError("shapesBase must be a safe absolute IRI");
  const ontology = Array.isArray(ontologyOrQuads)
    ? owlRdfsAdapter.adapt(ontologyOrQuads)
    : ontologyOrQuads;
  const sourceQuads = Array.isArray(ontologyOrQuads) ? ontologyOrQuads : ontologyQuads;
  const quads = parseTurtle(shapesTtl);
  const implicit = implicitClassTargets(quads);
  if (implicit.length)
    throw new AdmissionError(
      implicit.map((subject) => ({
        code: "implicit-class-target",
        severity: "error",
        subject,
        message: "implicit class targets are not modeled by the runtime",
      })),
    );
  validateParameters(quads);
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
    .sort((a, b) => compareStrings(a.targetClass, b.targetClass));
  const targetCounts = new Map<string, number>();
  for (const shape of nodeShapeSubjects)
    targetCounts.set(shape.targetClass, (targetCounts.get(shape.targetClass) ?? 0) + 1);
  // Only multi-shape anonymous identities need a content key; leave the existing
  // single-shape skolem identities (and all committed generated bytes) unchanged.
  const anonymousKey = (root: Term): string => {
    let reads = 0;
    const inspect = (term: Term, seen = new Set<string>()): string => {
      if (++reads > 10000 || seen.size > 128)
        throw new TypeError("anonymous NodeShape identity inspection exceeds its budget");
      if (term.termType !== "BlankNode") return JSON.stringify(term);
      if (seen.has(term.value)) return "cycle";
      const next = new Set(seen).add(term.value);
      return JSON.stringify(
        graph.store
          .getQuads(term, null, null, null)
          .map((q) => [q.predicate.value, inspect(q.object, next)])
          .sort((a, b) => compareStrings(JSON.stringify(a), JSON.stringify(b))),
      );
    };
    return inspect(root);
  };
  // Inspect each multi-shape anonymous identity once, with an independent bounded
  // traversal. Sorting and skolem minting reuse the key without spending more reads.
  const anonymousKeys = new Map<string, string>();
  for (const { subject, targetClass } of nodeShapeSubjects)
    if (subject.termType === "BlankNode" && (targetCounts.get(targetClass) ?? 0) > 1)
      anonymousKeys.set(subject.value, anonymousKey(subject));
  const identityKey = (term: Term): string =>
    term.termType === "NamedNode" ? term.value : (anonymousKeys.get(term.value) ?? "");
  nodeShapeSubjects.sort(
    (a, b) =>
      compareStrings(a.targetClass, b.targetClass) ||
      compareStrings(identityKey(a.subject), identityKey(b.subject)),
  );
  const projectedClasses = new Set(
    nodeShapeSubjects.flatMap((s) => [s.targetClass, ...(s.aliasTypeIris ?? [])]),
  );
  for (const entity of config?.entities ?? []) {
    for (const target of isCompositeConfig(entity)
      ? Object.values(entity.nodes).map((n) => n.targetClass)
      : [entity.targetClass])
      projectedClasses.add(target);
  }
  const ontologyGraph = new Graph(sourceQuads);

  // Blank-node → skolem IRI map. Full identities determine the hash; local names
  // are only readable suffixes, never identity or a per-shape collision counter.
  const skolem = new Map<string, string>();
  const propertyClasses = new Map<string, string>();
  // SHACL interprets an IRI-valued sh:path as a predicate, regardless of its
  // outgoing triples. Complex-path roots MUST stay blank, with stable labels.
  const pathRoots = new Set<string>();
  const parsedShapes: NodeShapeModel[] = [];
  const nodeConstrainedProperties = new Set<string>();

  for (const { subject, targetClass, aliasTypeIris } of nodeShapeSubjects) {
    const classLocal = localName(targetClass);
    const shapeIdentity = [targetClass, subject.termType === "NamedNode" ? subject.value : null];
    if (subject.termType === "BlankNode" && (targetCounts.get(targetClass) ?? 0) > 1)
      shapeIdentity.push(identityKey(subject), String(parsedShapes.length));
    const shapeIri = mintSkolem(shapesBase, ["node", ...shapeIdentity], `${classLocal}Shape`);
    if (subject.termType === "BlankNode") skolem.set(subject.value, shapeIri);

    const usedPaths = new Set<string>();
    const properties: ShapeConstraint[] = [];
    for (const propObj of graph.objects(subject, `${SH}property`)) {
      const { pathIri, aliasPredicates } = resolvePath(graph, propObj, ontology);
      // Multiple property shapes cannot be flattened into one predicate-keyed
      // field without conjoining constraints. Reject every canonical/alias overlap.
      for (const path of [pathIri, ...(aliasPredicates ?? [])]) {
        if (usedPaths.has(path)) {
          throw new AdmissionError([
            {
              code: "duplicate-property-path",
              severity: "error",
              subject: subject.value,
              message: "multiple property shapes on the same node shape share a path",
            },
          ]);
        }
        usedPaths.add(path);
      }
      const pathRoot = graph.object(propObj, `${SH}path`);
      if (aliasPredicates && pathRoot?.termType === "BlankNode") pathRoots.add(pathRoot.value);
      const pathLocal = localName(pathIri);
      let propShapeIri = mintSkolem(
        shapesBase,
        ["property", ...shapeIdentity, pathIri],
        `${classLocal}-${pathLocal}`,
      );
      if (propObj.termType === "BlankNode") {
        const prior = skolem.get(propObj.value);
        if (prior !== undefined && prior !== propShapeIri) {
          if (propertyClasses.get(propObj.value) !== targetClass)
            throw new TypeError(
              "skolem identity collision: blank node has multiple shape identities",
            );
          // The same RDF property shape reused inside one class group has one
          // identity, anchored at its first owner in deterministic shape order.
          propShapeIri = prior;
        }
        skolem.set(propObj.value, propShapeIri);
        propertyClasses.set(propObj.value, targetClass);
      }

      const nodeKind = graph.value(propObj, `${SH}nodeKind`);
      const datatype = graph.value(propObj, `${SH}datatype`);
      const constraint: ShapeConstraint = {
        pathIri,
        ...(aliasPredicates ? { aliasPredicates } : {}),
        kind: resolveKind(nodeKind, datatype),
        shapeIri: propObj.termType === "NamedNode" ? propObj.value : propShapeIri,
      };
      if (nodeKind !== undefined) constraint.nodeKind = nodeKind;
      const name = graph.value(propObj, `${SH}name`);
      if (name !== undefined) constraint.name = name;
      if (datatype !== undefined) constraint.datatype = datatype;
      const hasClass = graph.value(propObj, `${SH}class`);
      if (hasClass !== undefined) constraint.hasClass = hasClass;
      // Only named references are projected; admission rejects every unprojected sh:node,
      // including inline shapes (never silently discard or recursively compile them).
      const nodeRef = graph.object(propObj, `${SH}node`);
      if (nodeRef !== undefined) nodeConstrainedProperties.add(constraint.shapeIri);
      if (nodeRef !== undefined && nodeRef.termType === "NamedNode") {
        constraint.node = nodeRef.value;
      }
      const minCount = parameterNumber(graph, propObj, "minCount");
      if (minCount !== undefined) constraint.minCount = minCount;
      const maxCount = parameterNumber(graph, propObj, "maxCount");
      if (maxCount !== undefined) constraint.maxCount = maxCount;
      const pattern = graph.value(propObj, `${SH}pattern`);
      if (pattern !== undefined) constraint.pattern = pattern;
      const severity = graph.value(propObj, `${SH}severity`);
      if (severity !== undefined) constraint.severity = severity;
      const hasValue = graph.object(propObj, `${SH}hasValue`);
      if (hasValue !== undefined) constraint.hasValue = shapeTerm(hasValue);
      // sh:in — a closed value set (RDF list). An unparseable/nil list yields [] so
      // admission can flag it (present-but-empty ⇒ malformed enum).
      const inHead = graph.object(propObj, `${SH}in`);
      if (inHead !== undefined) {
        const members = rdfList(graph, inHead);
        constraint.in =
          members === undefined ? [] : members.map((term) => termToScalar(term, constraint));
      }
      const minInclusive = parameterNumber(graph, propObj, "minInclusive");
      if (minInclusive !== undefined) constraint.minInclusive = minInclusive;
      const maxInclusive = parameterNumber(graph, propObj, "maxInclusive");
      if (maxInclusive !== undefined) constraint.maxInclusive = maxInclusive;
      const minLength = parameterNumber(graph, propObj, "minLength");
      if (minLength !== undefined) constraint.minLength = minLength;
      properties.push(constraint);
    }
    properties.sort((a, b) => compareStrings(a.pathIri, b.pathIri));
    parsedShapes.push({
      iri: subject.termType === "NamedNode" ? subject.value : shapeIri,
      targetClass,
      ...(aliasTypeIris ? { aliasTypeIris } : {}),
      properties,
    });
  }

  const nodeShapes = mergeNodeShapes(parsedShapes);
  // A reusable property shape must not be lowered globally if ANY owner uses
  // it as a link, including a sh:node supplied by another merged source.
  const linkProperties = new Set(nodeConstrainedProperties);
  for (const shape of nodeShapes) {
    for (const c of shape.properties) {
      const sources = propertySources(c);
      const configuredLink = config?.entities.some(
        (entity) =>
          isCompositeConfig(entity) &&
          Object.values(entity.nodes).some(
            (node) =>
              node.targetClass === shape.targetClass &&
              node.links?.[c.name ?? localName(c.pathIri)] !== undefined,
          ),
      );
      if (
        configuredLink ||
        sources.some((source) => nodeConstrainedProperties.has(source.shapeIri))
      )
        for (const source of sources) linkProperties.add(source.shapeIri);
      if (configuredLink) c.compositeLink = true;
    }
  }
  // Resolve concept-vs-link semantics only AFTER conjunction: another source
  // shape can supply the field name or sh:node that makes this a composite link.
  for (const shape of nodeShapes) {
    for (const c of shape.properties) {
      const hasClass = c.hasClass;
      const sources = propertySources(c);
      if (
        hasClass === undefined ||
        projectedClasses.has(hasClass) ||
        sources.some((source) => linkProperties.has(source.shapeIri))
      )
        continue;
      const members = ontologyGraph.instancesOf(hasClass).filter((t) => t.termType === "NamedNode");
      if (members.some((t) => !isSafeAbsoluteIri(t.value))) rejectParameter(c.shapeIri, "class");
      if (!members.length) continue;
      c.conceptIris = [...new Set(members.map((t) => t.value))].sort();
      for (const source of sources)
        if (source.hasClass !== undefined) source.conceptIris = c.conceptIris;
    }
  }

  const canonicalTypes = new Set(nodeShapes.map((shape) => shape.targetClass));
  const typeAliases = new Set<string>();
  for (const shape of nodeShapes) {
    for (const alias of shape.aliasTypeIris ?? []) {
      if (canonicalTypes.has(alias) || typeAliases.has(alias)) {
        rejectAlias(shape.iri, "type alias overlaps a canonical type or another owner");
      }
      typeAliases.add(alias);
    }
  }

  const fields = nodeShapes.flatMap((shape) => shape.properties);
  const canonicalPredicates = new Set(fields.map((field) => field.pathIri));
  const aliases = new Set<string>();
  for (const field of fields) {
    if (field.pathIri === `${RDF}type`)
      rejectAlias(field.shapeIri, "rdf:type is a reserved structural predicate");
    for (const alias of field.aliasPredicates ?? []) {
      if (alias === `${RDF}type` || canonicalPredicates.has(alias) || aliases.has(alias)) {
        rejectAlias(field.shapeIri, "alias overlaps another field predicate or alias");
      }
      aliases.add(alias);
    }
  }

  // Reject hostile logical graphs before the general blank-node identity refinement.
  // Anchored shapes/properties are already named; expression/list nodes stay blank here.
  shapeInvariants({
    nodeShapes,
    quads: quads.map((q) =>
      DataFactory.quad(
        rewriteTerm(q.subject, skolem, pathRoots) as Quad_Subject,
        q.predicate,
        rewriteTerm(q.object, skolem, pathRoots) as Quad_Object,
        q.graph,
      ),
    ),
  });

  // Any remaining blank nodes (e.g. nested lists) get a deterministic skolem by a
  // canonical key over the triples they participate in.
  skolemizeRemaining(quads, skolem, shapesBase);

  // Fail closed even for a hash collision or an input that deliberately claims a
  // minted identity. Include ALL named IRIs in the profile (including orphan
  // shapes), not only the NodeShapes selected for the manifest.
  const occupied = new Set<string>();
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      if (term.termType === "NamedNode") occupied.add(term.value);
    }
  }
  for (const iri of skolem.values()) {
    if (!isSafeAbsoluteIri(iri)) throw new TypeError("unsafe skolem IRI");
    if (occupied.has(iri)) throw new TypeError("skolem identity collision with an existing IRI");
    occupied.add(iri);
  }

  // Rewrite the graph: replace mapped blank nodes with their skolem IRIs.
  const rewritten: Quad[] = quads.map((q) => {
    const subject = rewriteTerm(q.subject, skolem, pathRoots);
    const object = rewriteTerm(q.object, skolem, pathRoots);
    if (subject === q.subject && object === q.object) return q;
    return DataFactory.quad(
      subject as Quad_Subject,
      q.predicate as Quad["predicate"],
      object as Quad_Object,
      q.graph,
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
  // Keep config selection separate from constraint projection. Admission, compilation
  // and fidelity each re-check the complete referenced item shape.
  for (const entity of config?.entities ?? []) {
    const owners = isCompositeConfig(entity) ? Object.values(entity.nodes) : [entity];
    for (const owner of owners) {
      const shape = nodeShapes.find((s) => s.targetClass === owner.targetClass);
      for (const [name, field] of Object.entries(owner.fields ?? {})) {
        if (field.ordered === undefined) continue;
        const c = shape?.properties.find((p) => (p.name ?? localName(p.pathIri)) === name);
        if (!c)
          throw new AdmissionError([
            {
              code: "invalid-ordered",
              severity: "error",
              subject: shape?.iri ?? owner.targetClass,
              message: `ordered field ${name}: no matching shape property`,
            },
          ]);
        c.ordered = field.ordered;
        const allowed = new Set([
          "ordered",
          "rename",
          "nonBlank",
          "sanitizeText",
          "requiredFailClosed",
          "iriScheme",
        ]);
        for (const key of Object.keys(field))
          if (!allowed.has(key))
            throw new AdmissionError([
              {
                code: "invalid-ordered",
                severity: "error",
                subject: c.shapeIri,
                message: `ordered field ${name}, item shape ${c.node ?? "(missing sh:node)"}: unsupported config key ${key}`,
              },
            ]);
      }
    }
  }
  return { quads: rewritten, nodeShapes, superClasses };
}

function stablePathLabel(iri: string): string {
  return `path_${createHash("sha256").update(iri).digest("hex")}`;
}

/** Length-delimited JSON identities avoid ambiguous concatenations of full IRIs. */
function mintSkolem(shapesBase: string, identity: unknown[], readable: string): string {
  const hash = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return `${shapesBase}${hash}-${encodeURIComponent(readable)}`;
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
    .sort((a, b) => compareStrings(colors.get(a) as string, colors.get(b) as string))
    .forEach((id, index) => {
      skolem.set(id, mintSkolem(shapesBase, ["remaining", colors.get(id), index], `n${index}`));
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
