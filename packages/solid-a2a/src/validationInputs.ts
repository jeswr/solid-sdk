// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore, Quad } from "@rdfjs/types";
import { intentToRdf } from "./intent.js";
import type { Intent, ProtocolDocument } from "./types.js";
import type { IntentInput, ShapeInput } from "./validate.js";
import { checkedQuads, MAX_DATA_QUADS, MAX_TERM_LENGTH, UNBOUNDED } from "./validationLimits.js";

/** Lower an {@link IntentInput} to quads. */
export function intentQuads(intent: IntentInput): readonly Quad[] {
  if (isIntent(intent)) {
    // Bound structured lowering too, before builders copy/escape field text.
    if (
      (intent.parameters?.length ?? 0) > MAX_DATA_QUADS ||
      (intent.modes?.length ?? 0) > MAX_DATA_QUADS
    ) {
      throw new Error(`Intent graphs over ${MAX_DATA_QUADS} triples ${UNBOUNDED}`);
    }
    for (const value of [
      intent.id,
      intent.action,
      intent.target,
      intent.agent,
      intent.recipient,
      ...(intent.modes ?? []),
      ...(intent.parameters ?? []).flatMap((p) => [p.key, p.value]),
    ]) {
      if (value !== undefined && value.length > MAX_TERM_LENGTH) {
        throw new Error(`Terms over ${MAX_TERM_LENGTH} characters ${UNBOUNDED}`);
      }
    }
    return checkedQuads(intentToRdf(intent), false);
  }
  if (Array.isArray(intent)) {
    return checkedQuads(intent, false);
  }
  return checkedQuads(intent as DatasetCore, false);
}

/** Lower a {@link ShapeInput} to quads. */
export function shapeQuads(shape: ShapeInput): readonly Quad[] {
  if (isProtocolDocument(shape)) {
    // Validate against ONLY the request shape — never the whole PD graph (which
    // includes the response shape). A response shape that targets a class also
    // present in the request graph must not make a valid request fail.
    return checkedQuads(shape.requestShapeQuads, true);
  }
  if (Array.isArray(shape)) {
    return checkedQuads(shape, true);
  }
  return checkedQuads(shape as DatasetCore, true);
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
