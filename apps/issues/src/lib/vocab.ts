/**
 * Vocabulary IRIs used by the data layer. Reused, dereferenceable terms only —
 * see `decisions/0001-issue-tracker-vocabulary.md` and `docs/data-modelling.md`.
 * The issue model is the W3C workflow ontology (`wf:`) + Dublin Core Terms (`dct:`),
 * the SolidOS issue-pane model.
 */

/**
 * W3C workflow ontology — `wf:Tracker`, `wf:Task`, `wf:Open`, `wf:Closed`, and the
 * F1 finite-state-machine terms: `wf:State`, `wf:initialState`,
 * `wf:allowedTransitions` (the per-state set of reachable target states).
 */
export const WF = "http://www.w3.org/2005/01/wf/flow#";
/** Dublin Core Terms — generic metadata (title, created, modified, creator). */
export const DCT = "http://purl.org/dc/terms/";
/** RDF — `rdf:type`. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** XSD datatypes (referenced indirectly via the wrapper value mappers). */
export const XSD = "http://www.w3.org/2001/XMLSchema#";
/** RDF Schema — `rdfs:Class`, `rdfs:label`, `rdfs:subClassOf` (priority/label classes). */
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
/** SIOC — `sioc:content` for comment bodies. */
export const SIOC = "http://rdfs.org/sioc/ns#";
/** FOAF — `foaf:maker` (comment author), `foaf:Agent`. */
export const FOAF = "http://xmlns.com/foaf/0.1/";
/** vCard — `vcard:Group`, `vcard:hasMember` (assignee groups). */
export const VCARD = "http://www.w3.org/2006/vcard/ns#";
/** Schema.org (canonical http scheme) — `schema:mentions` for @mentions. */
export const SCHEMA = "http://schema.org/";
/** SKOS — `skos:Concept` / `skos:prefLabel` / `skos:inScheme` (select-field options). */
export const SKOS = "http://www.w3.org/2004/02/skos/core#";
/**
 * PROV-O — `prov:endedAtTime` (completion), `prov:wasDerivedFrom` (clone source),
 * and the F3 activity log: `prov:Activity`, `prov:startedAtTime`,
 * `prov:wasAssociatedWith` (actor), `prov:used` (prior status class),
 * `prov:generated` (new status class).
 */
export const PROV = "http://www.w3.org/ns/prov#";

export const wf = (local: string) => `${WF}${local}`;
export const dct = (local: string) => `${DCT}${local}`;
export const rdf = (local: string) => `${RDF}${local}`;
export const rdfs = (local: string) => `${RDFS}${local}`;
export const sioc = (local: string) => `${SIOC}${local}`;
export const foaf = (local: string) => `${FOAF}${local}`;
export const vcard = (local: string) => `${VCARD}${local}`;
export const schema = (local: string) => `${SCHEMA}${local}`;
export const xsd = (local: string) => `${XSD}${local}`;
export const skos = (local: string) => `${SKOS}${local}`;
export const prov = (local: string) => `${PROV}${local}`;

/** The two terminal/non-terminal state classes an issue is typed with. */
export const STATE = {
  Open: wf("Open"),
  Closed: wf("Closed"),
} as const;
