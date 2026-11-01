/**
 * Emit the generated artifacts (design §7): model.json (the verified projection),
 * model.js (a FIXED-TEMPLATE shim that inlines the manifest and calls
 * `@jeswr/model-runtime` — its bytes vary only in the JSON), model.d.ts (types
 * only, zero runtime code), and shapes.ttl (the byte-reproducible stable waist).
 * A generated artifact contains NO executable logic beyond the fixed shim.
 *
 * COMPOSITE PER-NODE VIEWS: when the manifest carries composite entities, model.js
 * additionally inlines the derived node-views manifest + index (see `nodeviews.ts`)
 * and exposes `nodes` — one typed per-node Wrapper handle per composite sub-node.
 * The per-node section is PART OF THE FIXED TEMPLATE (identical bytes for every
 * generated model; only the two inlined JSON blobs vary), and all behaviour still
 * runs through the audited runtime's `defineModel` — the template merely zips the
 * inlined index DATA with the interpreted view model. (Follow-up consolidation:
 * once `@jeswr/model-runtime` exposes per-node wrappers natively on a composite
 * entity, this template section collapses to a re-export.)
 */
import { type ModelManifest } from "@jeswr/model-runtime";
import type { NodeViews } from "./nodeviews.js";
import type { NormalizedShapes } from "./shapes.js";
/** model.json — the compiled manifest, pretty-printed + trailing newline. */
export declare function emitModelJson(manifest: ModelManifest): string;
/** model.js — the fixed-template shim (bytes vary only in the inlined manifests). */
export declare function emitModelJs(manifest: ModelManifest, nodeViews?: NodeViews): string;
/** model.d.ts — types only, precise per-entity Data / Wrapper / Entity interfaces. */
export declare function emitModelDts(manifest: ModelManifest, nodeViews?: NodeViews): string;
/** shapes.ttl — the skolemized, byte-reproducible stable waist. */
export declare function emitShapesTtl(shapes: NormalizedShapes, prefixes: Record<string, string>): string;
//# sourceMappingURL=emit.d.ts.map