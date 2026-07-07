/**
 * The generation pipeline (design §3): ontology + SHACL profile + codegen config →
 * [L0] adapt → [L1] admission (tier-a) → [L2] parse + skolemize shapes → compile
 * the manifest → assert FIDELITY (P0 exit) → emit the artifacts + a hash-pinned
 * codegen manifest. Pure over its string inputs (deterministic): the same inputs +
 * generator produce byte-identical outputs.
 */
import type { ModelManifest } from "@jeswr/model-runtime";
import { type NormalizedOntology, type OntologyAdapter } from "./adapter.js";
import { type AdmissionReport } from "./admission.js";
import type { CodegenConfig } from "./config.js";
/** The generator artifact identity recorded in the codegen manifest. */
export declare const GENERATOR: {
    readonly name: "@jeswr/federation-codegen";
    readonly specVersion: "1";
};
export interface GenerateInput {
    /** The sector ontology (OWL/RDFS) as Turtle. */
    ontologyTtl: string;
    /** The SHACL profile as Turtle. */
    shapesTtl: string;
    /** The per-domain codegen config. */
    config: CodegenConfig;
    /** Base IRI for parsing (rarely needed for absolute-IRI ontologies). */
    baseIri?: string;
    /** The L0 adapter (defaults to the committed OWL/RDFS V1 adapter). */
    adapter?: OntologyAdapter;
    /** Override the admission namespace (defaults to the ontology's preferred namespace). */
    admissionNamespace?: string;
    /**
     * Proceed even when admission fails — for demonstrating a sector's coverage gap.
     * The admission report is always returned; NEVER set this in a production build.
     */
    allowUnadmitted?: boolean;
}
export interface GenerateResult {
    /** filename → content, for the generated output directory. */
    artifacts: Record<string, string>;
    admission: AdmissionReport;
    manifest: ModelManifest;
    ontology: NormalizedOntology;
}
/** Run the full pipeline. Throws {@link AdmissionError} / FidelityError fail-closed. */
export declare function generateModel(input: GenerateInput): GenerateResult;
/** The Mode-A input lockfile content (sha256 of every fetched/read input). */
export declare function emitLockfile(input: GenerateInput, adapter?: OntologyAdapter): string;
//# sourceMappingURL=generate.d.ts.map