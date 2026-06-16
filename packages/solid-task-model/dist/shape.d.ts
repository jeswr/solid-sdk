/** Filesystem path to the canonical SHACL shape file. */
export declare const TASK_SHAPE_PATH: string;
/**
 * The canonical federated-task SHACL shape, as a Turtle string. Cached after the
 * first read. Pass it (with the data graph) to a SHACL validator — see the
 * round-trip + cross-app fixture tests for the `rdf-validate-shacl` pattern.
 */
export declare function taskShapeTtl(): string;
//# sourceMappingURL=shape.d.ts.map