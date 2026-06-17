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
/**
 * W3C OWL-Time — the F4 time-tracking model. A worklog entry's logged effort is a
 * `time:Duration` linked via `time:hasDuration`; the duration carries a
 * `time:numericDuration` (xsd:decimal) in the `time:unitType` units we fix to
 * `time:unitSecond` (one canonical unit, so figures sum without conversion).
 */
export const TIME = "http://www.w3.org/2006/time#";
/**
 * Solid Notifications Protocol vocabulary — used to discover a server's
 * notification subscription services from its storage description doc
 * (F10, server-agnostic): `notify:subscription` (a description subject →
 * a subscription-service resource) and `notify:channelType` (the channel
 * type a subscription service implements, e.g. `notify:WebSocketChannel2023`).
 */
export const NOTIFY = "http://www.w3.org/ns/solid/notifications#";
/**
 * W3C Linked Data Platform — `ldp:inbox` (the WebID → LDN inbox container link),
 * `ldp:contains` (an LDP container → its members). The LDN inbox view reads
 * `ldp:inbox` off the profile and lists the inbox container's `ldp:contains`
 * members (Linked Data Notifications, https://www.w3.org/TR/ldn/).
 */
export const LDP = "http://www.w3.org/ns/ldp#";
/**
 * W3C ActivityStreams 2.0 — the notification model the LDN inbox holds. Each
 * notification is an AS2 `Activity` (`as:Announce`, `as:Add`, `as:Create`, …)
 * with `as:actor` (who), `as:object` (the issue/resource), `as:summary`/
 * `as:content` (human text) and `as:published` (when).
 */
export const AS = "https://www.w3.org/ns/activitystreams#";

export const wf = (local: string) => `${WF}${local}`;
/**
 * Saved-view predicates. A shareable saved view is persisted in the tracker
 * config document (so it follows the user across devices and is visible to any
 * collaborator who can read the tracker — the Jira/Monday "saved filter"
 * hallmark), declared via `wf:savedView` from the tracker. Its serialised query
 * + layout are carried as a single JSON literal on `wf:viewQuery`; `dct:title`
 * holds the display name. The query JSON is an app-private payload, not a
 * federated predicate — the cross-app model is unchanged.
 */
export const SAVED_VIEW = wf("savedView");
export const VIEW_QUERY = wf("viewQuery");
/**
 * Version (release) predicate. A tracker-declared version is a
 * `schema:SoftwareVersion` fragment of the tracker config doc, ordered by
 * `schema:position` with a `schema:releaseDate`; its released/unreleased state
 * (Jira's "release" toggle) is an app-local boolean on `wf:released` — the same
 * `wf:`-namespace extension idiom as `wf:savedView`/`wf:allowedTransitions`/
 * `wf:issueCategory` (no new vocab is minted). An issue points at a version via
 * `wf:affectsVersion` (the version it was observed in) and `wf:fixVersion` (the
 * version it is targeted to be fixed in).
 */
export const RELEASED = wf("released");
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
export const time = (local: string) => `${TIME}${local}`;
export const notify = (local: string) => `${NOTIFY}${local}`;
export const ldp = (local: string) => `${LDP}${local}`;
export const as = (local: string) => `${AS}${local}`;

/** The single canonical OWL-Time unit all logged durations are stored in. */
export const TIME_UNIT_SECOND = time("unitSecond");

/** The two terminal/non-terminal state classes an issue is typed with. */
export const STATE = {
  Open: wf("Open"),
  Closed: wf("Closed"),
} as const;
