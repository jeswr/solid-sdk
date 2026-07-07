// AUTHORED-BY Claude Opus 4.8
/**
 * `@jeswr/federation-codegen` — ontology-driven data-model codegen for the Solid app
 * suite (design rev-3 P0). Deterministically compiles a sector ontology (OWL/RDFS)
 * + its SHACL profile + a per-domain codegen config into:
 *
 *   - `model.d.ts`  — types only, zero runtime code
 *   - `model.json`  — the compiled shape-manifest, a FIDELITY-ASSERTED verified
 *                     projection of shapes.ttl (never a bespoke schema)
 *   - `model.js`    — a fixed-template shim importing `@jeswr/model-runtime`
 *   - `shapes.ttl`  — the skolemized, byte-reproducible stable waist
 *   - `codegen-manifest.json` — input/output sha256s + adapter + runtime pins
 *
 * Plus the tier-a structural admission validator and the build-time fidelity
 * assertion (the P0 exit criterion). All generated behaviour lives in the audited
 * `@jeswr/model-runtime`; generated artifacts carry no executable logic.
 *
 * @packageDocumentation
 */
export { owlRdfsAdapter, } from "./adapter.js";
export { AdmissionError, admit, assertAdmitted, } from "./admission.js";
export { compileManifest, isFailClosedSeverity, isHttpPattern, } from "./compile.js";
export { entityConfigFor, FIELD_CONFIG_GUARD_KEYS, } from "./config.js";
export { emitModelDts, emitModelJs, emitModelJson, emitShapesTtl } from "./emit.js";
export { assertFidelity, FidelityError } from "./fidelity.js";
export { emitLockfile, GENERATOR, generateModel, } from "./generate.js";
export { compareQuads, Graph, parseTurtle, serializeCanonicalTurtle, } from "./rdf.js";
export { hasNodeShape, localName, parseShapes, } from "./shapes.js";
//# sourceMappingURL=index.js.map