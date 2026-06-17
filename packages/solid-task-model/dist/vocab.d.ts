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
/**
 * Dublin Core **Elements 1.1** — `http://purl.org/dc/elements/1.1/`. DISTINCT from
 * {@link DCT} (DC Terms, `…/dc/terms/`): the two share local names (`title`,
 * `creator`, …) but live in DIFFERENT namespaces, and they are NOT interchangeable.
 * The SolidOS address-book minter writes the book label as `dc:title` (DC Elements),
 * so the contacts model must read/write THIS namespace for that field — using DC
 * Terms instead would write a triple SolidOS never reads. Both are load-bearing; see
 * {@link ./contacts.ts} (`dc:title` on the book vs `dct:created` on a person doc).
 */
export declare const DC = "http://purl.org/dc/elements/1.1/";
/** W3C ACL ontology — `http://www.w3.org/ns/auth/acl#`; `acl:owner` on a SolidOS address book. */
export declare const ACL = "http://www.w3.org/ns/auth/acl#";
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
/**
 * vCard ontology — `vcard:Group` / `vcard:hasMember`, the assignee-group model a
 * tracker uses (`wf:assigneeGroup` → a `vcard:Group` whose `vcard:hasMember`s are
 * the assignable WebIDs). The same term family SolidOS's issue pane reads.
 */
export declare const VCARD = "http://www.w3.org/2006/vcard/ns#";
/** Build a `wf:` term IRI. */
export declare const wf: (local: string) => string;
/** Build a `dct:` term IRI (DC **Terms**). */
export declare const dct: (local: string) => string;
/** Build a `dc:` term IRI (DC **Elements 1.1** — distinct from `dct:`; see {@link DC}). */
export declare const dc: (local: string) => string;
/** Build an `acl:` term IRI. */
export declare const acl: (local: string) => string;
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
/** Build a `vcard:` term IRI. */
export declare const vcard: (local: string) => string;
/** The RDF class every federated task is stamped + Type-Index-registered with. */
export declare const TASK_CLASS: string;
/** `rdf:type` value for an open task — the dereferenceable, federation-canonical state. */
export declare const WF_OPEN: string;
/** `rdf:type` value for a closed/done task. */
export declare const WF_CLOSED: string;
/** The `rdf:type` predicate IRI (convenience). */
export declare const RDF_TYPE: string;
/** `rdf:type wf:Tracker` — the class stamped on a tracker/project configuration node. */
export declare const WF_TRACKER: string;
/** `wf:issueClass` — the class a tracker's issues carry (defaults to `wf:Task`). */
export declare const WF_ISSUE_CLASS: string;
/** `wf:issueCategory` — a category/dimension class declared by the tracker (priority, label, type…). */
export declare const WF_ISSUE_CATEGORY: string;
/** `wf:State` — the type of a configurable workflow status class (`#status-*`). */
export declare const WF_STATE: string;
/** `wf:initialState` — the tracker's starting status class (the workflow's entry state). */
export declare const WF_INITIAL_STATE: string;
/** `wf:allowedTransitions` — a status class's set of reachable target status classes. */
export declare const WF_ALLOWED_TRANS: string;
/** `wf:stateStore` — the container/resource where the tracker's issue resources live (SolidOS reads this). */
export declare const WF_STATE_STORE: string;
/** `wf:assigneeGroup` — the tracker's assignee group (`→ vcard:Group` of assignable WebIDs). */
export declare const WF_ASSIGNEE_GROUP: string;
/**
 * `rdf:type vcard:AddressBook` — SolidOS **extension** class for a contacts address
 * book root (`<book>#this`). Not in the published W3C vCard ontology, but the term
 * the live SolidOS contacts pane reads/writes; honour the exact spelling.
 */
export declare const VCARD_ADDRESS_BOOK: string;
/**
 * `vcard:nameEmailIndex` — SolidOS **extension** predicate linking an address book to
 * its people index document (conventionally `people.ttl`). SolidOS lists contacts
 * from this index; not in the published W3C vCard ontology.
 */
export declare const VCARD_NAME_EMAIL_INDEX: string;
/**
 * `vcard:groupIndex` — SolidOS **extension** predicate linking an address book to its
 * groups index document (conventionally `groups.ttl`). Not in the published W3C vCard
 * ontology.
 */
export declare const VCARD_GROUP_INDEX: string;
/**
 * `vcard:inAddressBook` — SolidOS **extension** predicate on an individual/group
 * pointing back at its owning `vcard:AddressBook`. Not in the published W3C vCard
 * ontology.
 */
export declare const VCARD_IN_ADDRESS_BOOK: string;
/**
 * `vcard:includesGroup` — SolidOS **extension** predicate on an address book listing a
 * `vcard:Group` it contains. Not in the published W3C vCard ontology.
 */
export declare const VCARD_INCLUDES_GROUP: string;
/** `rdf:type vcard:Individual` — a single contact/person (standard W3C vCard). */
export declare const VCARD_INDIVIDUAL: string;
/** `rdf:type vcard:Group` — a contact group (standard W3C vCard). */
export declare const VCARD_GROUP: string;
/** `vcard:fn` — formatted (display) name (standard W3C vCard). */
export declare const VCARD_FN: string;
/** `vcard:hasEmail` — an email; SolidOS reads the structured `[ vcard:value <mailto:..> ]` form (standard W3C vCard). */
export declare const VCARD_HAS_EMAIL: string;
/** `vcard:hasTelephone` — a phone; SolidOS reads the structured `[ vcard:value <tel:..> ]` form (standard W3C vCard). */
export declare const VCARD_HAS_TELEPHONE: string;
/** `vcard:hasUID` — a stable unique id (the model writes `urn:uuid:<v4>`) (standard W3C vCard). */
export declare const VCARD_HAS_UID: string;
/** `vcard:url` — a URL; SolidOS reads the structured `[ a vcard:WebId; vcard:value <webid> ]` form (standard W3C vCard). */
export declare const VCARD_URL: string;
/** `vcard:note` — a free-text note (standard W3C vCard). */
export declare const VCARD_NOTE: string;
/** `vcard:value` — the value carried by a structured email/phone/url node (standard W3C vCard). */
export declare const VCARD_VALUE: string;
/** `vcard:hasMember` — a member of a `vcard:Group` (standard W3C vCard; also used by the tracker). */
export declare const VCARD_HAS_MEMBER: string;
/** `rdf:type vcard:Home` — the "home" kind stamped on a structured email/phone node (standard W3C vCard). */
export declare const VCARD_HOME: string;
/** `rdf:type vcard:Cell` — the "cell" kind stamped on a structured phone node (standard W3C vCard). */
export declare const VCARD_CELL: string;
/** `rdf:type vcard:WebId` — the kind stamped on a structured `vcard:url` WebID node (standard W3C vCard). */
export declare const VCARD_WEB_ID: string;
/** Prefix map for an n3 Writer that serialises this model (pretty Turtle output). */
export declare const PREFIXES: {
    readonly wf: "http://www.w3.org/2005/01/wf/flow#";
    readonly dct: "http://purl.org/dc/terms/";
    readonly dc: "http://purl.org/dc/elements/1.1/";
    readonly acl: "http://www.w3.org/ns/auth/acl#";
    readonly rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    readonly rdfs: "http://www.w3.org/2000/01/rdf-schema#";
    readonly schema: "http://schema.org/";
    readonly prov: "http://www.w3.org/ns/prov#";
    readonly vcard: "http://www.w3.org/2006/vcard/ns#";
};
//# sourceMappingURL=vocab.d.ts.map