// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SHACL validation of an intent graph against a request shape (or a Protocol
// Document's request shape) via `rdf-validate-shacl`. Returns a STRUCTURED report
// (conforms + projected results) and NEVER throws on non-conformance — a
// malformed intent is `conforms: false` with a populated `results`, not an error.

import type { DatasetCore, Quad } from "@rdfjs/types";
import { Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { intentToRdf } from "./intent.js";
import type { Intent, ProtocolDocument, ValidationReport, ValidationResultEntry } from "./types.js";

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
  const dataGraph = toDataset(intentQuads(intent));
  const shapeGraph = toDataset(shapeQuads(shape));

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
