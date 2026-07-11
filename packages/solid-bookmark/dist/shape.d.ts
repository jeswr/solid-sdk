/** Filesystem path to the canonical bookmark ontology (`bookmark.ttl`). */
export declare const BOOKMARK_ONTOLOGY_PATH: string;
/** Filesystem path to the canonical bookmark SHACL shape (`bookmark.shacl.ttl`). */
export declare const BOOKMARK_SHAPE_PATH: string;
/**
 * The bookmark ontology (`book:Bookmark` class + the two minted predicates +
 * alignments), as a Turtle string. Cached after the first read.
 */
export declare function bookmarkOntologyTtl(): string;
/**
 * The canonical `book:Bookmark` SHACL shape, as a Turtle string. Cached after the
 * first read. Pass it (with the data graph) to a SHACL validator — see the
 * round-trip + shape fixture tests for the `rdf-validate-shacl` pattern.
 */
export declare function bookmarkShapeTtl(): string;
//# sourceMappingURL=shape.d.ts.map