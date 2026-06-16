// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SHACL shape construction for the intent graph. `buildShapeForIntent` builds a
// sh:NodeShape (request shape) that an intent graph for a given action kind must
// satisfy: the intent is typed a2a:Intent, links exactly one action of the right
// type, and (for most actions) carries a target IRI; a grant additionally
// requires a recipient + at least one acl: mode. Built through the GraphBuilder
// (typed wrapper write path) — never hand-built triples. Serialise via n3.Writer.

import type { Quad } from "@rdfjs/types";
import { serialize } from "./serialize.js";
import {
  A2A,
  A2A_ACTION,
  A2A_INTENT,
  A2A_MODE,
  ACTION_TYPE_IRI,
  type IntentAction,
  RDF_TYPE,
  SCHEMA_OBJECT,
  SCHEMA_RECIPIENT,
  SCHEMA_TARGET,
  SH,
} from "./vocab.js";
import { GraphBuilder } from "./wrappers.js";

// SHACL terms used by the shape builder.
const SH_NODE_SHAPE = `${SH}NodeShape` as const;
const SH_PROPERTY_SHAPE = `${SH}PropertyShape` as const;
const SH_TARGET_CLASS = `${SH}targetClass` as const;
const SH_PROPERTY = `${SH}property` as const;
const SH_PATH = `${SH}path` as const;
const SH_MIN_COUNT = `${SH}minCount` as const;
const SH_MAX_COUNT = `${SH}maxCount` as const;
const SH_NODE_KIND = `${SH}nodeKind` as const;
const SH_IRI = `${SH}IRI` as const;
const SH_CLASS = `${SH}class` as const;
const SH_HAS_VALUE = `${SH}hasValue` as const;
const SH_IN = `${SH}in` as const;
const SH_NODE = `${SH}node` as const;
const SH_NAME = `${SH}name` as const;
const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer" as const;

/** Options for {@link buildShapeForIntent}. */
export interface BuildShapeOptions {
  /**
   * The IRI to mint the NodeShape under. Defaults to a stable IRI under the
   * `a2a:` namespace derived from the action (e.g. `…#ReadIntentShape`).
   */
  readonly shapeId?: string;
}

/**
 * Build the SHACL request shape (quads) for a given intent action kind. A
 * conforming intent graph must:
 *   - be typed `a2a:Intent` (the shape targets that class);
 *   - link exactly one `a2a:action` whose `rdf:type` is the action's type;
 *   - (for every action except a pure subscribe/query, which may target a class)
 *     carry a target IRI (`schema:object`, or `schema:target` for a list);
 *   - for a `grant`: additionally carry a `schema:recipient` IRI and ≥1 `a2a:mode`.
 *
 * @param action - the intent action kind the shape constrains.
 */
