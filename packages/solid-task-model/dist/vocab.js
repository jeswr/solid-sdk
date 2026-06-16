// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
export const WF = "http://www.w3.org/2005/01/wf/flow#";
/** Dublin Core Terms — title/description/created/modified/creator + the relation family. */
export const DCT = "http://purl.org/dc/terms/";
/** RDF — `rdf:type`. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDF Schema — `rdfs:label`. */
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
/** Schema.org (canonical http scheme) — `schema:position` (rank / column order). */
export const SCHEMA = "http://schema.org/";
/** W3C PROV-O — `prov:endedAtTime` (completion), `prov:wasDerivedFrom` (clone source). */
export const PROV = "http://www.w3.org/ns/prov#";
/** XSD datatypes (referenced via the wrapper value mappers). */
export const XSD = "http://www.w3.org/2001/XMLSchema#";
/** Build a `wf:` term IRI. */
export const wf = (local) => `${WF}${local}`;
/** Build a `dct:` term IRI. */
export const dct = (local) => `${DCT}${local}`;
/** Build an `rdf:` term IRI. */
export const rdf = (local) => `${RDF}${local}`;
/** Build an `rdfs:` term IRI. */
export const rdfs = (local) => `${RDFS}${local}`;
/** Build a `schema:` term IRI. */
export const schema = (local) => `${SCHEMA}${local}`;
/** Build a `prov:` term IRI. */
export const prov = (local) => `${PROV}${local}`;
/** Build an `xsd:` term IRI. */
export const xsd = (local) => `${XSD}${local}`;
/** The RDF class every federated task is stamped + Type-Index-registered with. */
export const TASK_CLASS = wf("Task");
/** `rdf:type` value for an open task — the dereferenceable, federation-canonical state. */
export const WF_OPEN = wf("Open");
/** `rdf:type` value for a closed/done task. */
export const WF_CLOSED = wf("Closed");
/** The `rdf:type` predicate IRI (convenience). */
export const RDF_TYPE = rdf("type");
/** Prefix map for an n3 Writer that serialises this model (pretty Turtle output). */
export const PREFIXES = {
    wf: WF,
    dct: DCT,
    rdf: RDF,
    rdfs: RDFS,
    schema: SCHEMA,
    prov: PROV,
};
//# sourceMappingURL=vocab.js.map