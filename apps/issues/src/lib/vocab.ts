/**
 * Vocabulary IRIs used by the data layer. Reused, dereferenceable terms only —
 * see `decisions/0001-issue-tracker-vocabulary.md` and `docs/data-modelling.md`.
 * The issue model is the W3C workflow ontology (`wf:`) + Dublin Core Terms (`dct:`),
 * the SolidOS issue-pane model.
 */

/** W3C workflow ontology — `wf:Tracker`, `wf:Task`, `wf:Open`, `wf:Closed`, … */
export const WF = "http://www.w3.org/2005/01/wf/flow#";
/** Dublin Core Terms — generic metadata (title, created, modified, creator). */
export const DCT = "http://purl.org/dc/terms/";
/** RDF — `rdf:type`. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** XSD datatypes (referenced indirectly via the wrapper value mappers). */
export const XSD = "http://www.w3.org/2001/XMLSchema#";

export const wf = (local: string) => `${WF}${local}`;
export const dct = (local: string) => `${DCT}${local}`;
export const rdf = (local: string) => `${RDF}${local}`;

/** The two terminal/non-terminal state classes an issue is typed with. */
export const STATE = {
  Open: wf("Open"),
  Closed: wf("Closed"),
} as const;
