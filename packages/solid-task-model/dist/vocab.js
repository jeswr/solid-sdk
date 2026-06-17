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
/**
 * Dublin Core **Elements 1.1** — `http://purl.org/dc/elements/1.1/`. DISTINCT from
 * {@link DCT} (DC Terms, `…/dc/terms/`): the two share local names (`title`,
 * `creator`, …) but live in DIFFERENT namespaces, and they are NOT interchangeable.
 * The SolidOS address-book minter writes the book label as `dc:title` (DC Elements),
 * so the contacts model must read/write THIS namespace for that field — using DC
 * Terms instead would write a triple SolidOS never reads. Both are load-bearing; see
 * {@link ./contacts.ts} (`dc:title` on the book vs `dct:created` on a person doc).
 */
export const DC = "http://purl.org/dc/elements/1.1/";
/** W3C ACL ontology — `http://www.w3.org/ns/auth/acl#`; `acl:owner` on a SolidOS address book. */
export const ACL = "http://www.w3.org/ns/auth/acl#";
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
/**
 * vCard ontology — `vcard:Group` / `vcard:hasMember`, the assignee-group model a
 * tracker uses (`wf:assigneeGroup` → a `vcard:Group` whose `vcard:hasMember`s are
 * the assignable WebIDs). The same term family SolidOS's issue pane reads.
 */
export const VCARD = "http://www.w3.org/2006/vcard/ns#";
/** Build a `wf:` term IRI. */
export const wf = (local) => `${WF}${local}`;
/** Build a `dct:` term IRI (DC **Terms**). */
export const dct = (local) => `${DCT}${local}`;
/** Build a `dc:` term IRI (DC **Elements 1.1** — distinct from `dct:`; see {@link DC}). */
export const dc = (local) => `${DC}${local}`;
/** Build an `acl:` term IRI. */
export const acl = (local) => `${ACL}${local}`;
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
/** Build a `vcard:` term IRI. */
export const vcard = (local) => `${VCARD}${local}`;
/** The RDF class every federated task is stamped + Type-Index-registered with. */
export const TASK_CLASS = wf("Task");
/** `rdf:type` value for an open task — the dereferenceable, federation-canonical state. */
export const WF_OPEN = wf("Open");
/** `rdf:type` value for a closed/done task. */
export const WF_CLOSED = wf("Closed");
/** The `rdf:type` predicate IRI (convenience). */
export const RDF_TYPE = rdf("type");
// --- Tracker terms (the federation-core of the SolidOS issue-tracker config) ---
// All REAL `wf:` terms the live SolidOS issue pane reads/writes — nothing minted.
/** `rdf:type wf:Tracker` — the class stamped on a tracker/project configuration node. */
export const WF_TRACKER = wf("Tracker");
/** `wf:issueClass` — the class a tracker's issues carry (defaults to `wf:Task`). */
export const WF_ISSUE_CLASS = wf("issueClass");
/** `wf:issueCategory` — a category/dimension class declared by the tracker (priority, label, type…). */
export const WF_ISSUE_CATEGORY = wf("issueCategory");
/** `wf:State` — the type of a configurable workflow status class (`#status-*`). */
export const WF_STATE = wf("State");
/** `wf:initialState` — the tracker's starting status class (the workflow's entry state). */
export const WF_INITIAL_STATE = wf("initialState");
/** `wf:allowedTransitions` — a status class's set of reachable target status classes. */
export const WF_ALLOWED_TRANS = wf("allowedTransitions");
/** `wf:stateStore` — the container/resource where the tracker's issue resources live (SolidOS reads this). */
export const WF_STATE_STORE = wf("stateStore");
/** `wf:assigneeGroup` — the tracker's assignee group (`→ vcard:Group` of assignable WebIDs). */
export const WF_ASSIGNEE_GROUP = wf("assigneeGroup");
// --- Contacts terms (the vcard:AddressBook model — the federation-core of a ---
// --- SolidOS address book; see ./contacts.ts). All under the `vcard:` prefix. ---
//
// MIXED PROVENANCE — honour the exact spelling either way:
//   • SolidOS **extension** terms: NOT in the published W3C vCard ontology, but the
//     live SolidOS contacts interop contract uses them, so the model must too —
//     AddressBook, nameEmailIndex, groupIndex, inAddressBook, includesGroup.
//   • STANDARD W3C vCard terms: Individual, Group, fn, hasEmail, hasTelephone,
//     hasUID, url, note, value, hasMember, Home, Cell, WebId.
/**
 * `rdf:type vcard:AddressBook` — SolidOS **extension** class for a contacts address
 * book root (`<book>#this`). Not in the published W3C vCard ontology, but the term
 * the live SolidOS contacts pane reads/writes; honour the exact spelling.
 */
