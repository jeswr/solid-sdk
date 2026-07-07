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
import type { Quad } from "@rdfjs/types";
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
export declare function localName(iri: string): string;
/**
 * Parse a SHACL profile into a normalized shape model with a skolemized graph.
 * `shapesBase` is the namespace the skolem IRIs are minted under.
 */
export declare function parseShapes(shapesTtl: string, shapesBase: string): NormalizedShapes;
/** Whether the graph declares a NodeShape (a `sh:NodeShape` typed subject). */
export declare function hasNodeShape(shapesTtl: string): boolean;
//# sourceMappingURL=shapes.d.ts.map