export function buildShapeForIntent(action: IntentAction, options: BuildShapeOptions = {}): Quad[] {
  const b = new GraphBuilder();
  const shapeId = options.shapeId ?? defaultShapeId(action);

  // The top NodeShape targets a2a:Intent.
  b.addIri(shapeId, RDF_TYPE, SH_NODE_SHAPE);
  b.addIri(shapeId, SH_TARGET_CLASS, A2A_INTENT);

  // Property: exactly one a2a:action, an IRI/blank node carrying the right type.
  // We constrain the action via a nested node shape (the action must be of the
  // expected class). The action property requires minCount 1, maxCount 1.
  const actionProp = b.linkBlankNode(shapeId, SH_PROPERTY);
  b.addIri(actionProp, RDF_TYPE, SH_PROPERTY_SHAPE);
  b.addIri(actionProp, SH_PATH, A2A_ACTION);
  b.addLiteral(actionProp, SH_MIN_COUNT, "1", XSD_INTEGER);
  b.addLiteral(actionProp, SH_MAX_COUNT, "1", XSD_INTEGER);
  b.addLiteral(actionProp, SH_NAME, "action");
  // Nested node shape constraining the action node itself.
  const actionNodeShape = b.linkBlankNode(actionProp, SH_NODE);
  b.addIri(actionNodeShape, RDF_TYPE, SH_NODE_SHAPE);
  // The action must carry rdf:type = the expected action type (sh:hasValue on a
  // property whose path is rdf:type).
  const typeProp = b.linkBlankNode(actionNodeShape, SH_PROPERTY);
  b.addIri(typeProp, RDF_TYPE, SH_PROPERTY_SHAPE);
  b.addIri(typeProp, SH_PATH, RDF_TYPE);
  b.addIri(typeProp, SH_HAS_VALUE, ACTION_TYPE_IRI[action]);
  b.addLiteral(typeProp, SH_MIN_COUNT, "1", XSD_INTEGER);

  // The target IRI on the action node (schema:object, or schema:target for list),
  // required for every action except subscribe/query (which may legitimately have
  // no concrete resource target — a standing subscription / a query body).
  if (action !== "subscribe" && action !== "query") {
    const targetPredicate = action === "list" ? SCHEMA_TARGET : SCHEMA_OBJECT;
    const targetProp = b.linkBlankNode(actionNodeShape, SH_PROPERTY);
    b.addIri(targetProp, RDF_TYPE, SH_PROPERTY_SHAPE);
    b.addIri(targetProp, SH_PATH, targetPredicate);
    b.addIri(targetProp, SH_NODE_KIND, SH_IRI);
    b.addLiteral(targetProp, SH_MIN_COUNT, "1", XSD_INTEGER);
    b.addLiteral(targetProp, SH_NAME, "target");
  }

  // A grant additionally requires a recipient IRI + ≥1 acl: mode.
  if (action === "grant") {
    const recipientProp = b.linkBlankNode(actionNodeShape, SH_PROPERTY);
    b.addIri(recipientProp, RDF_TYPE, SH_PROPERTY_SHAPE);
    b.addIri(recipientProp, SH_PATH, SCHEMA_RECIPIENT);
    b.addIri(recipientProp, SH_NODE_KIND, SH_IRI);
    b.addLiteral(recipientProp, SH_MIN_COUNT, "1", XSD_INTEGER);
    b.addLiteral(recipientProp, SH_NAME, "recipient");

    const modeProp = b.linkBlankNode(actionNodeShape, SH_PROPERTY);
    b.addIri(modeProp, RDF_TYPE, SH_PROPERTY_SHAPE);
    b.addIri(modeProp, SH_PATH, A2A_MODE);
    b.addIri(modeProp, SH_NODE_KIND, SH_IRI);
    b.addLiteral(modeProp, SH_MIN_COUNT, "1", XSD_INTEGER);
    b.addLiteral(modeProp, SH_NAME, "mode");
  }

  return b.quads();
}

/** The default NodeShape IRI for an action's request shape. */
export function defaultShapeId(action: IntentAction): string {
  const titled = action.charAt(0).toUpperCase() + action.slice(1);
  return `${A2A}${titled}IntentShape`;
}

/** Serialise an intent SHACL shape to Turtle (default) or another n3 format. */
export function shapeToTurtle(quads: readonly Quad[], format?: string): Promise<string> {
  return serialize(quads, format);
}

/**
 * A minimal SHACL RESPONSE shape: an `a2a:Intent`-adjacent response that simply
 * requires the responding graph to declare a single subject of the response
 * class. Provided so a Protocol Document has a response shape out of the box; a
 * consumer can supply their own richer one. Kept generic (no required fields)
 * because a response payload's shape is exchange-specific.
 *
 * @param responseClassIri - the rdf:type a conforming response subject must carry.
 */
export function buildResponseShape(responseClassIri: string, shapeId?: string): Quad[] {
  const b = new GraphBuilder();
  const id = shapeId ?? `${A2A}ResponseShape`;
  b.addIri(id, RDF_TYPE, SH_NODE_SHAPE);
  b.addIri(id, SH_TARGET_CLASS, responseClassIri);
  // A single placeholder property: rdf:type must be present (minCount 1). This is
  // deliberately permissive — the response shape's specifics are exchange-defined.
  const typeProp = b.linkBlankNode(id, SH_PROPERTY);
  b.addIri(typeProp, RDF_TYPE, SH_PROPERTY_SHAPE);
  b.addIri(typeProp, SH_PATH, RDF_TYPE);
  b.addIri(typeProp, SH_HAS_VALUE, responseClassIri);
  b.addLiteral(typeProp, SH_MIN_COUNT, "1", XSD_INTEGER);
  return b.quads();
}

// Re-export the SHACL term constants a few helpers / tests reference.
export {
  SH_CLASS,
  SH_IN,
  SH_MIN_COUNT,
  SH_NODE_SHAPE,
  SH_PATH,
  SH_PROPERTY_SHAPE,
  SH_TARGET_CLASS,
};
