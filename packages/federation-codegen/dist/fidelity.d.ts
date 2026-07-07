/**
 * THE P0 EXIT CRITERION — the build-time FIDELITY ASSERTION (design §7.2). model.json
 * is a VERIFIED PROJECTION of shapes.ttl, not a bespoke schema: at generation time
 * the generator re-derives an order-independent projection of the merged shapes and
 * asserts, field-for-field and constraint-for-constraint, that model.json covers it
 * exactly — failing the build on any mismatch. Guard flags with no shapes source
 * must trace to the committed config (traceability), so a guard can never be minted
 * silently.
 *
 * Three checks, all order-independent:
 *   (a) STRUCTURAL: {name, predicate, kind, datatype, cardinality, collection}
 *       match field-for-field between the shapes and the manifest.
 *   (b) PATTERN COVERAGE: every `^https?://` shape pattern is reflected as an
 *       http(s) scheme guard in the manifest, and no un-sourced scheme guard exists.
 *   (c) TRACEABILITY: every manifest guard is shape-derived or config-declared.
 */
import { type CompileResult } from "./compile.js";
import { type NormalizedShapes } from "./shapes.js";
/** Thrown when model.json is not a faithful projection of shapes.ttl. */
export declare class FidelityError extends Error {
    readonly name = "FidelityError";
}
/**
 * Assert model.json is a faithful, fully-traceable projection of shapes.ttl.
 * Throws {@link FidelityError} on any mismatch (fails the build). This is the P0
 * exit criterion; a seeded manifest mutation must make it throw. Flat entities and
 * composite entities are verified separately (each shape a composite claims as a node
 * is projected inside that composite, never also as a flat entity).
 */
export declare function assertFidelity(shapes: NormalizedShapes, compiled: CompileResult): void;
//# sourceMappingURL=fidelity.d.ts.map