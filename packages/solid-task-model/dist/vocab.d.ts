/**
 * Vocabulary IRIs for the shared federated Task/Issue model.
 *
 * **Reused, dereferenceable, standard terms only.** Per ADR-0013 (the federation
 * namespace decision) and the R9 data-federation recommendation, the model reuses
 * established vocabularies rather than minting new ones:
 *
 * - **`wf:` — W3C SolidOS workflow ontology** (`http://www.w3.org/2005/01/wf/flow#`).
 *   The canonical class is `wf:Task` and the state classes are `wf:Open` / `wf:Closed`
 *   — the same family SolidOS's own issue-tracker pane reads/writes, so a task created
 *   by one suite app is re-readable in SolidOS and the others. `wf:assignee` carries
 *   the assigned agent's WebID; `wf:tracker` links to the tracker document.
 * - **`dct:` — Dublin Core Terms** for generic metadata: `dct:title`, `dct:description`,
 *   `dct:created`, `dct:modified`, `dct:creator`. Issue↔issue relations reuse DC's
 *   relation family: `dct:isPartOf` (parent), `dct:requires` (blocked-by),
 *   `dct:relation` (relates-to), `dct:isReplacedBy` (duplicate-of).
 * - **`schema:` — schema.org** (canonical `http://` scheme) for `schema:position`
 *   (backlog rank / column order) — the cross-suite term the existing apps already use.
 * - **`prov:` — W3C PROV-O** for `prov:endedAtTime` (completion time, written on close)
 *   and `prov:wasDerivedFrom` (clone provenance).
 * - **`rdf:` / `rdfs:`** for `rdf:type` (state + class) and `rdfs:label`.
 *
 * These are exactly the terms the two existing converged producers use
 * (`jeswr/solid-issues` `src/lib/vocab.ts` + `src/lib/issue.ts`, and
 * `jeswr/solid-pod-manager` `src/lib/issues.ts`), so this package is their common
 * denominator, not a third dialect. See `decisions/0013-…` in `prod-solid-server`
 * and `spec/recommendations/09-data-federation-architecture.md` in
 * `full-solid-ecosystem` (reuse wf/flow, iCal VTODO, schema.org, AS2).
 */
/** W3C SolidOS workflow ontology — `wf:Task`, `wf:Open`, `wf:Closed`, `wf:assignee`, `wf:tracker`. */
export declare const WF = "http://www.w3.org/2005/01/wf/flow#";
/** Dublin Core Terms — title/description/created/modified/creator + the relation family. */
export declare const DCT = "http://purl.org/dc/terms/";
/** RDF — `rdf:type`. */
export declare const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDF Schema — `rdfs:label`. */
export declare const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
/** Schema.org (canonical http scheme) — `schema:position` (rank / column order). */
export declare const SCHEMA = "http://schema.org/";
/** W3C PROV-O — `prov:endedAtTime` (completion), `prov:wasDerivedFrom` (clone source). */
export declare const PROV = "http://www.w3.org/ns/prov#";
/** XSD datatypes (referenced via the wrapper value mappers). */
export declare const XSD = "http://www.w3.org/2001/XMLSchema#";
/** Build a `wf:` term IRI. */
export declare const wf: (local: string) => string;
/** Build a `dct:` term IRI. */
export declare const dct: (local: string) => string;
/** Build an `rdf:` term IRI. */
export declare const rdf: (local: string) => string;
/** Build an `rdfs:` term IRI. */
export declare const rdfs: (local: string) => string;
/** Build a `schema:` term IRI. */
export declare const schema: (local: string) => string;
/** Build a `prov:` term IRI. */
export declare const prov: (local: string) => string;
/** Build an `xsd:` term IRI. */
export declare const xsd: (local: string) => string;
/** The RDF class every federated task is stamped + Type-Index-registered with. */
export declare const TASK_CLASS: string;
/** `rdf:type` value for an open task — the dereferenceable, federation-canonical state. */
export declare const WF_OPEN: string;
/** `rdf:type` value for a closed/done task. */
export declare const WF_CLOSED: string;
/** The `rdf:type` predicate IRI (convenience). */
export declare const RDF_TYPE: string;
/** Prefix map for an n3 Writer that serialises this model (pretty Turtle output). */
export declare const PREFIXES: {
    readonly wf: "http://www.w3.org/2005/01/wf/flow#";
    readonly dct: "http://purl.org/dc/terms/";
    readonly rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    readonly rdfs: "http://www.w3.org/2000/01/rdf-schema#";
    readonly schema: "http://schema.org/";
    readonly prov: "http://www.w3.org/ns/prov#";
};
//# sourceMappingURL=vocab.d.ts.map