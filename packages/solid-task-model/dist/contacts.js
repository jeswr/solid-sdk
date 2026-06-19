// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The shared federated **Contacts** model — typed read/write accessors over the
 * SolidOS `vcard:AddressBook` family (an address book, its people/groups index
 * documents, individual contacts, and groups).
 *
 * **One contacts model, many apps.** A person added in the Pod Manager's contacts
 * view, in solid-issues, or in SolidOS itself is the SAME RDF, so every suite app
 * (and SolidOS) reads it identically — display name, email(s), phone(s), WebID,
 * note — and group membership federates the same way the tracker's assignee group
 * does.
 *
 * **SolidOS-readable by construction.** SolidOS's contacts pane reads a specific
 * shape: an address book at `<book>#this` with `vcard:nameEmailIndex` /
 * `vcard:groupIndex` index documents; individuals at `<person>#this` typed
 * `vcard:Individual` with `vcard:inAddressBook` back-links; and — the crux —
 * email/phone modelled as a STRUCTURED node (`vcard:hasEmail [ a vcard:Home;
 * vcard:value <mailto:..> ]`), NOT a direct IRI. {@link buildPerson} always writes
 * the structured form so SolidOS's form reads it; {@link parsePerson} ACCEPTS BOTH
 * the structured form AND a legacy direct `vcard:hasEmail <mailto:..>` IRI, so no
 * producer's data is dropped on a cross-app read.
 *
 * **Two DC namespaces, both load-bearing.** The address-book minter writes the book
 * label as `dc:title` (DC **Elements 1.1**), while person docs carry `dct:created`
 * (DC **Terms**). These are DIFFERENT namespaces (see {@link ../vocab.ts}); the model
 * honours each exactly.
 *
 * **Typed accessors, never hand-built triples (house rule).** Reads/writes go through
 * `@rdfjs/wrapper`'s mappers on an n3 `Store`, mirroring {@link ./tracker.ts}. The
 * structured email/phone object node is built by minting a blank node via the
 * `BlankNodeFrom` mapper and populating a CHILD `TermWrapper` — exactly how
 * `Tracker.setGroupMembers` mints `#team` and attaches to a child wrapper — never by
 * hand-constructing a quad. Serialisation is `n3.Writer` (via
 * {@link ./task.ts}'s `storeToTurtle`); parsing of a fetched body is
 * `@jeswr/fetch-rdf`'s `parseRdf`.
 *
 * **CLIENT-SAFE.** This module imports no `node:fs` (or any Node built-in). UUIDs use
 * the Web Crypto `crypto.randomUUID()` global (no `node:crypto` import), so a client
 * bundler can put it in a browser chunk — the same reason `task.ts`/`tracker.ts` are
 * the client-safe half and `shape.ts` (which reads the shape via `node:fs`) is
 * server-only.
 */
import { BlankNodeFrom, LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { docOf, httpIriOrUndefined, isHttpIri } from "./iri.js";
import { storeToTurtle } from "./task.js";
import { acl, dc, dct, rdf, VCARD_ADDRESS_BOOK, VCARD_CELL, VCARD_FN, VCARD_GROUP, VCARD_GROUP_INDEX, VCARD_HAS_EMAIL, VCARD_HAS_MEMBER, VCARD_HAS_TELEPHONE, VCARD_HAS_UID, VCARD_HOME, VCARD_IN_ADDRESS_BOOK, VCARD_INCLUDES_GROUP, VCARD_INDIVIDUAL, VCARD_NAME_EMAIL_INDEX, VCARD_NOTE, VCARD_URL, VCARD_VALUE, VCARD_WEB_ID, } from "./vocab.js";
/**
 * Resolve a possibly-relative reference (e.g. `"people.ttl"`) against a base
 * document URL, returning an absolute http(s) IRI, or `undefined` if the result is
 * not http(s) (untrusted-input discipline). An already-absolute http(s) IRI passes
 * through unchanged.
 */
function resolveAgainst(base, ref) {
    try {
        return httpIriOrUndefined(new URL(ref, base).toString());
    }
    catch {
        return undefined;
    }
}
/** True for a well-formed `mailto:` IRI with a non-empty address. */
function isMailto(value) {
    return /^mailto:.+/.test(value);
}
/** True for a well-formed `tel:` IRI with a non-empty number. */
function isTel(value) {
    return /^tel:.+/.test(value);
}
/** Read a blank-node object's value as its raw label (the supported lambda mapping). */
const blankNodeLabel = (term) => term.value;
/**
 * Typed `@rdfjs/wrapper` view of a `vcard:AddressBook` subject (`<book>#this`).
 * Each accessor reads/writes through the vetted mappers — no quad is hand-built.
 */
export class ContactBook extends TermWrapper {
    /** The address book subject IRI (`<book>#this`). */
    get id() {
        return this.value;
    }
    /** The document URL of this book (its subject IRI without the fragment). */
    get doc() {
        return docOf(this.value);
    }
    /** The `rdf:type` set as a live set of IRI strings. */
    get types() {
        return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    /** Stamp this subject as a `vcard:AddressBook`. Idempotent; returns `this`. */
    mark() {
        this.types.add(VCARD_ADDRESS_BOOK);
        return this;
    }
    /** Whether this subject is a `vcard:AddressBook`. */
    get isAddressBook() {
        return this.types.has(VCARD_ADDRESS_BOOK);
    }
    /**
     * The book title. SolidOS's minter writes `dc:title` (DC Elements), so the getter
     * prefers it and falls back to `vcard:fn`; the setter writes BOTH (the SolidOS
     * minter writes `dc:title`, the shape wants `vcard:fn`), and clears both on
     * undefined.
     */
    get title() {
        return (OptionalFrom.subjectPredicate(this, dc("title"), LiteralAs.string) ??
            OptionalFrom.subjectPredicate(this, VCARD_FN, LiteralAs.string));
    }
    set title(value) {
        OptionalAs.object(this, dc("title"), value, LiteralFrom.string);
        OptionalAs.object(this, VCARD_FN, value, LiteralFrom.string);
    }
    /** `vcard:nameEmailIndex` — the people index document IRI. */
    get nameEmailIndex() {
        return OptionalFrom.subjectPredicate(this, VCARD_NAME_EMAIL_INDEX, NamedNodeAs.string);
    }
    set nameEmailIndex(value) {
        OptionalAs.object(this, VCARD_NAME_EMAIL_INDEX, value, NamedNodeFrom.string);
    }
    /** `vcard:groupIndex` — the groups index document IRI. */
    get groupIndex() {
        return OptionalFrom.subjectPredicate(this, VCARD_GROUP_INDEX, NamedNodeAs.string);
    }
    set groupIndex(value) {
        OptionalAs.object(this, VCARD_GROUP_INDEX, value, NamedNodeFrom.string);
    }
    /** `acl:owner` — the owner's WebID. */
    get owner() {
        return OptionalFrom.subjectPredicate(this, acl("owner"), NamedNodeAs.string);
    }
    set owner(value) {
        OptionalAs.object(this, acl("owner"), value, NamedNodeFrom.string);
    }
    /** `vcard:includesGroup` — the group IRIs this book lists (live set). */
    get includesGroup() {
        return SetFrom.subjectPredicate(this, VCARD_INCLUDES_GROUP, NamedNodeAs.string, NamedNodeFrom.string);
    }
    /**
     * Default people/groups index documents resolved relative to the book doc, used
     * when the data supplies none (the SolidOS convention `people.ttl`/`groups.ttl`).
     */
    defaultIndex(name) {
        return resolveAgainst(this.doc, name);
    }
    /** Set the people/groups indexes, defaulting to `people.ttl`/`groups.ttl`. */
    setIndexes(nameEmailIndex, groupIndex) {
        const people = isHttpIri(nameEmailIndex) ? nameEmailIndex : this.defaultIndex("people.ttl");
        const groups = isHttpIri(groupIndex) ? groupIndex : this.defaultIndex("groups.ttl");
        this.nameEmailIndex = people;
        this.groupIndex = groups;
    }
}
/**
 * Mints a fresh structured value node (`[ a <kind>; vcard:value <iri> ]`) under
 * `predicate` on `parent`, WITHOUT hand-building a quad: the parent→node link is
 * created through the `BlankNodeFrom` mapper (`SetFrom` add), then the child node's
 * `rdf:type` and `vcard:value` are set via the mappers on a child wrapper — the same
 * mint-then-populate-child pattern as `Tracker.setGroupMembers`.
 */
function addStructuredValue(parent, predicate, kind, iriValue) {
    const bnode = parent.factory.blankNode();
    // Link parent → blank node via the vetted BlankNodeFrom mapper (no hand-built quad).
    SetFrom.subjectPredicate(parent, predicate, blankNodeLabel, BlankNodeFrom.string).add(bnode.value);
    // Populate the child node through its own wrapper.
    const child = new TermWrapper(bnode, parent.dataset, parent.factory);
    SetFrom.subjectPredicate(child, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(kind);
    OptionalAs.object(child, VCARD_VALUE, iriValue, NamedNodeFrom.string);
}
/**
 * Read every value carried by `predicate` (e.g. `vcard:hasEmail`), accepting BOTH
 * forms: a direct IRI object (legacy `vcard:hasEmail <mailto:..>`) is returned as-is;
 * a blank-node / structured node is followed to its `vcard:value` IRI. Non-IRI /
 * value-less nodes are skipped. The result preserves canonical `mailto:`/`tel:` IRIs.
 */
function readStructuredValues(parent, predicate) {
    const out = [];
    const seen = new Set();
    const p = parent.factory.namedNode(predicate);
    for (const q of parent.dataset.match(parent, p)) {
        const obj = q.object;
        if (obj.termType === "NamedNode") {
            if (!seen.has(obj.value)) {
                seen.add(obj.value);
                out.push(obj.value);
            }
            continue;
        }
        if (obj.termType === "BlankNode") {
            const child = new TermWrapper(obj, parent.dataset, parent.factory);
            const value = OptionalFrom.subjectPredicate(child, VCARD_VALUE, NamedNodeAs.string);
            if (value !== undefined && !seen.has(value)) {
                seen.add(value);
                out.push(value);
            }
        }
    }
    return out;
}
/**
 * Typed `@rdfjs/wrapper` view of a `vcard:Individual` subject (`<person>#this`).
 * The email/phone accessors read BOTH the direct-IRI and structured forms and always
 * WRITE the structured form (the SolidOS contract). No quad is hand-built.
 */
export class Contact extends TermWrapper {
    /** The individual subject IRI (`<person>#this`). */
    get id() {
        return this.value;
    }
    /** The `rdf:type` set as a live set of IRI strings. */
    get types() {
        return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    /** Stamp this subject as a `vcard:Individual`. Idempotent; returns `this`. */
    mark() {
        this.types.add(VCARD_INDIVIDUAL);
        return this;
    }
    /** Whether this subject is a `vcard:Individual`. */
    get isIndividual() {
        return this.types.has(VCARD_INDIVIDUAL);
    }
    /** `vcard:fn` — the formatted/display name. */
    get name() {
        return OptionalFrom.subjectPredicate(this, VCARD_FN, LiteralAs.string);
    }
    set name(value) {
        OptionalAs.object(this, VCARD_FN, value, LiteralFrom.string);
    }
    /** `vcard:inAddressBook` — the owning address book IRI. */
    get inAddressBook() {
        return OptionalFrom.subjectPredicate(this, VCARD_IN_ADDRESS_BOOK, NamedNodeAs.string);
    }
    set inAddressBook(value) {
        OptionalAs.object(this, VCARD_IN_ADDRESS_BOOK, value, NamedNodeFrom.string);
    }
    /** `vcard:hasUID` — a stable unique id literal (the model writes `urn:uuid:<v4>`). */
    get uid() {
        return OptionalFrom.subjectPredicate(this, VCARD_HAS_UID, LiteralAs.string);
    }
    set uid(value) {
        OptionalAs.object(this, VCARD_HAS_UID, value, LiteralFrom.string);
    }
    /** `dct:created` (DC Terms) — the person document's creation time. */
    get created() {
        return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
    }
    set created(value) {
        OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
    }
    /** `vcard:note` — a free-text note. */
    get note() {
        return OptionalFrom.subjectPredicate(this, VCARD_NOTE, LiteralAs.string);
    }
    set note(value) {
        OptionalAs.object(this, VCARD_NOTE, value, LiteralFrom.string);
    }
    /**
     * The contact's emails as canonical `mailto:` IRIs. Reads BOTH a direct
     * `vcard:hasEmail <mailto:..>` and the structured `vcard:hasEmail [ vcard:value
     * <mailto:..> ]` form (the crux behaviour). Only well-formed `mailto:` IRIs are
     * returned: pod data is untrusted, so a `javascript:`/`http:`/literal value from a
     * malicious or malformed contact is DROPPED rather than handed to UI as an email
     * (the public contract is canonical `mailto:` values).
     */
    get emails() {
        return readStructuredValues(this, VCARD_HAS_EMAIL).filter(isMailto);
    }
    /**
     * Replace the contact's emails. Clears any prior `vcard:hasEmail` (structured nodes
     * and direct IRIs), then writes each as the STRUCTURED `[ a vcard:Home; vcard:value
     * <mailto:..> ]` form SolidOS reads. Non-`mailto:` entries are dropped (untrusted
     * input). Accepts either a bare address or a full `mailto:` IRI.
     */
    setEmails(emails) {
        this.clearStructured(VCARD_HAS_EMAIL);
        for (const raw of emails) {
            const iri = raw.startsWith("mailto:") ? raw : `mailto:${raw}`;
            if (isMailto(iri))
                addStructuredValue(this, VCARD_HAS_EMAIL, VCARD_HOME, iri);
        }
    }
    /**
     * The contact's phones as canonical `tel:` IRIs. Reads BOTH a direct
     * `vcard:hasTelephone <tel:..>` and the structured `vcard:hasTelephone [ vcard:value
     * <tel:..> ]` form. Only well-formed `tel:` IRIs are returned: an untrusted/malformed
     * value (e.g. `javascript:`) is DROPPED rather than handed to UI as a phone link.
     */
    get phones() {
        return readStructuredValues(this, VCARD_HAS_TELEPHONE).filter(isTel);
    }
    /**
     * Replace the contact's phones. Clears any prior `vcard:hasTelephone`, then writes
     * each as the STRUCTURED `[ a vcard:Cell; vcard:value <tel:..> ]` form. Non-`tel:`
     * entries are dropped. Accepts either a bare number or a full `tel:` IRI.
     */
    setPhones(phones) {
        this.clearStructured(VCARD_HAS_TELEPHONE);
        for (const raw of phones) {
            const iri = raw.startsWith("tel:") ? raw : `tel:${raw}`;
            if (isTel(iri))
                addStructuredValue(this, VCARD_HAS_TELEPHONE, VCARD_CELL, iri);
        }
    }
    /**
     * The contact's WebID, read from the structured `vcard:url [ a vcard:WebId;
     * vcard:value <webid> ]` form (or a direct `vcard:url <webid>`). Only http(s) IRIs.
     */
    get webId() {
        return readStructuredValues(this, VCARD_URL).find(isHttpIri);
    }
    /**
     * Replace the contact's WebID. Clears any prior `vcard:url`, then writes the
     * structured `[ a vcard:WebId; vcard:value <webid> ]` form. A non-http(s) value is
     * dropped (untrusted input).
     */
    setWebId(webId) {
        this.clearStructured(VCARD_URL);
        if (isHttpIri(webId))
            addStructuredValue(this, VCARD_URL, VCARD_WEB_ID, webId);
    }
    /**
     * Remove every `predicate` edge AND any blank-node value node it pointed at, so a
     * replace leaves no orphan structured node behind. Direct-IRI objects are removed by
     * the edge deletion alone; blank-node objects have their own triples cleared too.
     */
    clearStructured(predicate) {
        const p = this.factory.namedNode(predicate);
        const edges = [...this.dataset.match(this, p)];
        for (const q of edges) {
            if (q.object.termType === "BlankNode") {
                for (const inner of [...this.dataset.match(q.object)])
                    this.dataset.delete(inner);
            }
            this.dataset.delete(q);
        }
    }
}
/**
 * Typed `@rdfjs/wrapper` view of a `vcard:Group` subject (`<group>#this`). Mints and
 * reads `vcard:hasMember` member links via the mappers — no quad is hand-built.
 */
export class ContactGroup extends TermWrapper {
    /** The group subject IRI (`<group>#this`). */
    get id() {
        return this.value;
    }
    /** The `rdf:type` set as a live set of IRI strings. */
    get types() {
        return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    /** Stamp this subject as a `vcard:Group`. Idempotent; returns `this`. */
    mark() {
        this.types.add(VCARD_GROUP);
        return this;
    }
    /** Whether this subject is a `vcard:Group`. */
    get isGroup() {
        return this.types.has(VCARD_GROUP);
    }
    /** `vcard:fn` — the group's display name. */
    get name() {
        return OptionalFrom.subjectPredicate(this, VCARD_FN, LiteralAs.string);
    }
    set name(value) {
        OptionalAs.object(this, VCARD_FN, value, LiteralFrom.string);
    }
    /** `vcard:inAddressBook` — the owning address book IRI. */
    get inAddressBook() {
        return OptionalFrom.subjectPredicate(this, VCARD_IN_ADDRESS_BOOK, NamedNodeAs.string);
    }
    set inAddressBook(value) {
        OptionalAs.object(this, VCARD_IN_ADDRESS_BOOK, value, NamedNodeFrom.string);
    }
    /** `vcard:hasMember` — the member contact IRIs (live set). */
    get members() {
        return SetFrom.subjectPredicate(this, VCARD_HAS_MEMBER, NamedNodeAs.string, NamedNodeFrom.string);
    }
    /**
     * Replace the group's membership (clearing any prior members). Non-http(s) entries
     * are dropped (pod data is untrusted), mirroring `Tracker.setGroupMembers`.
     */
    setMembers(members) {
        const live = this.members;
        for (const m of [...live])
            live.delete(m);
        for (const m of members)
            if (isHttpIri(m))
                live.add(m);
    }
}
// --- Subject conventions ---
/** Conventional address-book subject IRI for a document: `${bookDocUrl}#this`. */
export function addressBookSubject(bookDocUrl) {
    return `${bookDocUrl}#this`;
}
/** Conventional individual subject IRI for a person document: `${personDocUrl}#this`. */
export function personSubject(personDocUrl) {
    return `${personDocUrl}#this`;
}
/** Conventional group subject IRI for a group document: `${groupDocUrl}#this`. */
export function groupSubject(groupDocUrl) {
    return `${groupDocUrl}#this`;
}
// --- AddressBook build / parse ---
/**
 * Parse an address book out of a dataset, or `undefined` if the subject
 * (`${bookDocUrl}#this`) is not a `vcard:AddressBook`.
 */
export function parseAddressBook(bookDocUrl, dataset) {
    const book = new ContactBook(addressBookSubject(bookDocUrl), dataset, DataFactory);
    if (!book.isAddressBook)
        return undefined;
    const data = { title: book.title ?? "" };
    if (book.nameEmailIndex !== undefined)
        data.nameEmailIndex = book.nameEmailIndex;
    if (book.groupIndex !== undefined)
        data.groupIndex = book.groupIndex;
    if (book.owner !== undefined)
        data.owner = book.owner;
    return data;
}
/**
 * Build a fresh n3 `Store` holding one address book rooted at `${bookDocUrl}#this`.
 *
 * Writes the SolidOS-readable shape: `dc:title` + `vcard:fn` (title), the
 * `vcard:nameEmailIndex` / `vcard:groupIndex` index links (defaulting to
 * `people.ttl` / `groups.ttl` resolved against the book doc when unsupplied), and
 * `acl:owner` when a valid WebID is given. Object-property fields that are not
 * absolute http(s) IRIs are dropped (untrusted input).
 */
export function buildAddressBook(bookDocUrl, data) {
    const store = new Store();
    const book = new ContactBook(addressBookSubject(bookDocUrl), store, DataFactory).mark();
    book.title = data.title || undefined;
    book.setIndexes(data.nameEmailIndex, data.groupIndex);
    book.owner = httpIriOrUndefined(data.owner);
    return store;
}
/** Serialise an address book to Turtle (via `n3.Writer`). */
export async function serializeAddressBook(bookDocUrl, data) {
    return storeToTurtle(buildAddressBook(bookDocUrl, data));
}
/**
 * Parse a Turtle / JSON-LD body into an address book, dispatching on `contentType`
 * via `@jeswr/fetch-rdf`'s `parseRdf`. Returns `undefined` if the document holds no
 * `vcard:AddressBook` at `${bookDocUrl}#this`.
 */
export async function parseAddressBookTtl(bookDocUrl, body, contentType = "text/turtle") {
    const resolvedContentType = contentType ?? "text/turtle";
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = await parseRdf(body, resolvedContentType, { baseIRI: bookDocUrl });
    return parseAddressBook(bookDocUrl, dataset);
}
// --- Person (Individual) build / parse ---
/**
 * Parse a contact out of a dataset, or `undefined` if the subject
 * (`${personDocUrl}#this`) is not a `vcard:Individual`.
 */
export function parsePerson(personDocUrl, dataset) {
    const person = new Contact(personSubject(personDocUrl), dataset, DataFactory);
    if (!person.isIndividual)
        return undefined;
    const emails = person.emails;
    const phones = person.phones;
    const data = { name: person.name ?? "" };
    if (person.inAddressBook !== undefined)
        data.inAddressBook = person.inAddressBook;
    if (emails.length > 0)
        data.emails = emails;
    if (phones.length > 0)
        data.phones = phones;
    if (person.webId !== undefined)
        data.webId = person.webId;
    if (person.note !== undefined)
        data.note = person.note;
    if (person.created !== undefined)
        data.created = person.created;
    return data;
}
/**
 * Build a fresh n3 `Store` holding one contact rooted at `${personDocUrl}#this`.
 *
 * Writes the SolidOS-readable shape: `vcard:Individual`, `vcard:fn`, a
 * `vcard:hasUID "urn:uuid:<v4>"` (minted via the Web Crypto `crypto.randomUUID()`
 * global — client-safe), `vcard:inAddressBook`, the STRUCTURED `vcard:hasEmail [ a
 * vcard:Home; vcard:value <mailto:..> ]` / `vcard:hasTelephone [ a vcard:Cell;
 * vcard:value <tel:..> ]` / `vcard:url [ a vcard:WebId; vcard:value <webid> ]` nodes,
 * `vcard:note`, and `dct:created` (defaulting to now). Malformed emails/phones and a
 * non-http(s) WebID / inAddressBook are dropped (untrusted input).
 */
export function buildPerson(personDocUrl, data) {
    const store = new Store();
    const person = new Contact(personSubject(personDocUrl), store, DataFactory).mark();
    person.name = data.name || undefined;
    person.uid = `urn:uuid:${crypto.randomUUID()}`;
    person.inAddressBook = httpIriOrUndefined(data.inAddressBook);
    person.setEmails(data.emails ?? []);
    person.setPhones(data.phones ?? []);
    person.setWebId(data.webId);
    person.note = data.note || undefined;
    person.created = data.created ?? new Date();
    return store;
}
/** Serialise a contact to Turtle (via `n3.Writer`). */
export async function serializePerson(personDocUrl, data) {
    return storeToTurtle(buildPerson(personDocUrl, data));
}
/**
 * Parse a Turtle / JSON-LD body into a contact, dispatching on `contentType` via
 * `@jeswr/fetch-rdf`'s `parseRdf`. Returns `undefined` if the document holds no
 * `vcard:Individual` at `${personDocUrl}#this`.
 */
export async function parsePersonTtl(personDocUrl, body, contentType = "text/turtle") {
    const resolvedContentType = contentType ?? "text/turtle";
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = await parseRdf(body, resolvedContentType, { baseIRI: personDocUrl });
    return parsePerson(personDocUrl, dataset);
}
// --- Group build / parse ---
/**
 * Parse a contact group out of a dataset, or `undefined` if the subject
 * (`${groupDocUrl}#this`) is not a `vcard:Group`.
 */
export function parseGroup(groupDocUrl, dataset) {
    const group = new ContactGroup(groupSubject(groupDocUrl), dataset, DataFactory);
    if (!group.isGroup)
        return undefined;
    const members = [...group.members];
    const data = { name: group.name ?? "" };
    if (group.inAddressBook !== undefined)
        data.inAddressBook = group.inAddressBook;
    if (members.length > 0)
        data.members = members;
    return data;
}
/**
 * Build a fresh n3 `Store` holding one contact group rooted at `${groupDocUrl}#this`.
 *
 * Writes `vcard:Group`, `vcard:fn`, an optional `vcard:inAddressBook` back-link, and
 * the `vcard:hasMember` member edges. Non-http(s) members and a non-http(s)
 * inAddressBook are dropped (untrusted input).
 */
export function buildGroup(groupDocUrl, data) {
    const store = new Store();
    const group = new ContactGroup(groupSubject(groupDocUrl), store, DataFactory).mark();
    group.name = data.name || undefined;
    group.inAddressBook = httpIriOrUndefined(data.inAddressBook);
    group.setMembers(data.members ?? []);
    return store;
}
/** Serialise a contact group to Turtle (via `n3.Writer`). */
export async function serializeGroup(groupDocUrl, data) {
    return storeToTurtle(buildGroup(groupDocUrl, data));
}
/**
 * Parse a Turtle / JSON-LD body into a contact group, dispatching on `contentType`
 * via `@jeswr/fetch-rdf`'s `parseRdf`. Returns `undefined` if the document holds no
 * `vcard:Group` at `${groupDocUrl}#this`.
 */
export async function parseGroupTtl(groupDocUrl, body, contentType = "text/turtle") {
    const resolvedContentType = contentType ?? "text/turtle";
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = await parseRdf(body, resolvedContentType, { baseIRI: groupDocUrl });
    return parseGroup(groupDocUrl, dataset);
}
// --- Index documents (the people.ttl / groups.ttl SolidOS reads) ---
/**
 * Build the **people index** document (`vcard:nameEmailIndex` target). For each
 * contact it writes `person vcard:inAddressBook <book>` and `person vcard:fn <name>`
 * — the minimal listing SolidOS reads to enumerate the book's contacts. `entries`
 * pairs each person IRI with its display name; non-http(s) person IRIs are dropped.
 */
export function buildPeopleIndex(bookSubjectIri, entries) {
    const store = new Store();
    for (const { person, name } of entries) {
        if (!isHttpIri(person))
            continue;
        const p = new Contact(person, store, DataFactory);
        p.inAddressBook = httpIriOrUndefined(bookSubjectIri);
        p.name = name || undefined;
    }
    return store;
}
/** Serialise a people index to Turtle (via `n3.Writer`). */
export function serializePeopleIndex(bookSubjectIri, entries) {
    return storeToTurtle(buildPeopleIndex(bookSubjectIri, entries));
}
/**
 * Build the **groups index** document (`vcard:groupIndex` target). It writes `book
 * vcard:includesGroup <group>` for each group, plus each group's `vcard:Group` type
 * and `vcard:fn` name — the listing SolidOS reads to enumerate the book's groups.
 * `entries` pairs each group IRI with its display name; non-http(s) IRIs are dropped.
 */
export function buildGroupsIndex(bookSubjectIri, entries) {
    const store = new Store();
    if (!isHttpIri(bookSubjectIri))
        return store;
    const book = new ContactBook(bookSubjectIri, store, DataFactory);
    for (const { group, name } of entries) {
        if (!isHttpIri(group))
            continue;
        book.includesGroup.add(group);
        const g = new ContactGroup(group, store, DataFactory).mark();
        g.name = name || undefined;
    }
    return store;
}
/** Serialise a groups index to Turtle (via `n3.Writer`). */
export function serializeGroupsIndex(bookSubjectIri, entries) {
    return storeToTurtle(buildGroupsIndex(bookSubjectIri, entries));
}
//# sourceMappingURL=contacts.js.map