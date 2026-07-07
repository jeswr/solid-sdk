/**
 * Emit the generated artifacts (design §7): model.json (the verified projection),
 * model.js (a FIXED-TEMPLATE shim that inlines the manifest and calls
 * `@jeswr/model-runtime` — its bytes vary only in the JSON), model.d.ts (types
 * only, zero runtime code), and shapes.ttl (the byte-reproducible stable waist).
 * A generated artifact contains NO executable logic beyond the fixed shim.
 */
import { type ModelManifest } from "@jeswr/model-runtime";
import type { NormalizedShapes } from "./shapes.js";
/** model.json — the compiled manifest, pretty-printed + trailing newline. */
export declare function emitModelJson(manifest: ModelManifest): string;
/** model.js — the fixed-template shim (bytes vary only in the inlined manifest). */
export declare function emitModelJs(manifest: ModelManifest): string;
/** model.d.ts — types only, precise per-entity Data / Wrapper / Entity interfaces. */
export declare function emitModelDts(manifest: ModelManifest): string;
/** shapes.ttl — the skolemized, byte-reproducible stable waist. */
export declare function emitShapesTtl(shapes: NormalizedShapes, prefixes: Record<string, string>): string;
//# sourceMappingURL=emit.d.ts.map