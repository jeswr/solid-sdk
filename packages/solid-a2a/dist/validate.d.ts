import type { DatasetCore, Quad } from "@rdfjs/types";
import type { Intent, ProtocolDocument, ValidationReport } from "./types.js";
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
export declare function validateIntent(intent: IntentInput, shape: ShapeInput): Promise<ValidationReport>;
//# sourceMappingURL=validate.d.ts.map