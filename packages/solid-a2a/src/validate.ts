// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SHACL validation of an intent graph against a request shape (or a Protocol
// Document's request shape) via `rdf-validate-shacl`. Returns a STRUCTURED report
// (conforms + projected results) and NEVER throws on non-conformance — a
// malformed intent is `conforms: false` with a populated `results`, not an error.

import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { intentToRdf } from "./intent.js";
import type { Intent, ProtocolDocument, ValidationReport, ValidationResultEntry } from "./types.js";
import { validationDataset } from "./validationDataset.js";

/** A SHACL shape supplied as quads, a dataset, or a built {@link ProtocolDocument}. */
export type ShapeInput = readonly Quad[] | DatasetCore | ProtocolDocument;

/** An intent supplied as a structured {@link Intent}, its quads, or a dataset. */
export type IntentInput = Intent | readonly Quad[] | DatasetCore;

/**
 * SHACL-validate an intent graph against a shape.
 *
 * @param intent - a structured {@link Intent} (lowered to RDF here), or the intent
 *   RDF directly (quads / a dataset).
 * @param shape - the SHACL request shape (quads / a dataset / a built
 *   {@link ProtocolDocument}, whose full graph — including its request shape — is
 *   used as the shapes graph).
 * @returns a structured {@link ValidationReport}; never throws on non-conformance.
 */
