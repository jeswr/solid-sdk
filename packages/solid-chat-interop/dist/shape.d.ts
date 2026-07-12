/** Filesystem path to the canonical chat-message SHACL shape file. */
export declare const MESSAGE_SHAPE_PATH: string;
/**
 * The canonical chat-message SHACL shape (`as:Note`), as a Turtle string. Cached
 * after the first read. Pass it (with the data graph) to a SHACL validator — see
 * `src/message-shape.test.ts` for the `rdf-validate-shacl` pattern — or hand it to
 * the codegen framework's shape-driven message components to render a message from
 * its shape.
 */
export declare function messageShapeTtl(): string;
//# sourceMappingURL=shape.d.ts.map