export const VCARD_ADDRESS_BOOK = vcard("AddressBook");
/**
 * `vcard:nameEmailIndex` — SolidOS **extension** predicate linking an address book to
 * its people index document (conventionally `people.ttl`). SolidOS lists contacts
 * from this index; not in the published W3C vCard ontology.
 */
export const VCARD_NAME_EMAIL_INDEX = vcard("nameEmailIndex");
/**
 * `vcard:groupIndex` — SolidOS **extension** predicate linking an address book to its
 * groups index document (conventionally `groups.ttl`). Not in the published W3C vCard
 * ontology.
 */
export const VCARD_GROUP_INDEX = vcard("groupIndex");
/**
 * `vcard:inAddressBook` — SolidOS **extension** predicate on an individual/group
 * pointing back at its owning `vcard:AddressBook`. Not in the published W3C vCard
 * ontology.
 */
export const VCARD_IN_ADDRESS_BOOK = vcard("inAddressBook");
/**
 * `vcard:includesGroup` — SolidOS **extension** predicate on an address book listing a
 * `vcard:Group` it contains. Not in the published W3C vCard ontology.
 */
export const VCARD_INCLUDES_GROUP = vcard("includesGroup");
/** `rdf:type vcard:Individual` — a single contact/person (standard W3C vCard). */
export const VCARD_INDIVIDUAL = vcard("Individual");
/** `rdf:type vcard:Group` — a contact group (standard W3C vCard). */
export const VCARD_GROUP = vcard("Group");
/** `vcard:fn` — formatted (display) name (standard W3C vCard). */
export const VCARD_FN = vcard("fn");
/** `vcard:hasEmail` — an email; SolidOS reads the structured `[ vcard:value <mailto:..> ]` form (standard W3C vCard). */
export const VCARD_HAS_EMAIL = vcard("hasEmail");
/** `vcard:hasTelephone` — a phone; SolidOS reads the structured `[ vcard:value <tel:..> ]` form (standard W3C vCard). */
export const VCARD_HAS_TELEPHONE = vcard("hasTelephone");
/** `vcard:hasUID` — a stable unique id (the model writes `urn:uuid:<v4>`) (standard W3C vCard). */
export const VCARD_HAS_UID = vcard("hasUID");
/** `vcard:url` — a URL; SolidOS reads the structured `[ a vcard:WebId; vcard:value <webid> ]` form (standard W3C vCard). */
export const VCARD_URL = vcard("url");
/** `vcard:note` — a free-text note (standard W3C vCard). */
export const VCARD_NOTE = vcard("note");
/** `vcard:value` — the value carried by a structured email/phone/url node (standard W3C vCard). */
export const VCARD_VALUE = vcard("value");
/** `vcard:hasMember` — a member of a `vcard:Group` (standard W3C vCard; also used by the tracker). */
export const VCARD_HAS_MEMBER = vcard("hasMember");
/** `rdf:type vcard:Home` — the "home" kind stamped on a structured email/phone node (standard W3C vCard). */
export const VCARD_HOME = vcard("Home");
/** `rdf:type vcard:Cell` — the "cell" kind stamped on a structured phone node (standard W3C vCard). */
export const VCARD_CELL = vcard("Cell");
/** `rdf:type vcard:WebId` — the kind stamped on a structured `vcard:url` WebID node (standard W3C vCard). */
export const VCARD_WEB_ID = vcard("WebId");
/** Prefix map for an n3 Writer that serialises this model (pretty Turtle output). */
export const PREFIXES = {
    wf: WF,
    dct: DCT,
    dc: DC,
    acl: ACL,
    rdf: RDF,
    rdfs: RDFS,
    schema: SCHEMA,
    prov: PROV,
    vcard: VCARD,
};
//# sourceMappingURL=vocab.js.map