export async function validateIntent(
  intent: IntentInput,
  shape: ShapeInput,
): Promise<ValidationReport> {
  try {
    return await validateGraphs(intent, shape);
  } catch (error) {
    // A structured Intent the write path refuses, or a shape the validator cannot
    // compile, is a non-conformance, never an exception.
    return {
      conforms: false,
      results: [{ message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

/**
 * `sh:pattern` runs a shape-supplied regular expression over the data. A peer's
 * Protocol Document is hash-pinned to the peer, not vetted, and a backtracking
 * pattern would block the event loop with no way to time it out.
 */
const SH_PATTERN = "http://www.w3.org/ns/shacl#pattern";

const SH_NS = "http://www.w3.org/ns/shacl#";
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDF_TYPE = `${RDF_NS}type`;
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const RDFS_SUBCLASS_OF = `${RDFS}subClassOf`;

/**
 * The SHACL Core a peer shape may use. Left out: `sh:pattern`/`sh:flags` (a
 * peer's regex), `sh:qualifiedValueShapesDisjoint` (each check re-runs every
 * sibling), and SHACL-SPARQL. The rest is bounded below.
 */
const ALLOWED_SH = new Set(
  [
    "targetClass",
    "targetNode",
    "targetSubjectsOf",
    "targetObjectsOf",
    "property",
    "path",
    "inversePath",
    "alternativePath",
    "zeroOrMorePath",
    "oneOrMorePath",
    "zeroOrOnePath",
    "node",
    "not",
    "and",
    "or",
    "xone",
    "qualifiedValueShape",
    "qualifiedMinCount",
    "qualifiedMaxCount",
    "minCount",
    "maxCount",
    "nodeKind",
    "hasValue",
    "in",
    "datatype",
    "class",
    "minLength",
    "maxLength",
    "languageIn",
    "uniqueLang",
    "equals",
    "disjoint",
    "lessThan",
    "lessThanOrEquals",
    "minInclusive",
    "maxInclusive",
    "minExclusive",
    "maxExclusive",
    "closed",
    "ignoredProperties",
    "name",
    "description",
    "message",
    "severity",
    "order",
    "group",
    "deactivated",
    "defaultValue",
  ].map((p) => SH_NS + p),
);
/** Constraints whose object is one shape evaluated at each value node. */
const SHAPE_REFS = ["node", "property", "not", "qualifiedValueShape"].map((p) => SH_NS + p);
/**
 * Parameters a shape may repeat. The validator builds one constraint per
 * combination of a component's parameter values, so any other repeated
 * parameter (`sh:qualifiedMinCount 0, 1, 2 …`) multiplies its work.
 */
const MULTI_VALUED = new Set(
  [
    "targetClass",
    "targetNode",
    "targetSubjectsOf",
    "targetObjectsOf",
    "property",
    "node",
    "not",
    "and",
    "or",
    "xone",
    "class",
    "name",
    "description",
    "message",
  ].map((p) => SH_NS + p),
);
/** Each of these components re-evaluates a property shape's path at every focus node. */
const PATH_REEVALUATED = [
  "equals",
  "disjoint",
  "lessThan",
  "lessThanOrEquals",
  "uniqueLang",
  "qualifiedMinCount",
  "qualifiedMaxCount",
].map((p) => SH_NS + p);
/** Each qualified count re-evaluates `sh:qualifiedValueShape` at every value node. */
const QUALIFIED_COUNTS = ["qualifiedMinCount", "qualifiedMaxCount"].map((p) => SH_NS + p);
/** The keys that make a blank node a complex path, as the validator reads them. */
const PATH_KEYS = [
  "alternativePath",
  "zeroOrMorePath",
  "oneOrMorePath",
  "zeroOrOnePath",
  "inversePath",
].map((p) => SH_NS + p);
const REPEATED_PATHS = new Set([`${SH_NS}zeroOrMorePath`, `${SH_NS}oneOrMorePath`]);
/** Constraints whose object is a list of shapes evaluated at each value node. */
const SHAPE_LISTS = ["and", "or", "xone"].map((p) => SH_NS + p);

/**
 * The most steps one validation may take, counted as the validator takes them:
 * every shape evaluation, value node and path step. It memoises nothing, so a
 * shape or path reached twice, or through several value nodes, is evaluated each
 * time. Request-sized; the package's own shapes over an honest intent take a few
 * dozen.
 */
const MAX_VALIDATION_STEPS = 5_000;
/** An intent graph is a handful of triples; pairwise constraints are quadratic in it. */
const MAX_DATA_QUADS = 1_000;
const MAX_SHAPE_QUADS = 10_000;
/** The validator walks lists with no cycle check and paths without memoising. */
const MAX_LIST_LENGTH = 256;
const MAX_PATH_SIZE = 64;

const UNBOUNDED = "are not evaluated (unbounded cost)";

/**
 * Why a validation is refused before it starts, or undefined when its cost is
 * bounded. Refused: SHACL outside {@link ALLOWED_SH}; `rdfs:subClassOf` in either
 * graph (walked with no visited set); an RDF list that loops, branches or runs
 * long; a property path that unfolds past {@link MAX_PATH_SIZE} nodes; a shape
 * reference cycle; and more than {@link MAX_VALIDATION_STEPS} evaluations over
 * this data, computed exactly (with memoisation) from the shapes and the data.
 */
function unboundedValidation(shapes: Store, data: Store): string | undefined {
  if (shapes.size > MAX_SHAPE_QUADS) return `Shapes over ${MAX_SHAPE_QUADS} triples ${UNBOUNDED}`;
  if (data.size > MAX_DATA_QUADS)
    return `Intent graphs over ${MAX_DATA_QUADS} triples ${UNBOUNDED}`;
  const seen = new Set<string>();
  for (const q of shapes.getQuads(null, null, null, null)) {
    const p = q.predicate.value;
    if ((p.startsWith(SH_NS) && !ALLOWED_SH.has(p)) || p === RDFS_SUBCLASS_OF) {
      return `Shapes using <${p}> ${UNBOUNDED}`;
    }
    if (p.startsWith(SH_NS) && !MULTI_VALUED.has(p)) {
      const k = `${q.subject.termType}:${q.subject.value} ${p}`;
      if (seen.has(k)) return `Shapes repeating <${p}> on one node ${UNBOUNDED}`;
      seen.add(k);
    }
  }
  if (data.getQuads(null, RDFS_SUBCLASS_OF, null, null).length > 0) {
    return `Intent graphs using rdfs:subClassOf ${UNBOUNDED}`;
  }

  const key = (t: Term) => `${t.termType}:${t.value}`;
  const objects = (graph: Store, subject: Term, predicate: string) =>
    graph.getObjects(subject as Quad["subject"], predicate, null);

  // Lists: each cell has one first and one rest, and every chain reaches rdf:nil.
  const listLength = new Map<string, number>();
  const walk = (cell: Term, depth: number): number | undefined => {
    if (cell.termType === "NamedNode" && cell.value === `${RDF_NS}nil`) return 0;
    const known = listLength.get(key(cell));
    if (known !== undefined) return known;
    if (depth > MAX_LIST_LENGTH) return undefined;
    const first = objects(shapes, cell, `${RDF_NS}first`);
    const rest = objects(shapes, cell, `${RDF_NS}rest`);
    if (first.length !== 1 || rest.length !== 1) return undefined;
    const tail = walk(rest[0] as Term, depth + 1);
    if (tail === undefined) return undefined;
    listLength.set(key(cell), tail + 1);
    return tail + 1;
  };
  const listMembers = (head: Term): Term[] | undefined => {
    if (walk(head, 0) === undefined) return undefined;
    const members: Term[] = [];
    for (let cell = head; !(cell.termType === "NamedNode" && cell.value === `${RDF_NS}nil`); ) {
      members.push(objects(shapes, cell, `${RDF_NS}first`)[0] as Term);
      cell = objects(shapes, cell, `${RDF_NS}rest`)[0] as Term;
    }
    return members;
  };
  for (const head of SHAPE_LISTS.flatMap((p) => shapes.getObjects(null, p, null))) {
    if (listMembers(head) === undefined) return `Shapes with a malformed shape list ${UNBOUNDED}`;
  }
  for (const cell of [
    ...shapes.getSubjects(`${RDF_NS}first`, null, null),
    ...shapes.getSubjects(`${RDF_NS}rest`, null, null),
  ]) {
    if (walk(cell, 0) === undefined) return `Shapes with a looping or malformed list ${UNBOUNDED}`;
  }

  // Paths: a tree of at most MAX_PATH_SIZE nodes once shared nodes are unfolded,
  // read exactly as the validator reads it: a named node is a predicate, and a
  // blank node is a list or carries exactly one path key (the validator would
  // pick one by its own precedence and ignore the rest). A repeated path
  // (`*`/`+`) may not contain another: each would re-walk the inner one from
  // every node it reaches.
  const pathSize = (path: Term, budget: number, repeated: boolean): number | undefined => {
    if (budget <= 0) return undefined;
    if (path.termType === "NamedNode") return 1;
    if (path.termType !== "BlankNode") return undefined;
    const isList = objects(shapes, path, `${RDF_NS}first`).length > 0;
    const keys = PATH_KEYS.filter((k) => objects(shapes, path, k).length > 0);
    if ((isList ? 1 : 0) + keys.length !== 1) return undefined;
    let parts: Term[] | undefined;
    let inner = repeated;
    if (isList) {
      parts = listMembers(path);
    } else {
      const key = keys[0] as string;
      const values = objects(shapes, path, key);
      if (values.length !== 1) return undefined;
      const value = values[0] as Term;
      if (key === `${SH_NS}alternativePath`) {
        parts = value.termType === "BlankNode" ? listMembers(value) : undefined;
      } else if (key === `${SH_NS}inversePath`) {
        // The validator inverts only a predicate.
        parts = value.termType === "NamedNode" ? [value] : undefined;
      } else {
        if (REPEATED_PATHS.has(key)) {
          if (repeated) return undefined;
          inner = true;
        }
        parts = [value];
      }
    }
    if (parts === undefined || parts.length === 0) return undefined;
    let size = 1;
    for (const part of parts) {
      const n = pathSize(part, budget - size, inner);
      if (n === undefined) return undefined;
      size += n;
    }
    return size <= budget ? size : undefined;
  };
  const unique = (terms: Term[]) => [...new Map(terms.map((t) => [key(t), t])).values()];
  // A path's value nodes at a focus, and the steps the validator takes to find
  // them (it re-walks every inner path at every node it visits).
  type PathResult = { values: Term[]; steps: number };
  type PathFn = (focus: Term) => PathResult;
  const pathFn = (path: Term): PathFn => {
    const evaluate = rawPathFn(path);
    const memo = new Map<string, PathResult>();
    return (focus) => {
      const known = memo.get(key(focus));
      if (known !== undefined) return known;
      const result = evaluate(focus);
      memo.set(key(focus), result);
      return result;
    };
  };
  const walkRepeated = (step: PathFn, focus: Term, includeFocus: boolean): PathResult => {
    const visited = new Map([[key(focus), focus]]);
    const reached = new Map<string, Term>(includeFocus ? [[key(focus), focus]] : []);
    const queue = [focus];
    let steps = 0;
    for (let t = queue.pop(); t !== undefined; t = queue.pop()) {
      const r = step(t);
      steps += 1 + r.steps;
      for (const next of r.values) {
        reached.set(key(next), next);
        if (!visited.has(key(next))) {
          visited.set(key(next), next);
          queue.push(next);
        }
      }
    }
    return { values: [...reached.values()], steps };
  };
  const rawPathFn = (path: Term): PathFn => {
    if (path.termType === "NamedNode") {
      return (focus) => {
        const values = data.getObjects(focus as Quad["subject"], path.value, null);
        return { values, steps: 1 + values.length };
      };
    }
    if (objects(shapes, path, `${RDF_NS}first`).length > 0) {
      const seq = (listMembers(path) ?? []).map(pathFn);
      return (focus) => {
        let nodes = [focus];
        let steps = 0;
        for (const step of seq) {
          const next: Term[] = [];
          for (const node of nodes) {
            const r = step(node);
            steps += r.steps;
            next.push(...r.values);
          }
          nodes = unique(next);
        }
        return { values: nodes, steps };
      };
    }
    const [alternatives] = objects(shapes, path, `${SH_NS}alternativePath`);
    if (alternatives !== undefined) {
      const alts = (listMembers(alternatives) ?? []).map(pathFn);
      return (focus) => {
        const results = alts.map((step) => step(focus));
        return {
          values: unique(results.flatMap((r) => r.values)),
          steps: results.reduce((n, r) => n + r.steps, 1),
        };
      };
    }
    const [zeroOrMore] = objects(shapes, path, `${SH_NS}zeroOrMorePath`);
    if (zeroOrMore !== undefined) {
      const step = pathFn(zeroOrMore);
      return (focus) => walkRepeated(step, focus, true);
    }
    const [oneOrMore] = objects(shapes, path, `${SH_NS}oneOrMorePath`);
    if (oneOrMore !== undefined) {
      const step = pathFn(oneOrMore);
      return (focus) => walkRepeated(step, focus, false);
    }
    const [zeroOrOne] = objects(shapes, path, `${SH_NS}zeroOrOnePath`);
    if (zeroOrOne !== undefined) {
      const step = pathFn(zeroOrOne);
      return (focus) => {
        const r = step(focus);
        return { values: unique([focus, ...r.values]), steps: 1 + r.steps };
      };
    }
    // pathSize admits only a predicate's inverse.
    const [inverse] = objects(shapes, path, `${SH_NS}inversePath`);
    return (focus) => {
      const values = data.getSubjects((inverse as Term).value, focus as Quad["object"], null);
      return { values, steps: 1 + values.length };
    };
  };
  const paths = new Map<string, PathFn>();
  for (const q of shapes.getQuads(null, `${SH_NS}path`, null, null)) {
    if (pathSize(q.object, MAX_PATH_SIZE, false) === undefined) {
      return `Shapes with a property path past ${MAX_PATH_SIZE} steps or malformed ${UNBOUNDED}`;
    }
    paths.set(key(q.subject), pathFn(q.object));
  }

  // Shape references: the validator recurses for as long as a cycle allows.
  const refsOf = (shape: Term): Term[] | undefined => {
    const refs: Term[] = SHAPE_REFS.flatMap((p) => objects(shapes, shape, p));
    for (const p of SHAPE_LISTS) {
      for (const head of objects(shapes, shape, p)) {
        const members = listMembers(head);
        if (members === undefined) return undefined;
        refs.push(...members);
      }
    }
    return refs;
  };
  const done = new Set<string>();
  const active = new Set<string>();
  const acyclic = (shape: Term): boolean => {
    const k = key(shape);
    if (done.has(k)) return true;
    if (active.has(k)) return false;
    active.add(k);
    if (!(refsOf(shape) ?? []).every(acyclic)) return false;
    active.delete(k);
    done.add(k);
    return true;
  };
  for (const subject of shapes.getSubjects(null, null, null)) {
    if (!acyclic(subject)) return `Shapes that reference themselves ${UNBOUNDED}`;
  }

  // The steps for `shape` at `focus`: the shape, each value node, the path walk
  // (again for each component that re-reads it), and each referenced shape at
  // each value node (again for each qualified count that re-checks it).
  const present = (shape: Term, predicates: readonly string[]) =>
    predicates.filter((p) => objects(shapes, shape, p).length > 0).length;
  const memo = new Map<string, number>();
  const andMembers = (shape: Term) =>
    objects(shapes, shape, `${SH_NS}and`).flatMap((head) => listMembers(head) ?? []);
  // `via` is the path a property shape's sh:and imposes on its members: the
  // validator re-runs each member as a property shape over that path, at the
  // same focus, once per value node (|values| to the power of the depth).
  const cost = (shape: Term, focus: Term, via?: { key: string; path: PathFn }): number => {
    const k = `${key(shape)} ${key(focus)} ${via?.key ?? ""}`;
    const known = memo.get(k);
    if (known !== undefined) return known;
    const own = paths.get(key(shape));
    const path = via?.path ?? own;
    const pathKey = via?.key ?? (own === undefined ? undefined : key(shape));
    const walked = path === undefined ? { values: [focus], steps: 0 } : path(focus);
    const values = walked.values;
    let total = 1 + values.length + walked.steps * (1 + present(shape, PATH_REEVALUATED));
    const qualified = Math.max(1, present(shape, QUALIFIED_COUNTS));
    const ands = path === undefined ? [] : andMembers(shape);
    const refs = (refsOf(shape) ?? []).map((ref) => ({
      ref,
      times: objects(shapes, shape, `${SH_NS}qualifiedValueShape`).some((q) => q.equals(ref))
        ? qualified
        : 1,
      along: ands.some((a) => a.equals(ref)),
    }));
    for (const value of values) {
      for (const { ref, times, along } of refs) {
        total +=
          along && path !== undefined && pathKey !== undefined
            ? cost(ref, focus, { key: pathKey, path })
            : cost(ref, value) * times;
        if (total > MAX_VALIDATION_STEPS) break;
      }
      if (total > MAX_VALIDATION_STEPS) break;
    }
    memo.set(k, total);
    return total;
  };
  const instances = (c: Term) => data.getSubjects(RDF_TYPE, c as Quad["object"], null);
  let total = 0;
  for (const shape of shapes.getSubjects(null, null, null)) {
    const focusNodes = [
      ...objects(shapes, shape, `${SH_NS}targetNode`),
      ...objects(shapes, shape, `${SH_NS}targetClass`).flatMap(instances),
      ...objects(shapes, shape, `${SH_NS}targetSubjectsOf`).flatMap((p) =>
        data.getSubjects(p.value, null, null),
      ),
      ...objects(shapes, shape, `${SH_NS}targetObjectsOf`).flatMap((p) =>
        data.getObjects(null, p.value, null),
      ),
      // A shape that is also an rdfs:Class targets its instances.
      ...(shapes.getQuads(shape as Quad["subject"], RDF_TYPE, `${RDFS}Class`, null).length > 0
        ? instances(shape)
        : []),
    ];
    for (const focus of focusNodes) {
      total += cost(shape, focus);
      if (total > MAX_VALIDATION_STEPS) {
        return `Shapes that need more than ${MAX_VALIDATION_STEPS} evaluations over this intent ${UNBOUNDED}`;
      }
    }
  }
  return undefined;
}

async function validateGraphs(intent: IntentInput, shape: ShapeInput): Promise<ValidationReport> {
  // Alias matching is confined to disposable validation views. The original
  // graphs must retain their IRIs so existing protocol hashes still verify.
  const shapes = shapeQuads(shape);
  if (shapes.some((q) => q.predicate.value === SH_PATTERN)) {
    return {
      conforms: false,
      results: [{ message: "Shapes using sh:pattern are not evaluated (unbounded regex)" }],
    };
  }
  const data = toDataset(intentQuads(intent));
  const dataGraph = validationDataset(data);
  if (dataGraph === undefined) {
    return {
      conforms: false,
      results: [{ message: "A2A namespace aliases identify distinct data nodes" }],
    };
  }
  // Shapes use the SAME total renaming, without interpreting constraint roles.
  const shapeGraph = validationDataset(toDataset(shapes), false) as Store;
  const unbounded = unboundedValidation(shapeGraph, dataGraph as Store);
  if (unbounded !== undefined) return { conforms: false, results: [{ message: unbounded }] };

  const validator = new SHACLValidator(shapeGraph);
  const report = await validator.validate(dataGraph);

  return {
    conforms: report.conforms,
    results: report.results.map(projectResult),
  };
}

/** Lower an {@link IntentInput} to quads. */
function intentQuads(intent: IntentInput): readonly Quad[] {
  if (isIntent(intent)) {
    return intentToRdf(intent);
  }
  if (Array.isArray(intent)) {
    return intent;
  }
  return [...(intent as DatasetCore)] as Quad[];
}

/** Lower a {@link ShapeInput} to quads. */
function shapeQuads(shape: ShapeInput): readonly Quad[] {
  if (isProtocolDocument(shape)) {
    // Validate against ONLY the request shape — never the whole PD graph (which
    // includes the response shape). A response shape that targets a class also
    // present in the request graph must not make a valid request fail.
    return shape.requestShapeQuads;
  }
  if (Array.isArray(shape)) {
    return shape;
  }
  return [...(shape as DatasetCore)] as Quad[];
}

/** Build an n3.Store (a DatasetCore the validator accepts) from quads. */
function toDataset(quads: readonly Quad[]): Store {
  const store = new Store();
  store.addQuads(quads as Quad[]);
  return store;
}

/** Project a `rdf-validate-shacl` ValidationResult to a plain entry. */
function projectResult(result: {
  message: { value: string }[];
  path?: { value: string } | null;
  focusNode?: { value: string } | null;
  severity?: { value: string } | null;
  sourceConstraintComponent?: { value: string } | null;
  value?: { value: string } | null;
}): ValidationResultEntry {
  const message = result.message.map((m) => m.value).join("; ");
  return {
    message: message.length > 0 ? message : "SHACL constraint violation",
    ...(result.sourceConstraintComponent?.value !== undefined && {
      sourceConstraintComponent: result.sourceConstraintComponent.value,
    }),
    ...(result.focusNode?.value !== undefined && { focusNode: result.focusNode.value }),
    ...(result.path?.value !== undefined && { path: result.path.value }),
    ...(result.value?.value !== undefined && { value: result.value.value }),
    ...(result.severity?.value !== undefined && { severity: result.severity.value }),
  };
}

function isIntent(x: IntentInput): x is Intent {
  return (
    typeof x === "object" &&
    x !== null &&
    !Array.isArray(x) &&
    typeof (x as Intent).action === "string" &&
    typeof (x as Intent).id === "string"
  );
}

function isProtocolDocument(x: ShapeInput): x is ProtocolDocument {
  return (
    typeof x === "object" &&
    x !== null &&
    !Array.isArray(x) &&
    typeof (x as ProtocolDocument).hash === "string" &&
    Array.isArray((x as ProtocolDocument).quads)
  );
}
