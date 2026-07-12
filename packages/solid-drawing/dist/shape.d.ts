/** Filesystem path to the canonical `draw:Scene` SHACL shape file. */
export declare const DRAWING_SHAPE_PATH: string;
/** Filesystem path to the drawing ontology TTL. */
export declare const DRAWING_ONTOLOGY_PATH: string;
/**
 * The canonical `draw:Scene` SHACL shape, as a Turtle string. Cached after the
 * first read. Pass it (with the data graph) to a SHACL validator — see the
 * round-trip + shape tests for the `rdf-validate-shacl` pattern.
 */
export declare function drawingShapeTtl(): string;
/** The drawing ontology, as a Turtle string. Cached after the first read. */
export declare function drawingOntologyTtl(): string;
//# sourceMappingURL=shape.d.ts.map