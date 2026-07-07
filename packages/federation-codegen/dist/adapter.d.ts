/**
 * L0 — the ontology-INPUT adapter seam (design §3.4). An adapter consumes a source
 * ontology and yields a NORMALIZED description (classes, properties, labels /
 * definitions, domain / range or a waiver, version identity) that the admission
 * checks (L1) and manifest compilation consume. V1 is the OWL/RDFS reader below;
 * a future V2 (content-addressed foundational ontology) is a different adapter
 * producing the same normalized description, leaving everything downstream — the
 * stable waist (shapes) and the manifest — untouched.
 */
import type { Quad } from "@rdfjs/types";
export interface OntologyClass {
    iri: string;
    labels: string[];
    definitions: string[];
}
export interface OntologyProperty {
    iri: string;
    labels: string[];
    definitions: string[];
    domain?: string;
    range?: string;
    /** `fedgen:deliberatelyUnconstrained "reason"` — a machine-readable waiver. */
    unconstrainedWaiver?: string;
}
export interface NormalizedOntology {
    /** The `owl:versionIRI` of the ontology, if declared. */
    versionIri?: string;
    /** `vann:preferredNamespaceUri` — the sector namespace, if declared. */
    namespace?: string;
    classes: OntologyClass[];
    properties: OntologyProperty[];
}
/** An ontology-input adapter (the L0 seam). Part of the hash-pinned generator artifact. */
export interface OntologyAdapter {
    /** A stable adapter identifier recorded in the codegen manifest. */
    readonly name: string;
    adapt(quads: Quad[]): NormalizedOntology;
}
/** The committed V1 adapter: reads OWL / RDFS + SKOS annotation vocabulary. */
export declare const owlRdfsAdapter: OntologyAdapter;
//# sourceMappingURL=adapter.d.ts.map