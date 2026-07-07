/**
 * Compile a normalized SHACL shape model + the per-domain codegen config into a
 * {@link ModelManifest} (model.json) — the VERIFIED PROJECTION of shapes.ttl
 * (design §7.2). Shape-derived fields (name, predicate, kind, datatype, cardinality,
 * the http(s) scheme guard from an `^https?://` pattern, requiredFailClosed from
 * minCount) come straight from the shape; the historical lexical guards come from
 * the config. Every field's guard provenance is recorded so the fidelity assertion
 * can prove each traces to EITHER a shape constraint OR a config entry.
 *
 * The result is validated fail-closed by the runtime's own `validateManifest`.
 */
import { type ModelManifest } from "@jeswr/model-runtime";
import { type CodegenConfig } from "./config.js";
import { type NormalizedShapes } from "./shapes.js";
/**
 * A `sh:minCount ≥ 1` compiles to a fail-closed requirement ONLY at
 * `sh:severity sh:Violation` (SHACL's default when severity is ABSENT). A
 * Warning/Info-graded minCount is ADVISORY — it stays in shapes.ttl for
 * validation-time but compiles to NO runtime guard (design G1).
 */
export declare function isFailClosedSeverity(severity: string | undefined): boolean;
/** Which guards on a field came from the config (vs the shape) — for traceability. */
export interface FieldProvenance {
    /** The entity's target class — provenance is keyed per ENTITY, not globally. */
    targetClass: string;
    fieldName: string;
    configGuards: string[];
}
export interface CompileResult {
    manifest: ModelManifest;
    provenance: FieldProvenance[];
}
/** True for a `sh:pattern` that restricts values to http(s) schemes. */
export declare function isHttpPattern(pattern: string | undefined): boolean;
/** Compile the normalized shapes + config into a validated manifest + provenance. */
export declare function compileManifest(shapes: NormalizedShapes, config: CodegenConfig): CompileResult;
//# sourceMappingURL=compile.d.ts.map