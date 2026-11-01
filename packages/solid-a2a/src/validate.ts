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
/** Constraints whose object is one shape the validator evaluates per value node. */
const SHAPE_REFS = new Set(
  ["node", "property", "not", "qualifiedValueShape"].map((p) => SH_NS + p),
);
/** Constraints whose object is an RDF list of shapes. */
const SHAPE_LISTS = new Set(["and", "or", "xone"].map((p) => SH_NS + p));
/**
 * The most shape evaluations one validation may unfold to, counting a shape once
 * per reference path. The validator does not memoise, so a small graph whose
 * shapes each name the next one twice costs 2^depth; this request-sized budget
 * refuses that before any work starts. The package's own shapes unfold to a few
 * dozen.
 */
const MAX_SHAPE_EVALUATIONS = 1024;
const MAX_LIST_LENGTH = 256;
const OVER_BUDGET = "Shapes that unfold past the evaluation budget";

/**
 * Why a shapes graph is refused before validation, or undefined when it is
 * bounded: a reference cycle, a list that loops or runs long, disjoint qualified
 * shapes (each check re-evaluates every sibling), or an unfolded size over budget.
 */
function unboundedShapes(graph: Store): string | undefined {
  const key = (t: Term) => `${t.termType}:${t.value}`;
  const listMembers = (head: Term): Term[] | undefined => {
    const members: Term[] = [];
    const seen = new Set<string>();
    let node = head;
    while (!(node.termType === "NamedNode" && node.value === `${RDF_NS}nil`)) {
      if (seen.has(key(node)) || members.length >= MAX_LIST_LENGTH) return undefined;
      seen.add(key(node));
      const first = graph.getObjects(node, `${RDF_NS}first`, null);
      const rest = graph.getObjects(node, `${RDF_NS}rest`, null);
      if (first.length !== 1 || rest.length !== 1) return undefined;
      members.push(first[0] as Term);
      node = rest[0] as Term;
    }
    return members;
  };
  if (graph.getQuads(null, `${SH_NS}qualifiedValueShapesDisjoint`, null, null).length > 0) {
    return "Shapes using sh:qualifiedValueShapesDisjoint are not evaluated (unbounded cost)";
  }
  const size = new Map<string, number>();
  const active = new Set<string>();
  const unfold = (shape: Term): number | string => {
    const k = key(shape);
    const known = size.get(k);
    if (known !== undefined) return known;
    if (active.has(k)) return "Shapes that reference themselves";
    active.add(k);
    let total = 1;
    for (const quad of graph.getQuads(shape, null, null, null)) {
      let refs: Term[] = [];
      if (SHAPE_REFS.has(quad.predicate.value)) refs = [quad.object];
      else if (SHAPE_LISTS.has(quad.predicate.value)) {
        const members = listMembers(quad.object);
        if (members === undefined) return "Shapes with a malformed sh:and/sh:or/sh:xone list";
        refs = members;
      }
      for (const ref of refs) {
        const child = unfold(ref);
        if (typeof child === "string") return child;
        total += child;
        if (total > MAX_SHAPE_EVALUATIONS) return OVER_BUDGET;
      }
    }
    active.delete(k);
    size.set(k, total);
    return total;
  };
  let total = 0;
  for (const subject of graph.getSubjects(null, null, null)) {
    const n = unfold(subject);
    if (typeof n === "string") return `${n} are not evaluated (unbounded cost)`;
    total += n;
    if (total > MAX_SHAPE_EVALUATIONS) return `${OVER_BUDGET} are not evaluated (unbounded cost)`;
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
  const unbounded = unboundedShapes(shapeGraph);
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
