import type { Quad } from "@rdfjs/types";
import { type IntentAction } from "./vocab.js";
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
export declare function buildShapeForIntent(action: IntentAction, options?: BuildShapeOptions): Quad[];
/** The default NodeShape IRI for an action's request shape. */
export declare function defaultShapeId(action: IntentAction): string;
/** Serialise an intent SHACL shape to Turtle (default) or another n3 format. */
export declare function shapeToTurtle(quads: readonly Quad[], format?: string): Promise<string>;
/**
 * A minimal SHACL RESPONSE shape: an `a2a:Intent`-adjacent response that simply
 * requires the responding graph to declare a single subject of the response
 * class. Provided so a Protocol Document has a response shape out of the box; a
 * consumer can supply their own richer one. Kept generic (no required fields)
 * because a response payload's shape is exchange-specific.
 *
 * @param responseClassIri - the rdf:type a conforming response subject must carry.
 */
export declare function buildResponseShape(responseClassIri: string, shapeId?: string): Quad[];
//# sourceMappingURL=shape.d.ts.map