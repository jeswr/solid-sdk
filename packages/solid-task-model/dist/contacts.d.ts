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
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
/**
 * A SolidOS address book as a plain, serialisable object. The root resource
 * (`<book>#this`) links the people/groups index documents SolidOS reads.
 */
export interface AddressBookData {
    /** `dc:title` (DC Elements) **and** `vcard:fn` — the book's display title (required). */
    title: string;
    /** `vcard:nameEmailIndex` — the people index document (defaults to `people.ttl`). */
    nameEmailIndex?: string;
    /** `vcard:groupIndex` — the groups index document (defaults to `groups.ttl`). */
    groupIndex?: string;
    /** `acl:owner` — the owner's WebID. */
    owner?: string;
}
/**
 * A single contact (a `vcard:Individual`) as a plain, serialisable object.
 *
 * Emails and phones are arrays so a contact may carry several. They are the
 * CANONICAL `mailto:`/`tel:` IRI values (not bare addresses), so a build → parse
 * round-trip is lossless; `email`/`phone` getters strip the scheme for display.
 */
export interface ContactData {
    /** `vcard:fn` — the formatted/display name (required). */
    name: string;
    /** `vcard:inAddressBook` — the owning address book (`<book>#this`). */
    inAddressBook?: string;
    /** `vcard:hasEmail` — the contact's emails, as canonical `mailto:` IRIs. */
    emails?: string[];
    /** `vcard:hasTelephone` — the contact's phones, as canonical `tel:` IRIs. */
    phones?: string[];
    /** `vcard:url` (`a vcard:WebId`) — the contact's WebID. */
    webId?: string;
    /** `vcard:note` — a free-text note. */
    note?: string;
    /** `dct:created` (DC Terms) — when the person document was created. */
    created?: Date;
}
/**
 * A contact group (a `vcard:Group`) as a plain, serialisable object — a named set
 * of member contacts.
 */
export interface ContactGroupData {
    /** `vcard:fn` — the group's display name (required). */
    name: string;
    /** `vcard:inAddressBook` — the owning address book (`<book>#this`). */
    inAddressBook?: string;
    /** `vcard:hasMember` — the member contact IRIs (`<person>#this`). */
    members?: string[];
}
/**
 * Typed `@rdfjs/wrapper` view of a `vcard:AddressBook` subject (`<book>#this`).
 * Each accessor reads/writes through the vetted mappers — no quad is hand-built.
 */
export declare class ContactBook extends TermWrapper {
    /** The address book subject IRI (`<book>#this`). */
    get id(): string;
    /** The document URL of this book (its subject IRI without the fragment). */
    private get doc();
    /** The `rdf:type` set as a live set of IRI strings. */
    get types(): Set<string>;
    /** Stamp this subject as a `vcard:AddressBook`. Idempotent; returns `this`. */
    mark(): this;
    /** Whether this subject is a `vcard:AddressBook`. */
    get isAddressBook(): boolean;
    /**
     * The book title. SolidOS's minter writes `dc:title` (DC Elements), so the getter
     * prefers it and falls back to `vcard:fn`; the setter writes BOTH (the SolidOS
     * minter writes `dc:title`, the shape wants `vcard:fn`), and clears both on
     * undefined.
     */
    get title(): string | undefined;
    set title(value: string | undefined);
    /** `vcard:nameEmailIndex` — the people index document IRI. */
    get nameEmailIndex(): string | undefined;
    set nameEmailIndex(value: string | undefined);
    /** `vcard:groupIndex` — the groups index document IRI. */
    get groupIndex(): string | undefined;
    set groupIndex(value: string | undefined);
    /** `acl:owner` — the owner's WebID. */
    get owner(): string | undefined;
    set owner(value: string | undefined);
    /** `vcard:includesGroup` — the group IRIs this book lists (live set). */
    get includesGroup(): Set<string>;
    /**
     * Default people/groups index documents resolved relative to the book doc, used
     * when the data supplies none (the SolidOS convention `people.ttl`/`groups.ttl`).
     */
    private defaultIndex;
    /** Set the people/groups indexes, defaulting to `people.ttl`/`groups.ttl`. */
    setIndexes(nameEmailIndex?: string, groupIndex?: string): void;
}
/**
 * Typed `@rdfjs/wrapper` view of a `vcard:Individual` subject (`<person>#this`).
 * The email/phone accessors read BOTH the direct-IRI and structured forms and always
 * WRITE the structured form (the SolidOS contract). No quad is hand-built.
 */
export declare class Contact extends TermWrapper {
    /** The individual subject IRI (`<person>#this`). */
    get id(): string;
    /** The `rdf:type` set as a live set of IRI strings. */
    get types(): Set<string>;
    /** Stamp this subject as a `vcard:Individual`. Idempotent; returns `this`. */
    mark(): this;
    /** Whether this subject is a `vcard:Individual`. */
    get isIndividual(): boolean;
    /** `vcard:fn` — the formatted/display name. */
    get name(): string | undefined;
    set name(value: string | undefined);
    /** `vcard:inAddressBook` — the owning address book IRI. */
    get inAddressBook(): string | undefined;
    set inAddressBook(value: string | undefined);
    /** `vcard:hasUID` — a stable unique id literal (the model writes `urn:uuid:<v4>`). */
    get uid(): string | undefined;
    set uid(value: string | undefined);
    /** `dct:created` (DC Terms) — the person document's creation time. */
    get created(): Date | undefined;
    set created(value: Date | undefined);
    /** `vcard:note` — a free-text note. */
    get note(): string | undefined;
    set note(value: string | undefined);
    /**
     * The contact's emails as canonical `mailto:` IRIs. Reads BOTH a direct
     * `vcard:hasEmail <mailto:..>` and the structured `vcard:hasEmail [ vcard:value
     * <mailto:..> ]` form (the crux behaviour).
     */
    get emails(): string[];
    /**
     * Replace the contact's emails. Clears any prior `vcard:hasEmail` (structured nodes
     * and direct IRIs), then writes each as the STRUCTURED `[ a vcard:Home; vcard:value
     * <mailto:..> ]` form SolidOS reads. Non-`mailto:` entries are dropped (untrusted
     * input). Accepts either a bare address or a full `mailto:` IRI.
     */
    setEmails(emails: string[]): void;
    /**
     * The contact's phones as canonical `tel:` IRIs. Reads BOTH a direct
     * `vcard:hasTelephone <tel:..>` and the structured `vcard:hasTelephone [ vcard:value
     * <tel:..> ]` form.
     */
    get phones(): string[];
    /**
     * Replace the contact's phones. Clears any prior `vcard:hasTelephone`, then writes
     * each as the STRUCTURED `[ a vcard:Cell; vcard:value <tel:..> ]` form. Non-`tel:`
     * entries are dropped. Accepts either a bare number or a full `tel:` IRI.
     */
    setPhones(phones: string[]): void;
    /**
     * The contact's WebID, read from the structured `vcard:url [ a vcard:WebId;
     * vcard:value <webid> ]` form (or a direct `vcard:url <webid>`). Only http(s) IRIs.
     */
    get webId(): string | undefined;
    /**
     * Replace the contact's WebID. Clears any prior `vcard:url`, then writes the
     * structured `[ a vcard:WebId; vcard:value <webid> ]` form. A non-http(s) value is
     * dropped (untrusted input).
     */
    setWebId(webId: string | undefined): void;
    /**
     * Remove every `predicate` edge AND any blank-node value node it pointed at, so a
     * replace leaves no orphan structured node behind. Direct-IRI objects are removed by
     * the edge deletion alone; blank-node objects have their own triples cleared too.
     */
    private clearStructured;
}
/**
 * Typed `@rdfjs/wrapper` view of a `vcard:Group` subject (`<group>#this`). Mints and
 * reads `vcard:hasMember` member links via the mappers — no quad is hand-built.
 */
export declare class ContactGroup extends TermWrapper {
    /** The group subject IRI (`<group>#this`). */
    get id(): string;
    /** The `rdf:type` set as a live set of IRI strings. */
    get types(): Set<string>;
    /** Stamp this subject as a `vcard:Group`. Idempotent; returns `this`. */
    mark(): this;
    /** Whether this subject is a `vcard:Group`. */
    get isGroup(): boolean;
    /** `vcard:fn` — the group's display name. */
    get name(): string | undefined;
    set name(value: string | undefined);
    /** `vcard:inAddressBook` — the owning address book IRI. */
    get inAddressBook(): string | undefined;
    set inAddressBook(value: string | undefined);
    /** `vcard:hasMember` — the member contact IRIs (live set). */
    get members(): Set<string>;
    /**
     * Replace the group's membership (clearing any prior members). Non-http(s) entries
     * are dropped (pod data is untrusted), mirroring `Tracker.setGroupMembers`.
     */
    setMembers(members: string[]): void;
}
/** Conventional address-book subject IRI for a document: `${bookDocUrl}#this`. */
export declare function addressBookSubject(bookDocUrl: string): string;
/** Conventional individual subject IRI for a person document: `${personDocUrl}#this`. */
export declare function personSubject(personDocUrl: string): string;
/** Conventional group subject IRI for a group document: `${groupDocUrl}#this`. */
export declare function groupSubject(groupDocUrl: string): string;
/**
 * Parse an address book out of a dataset, or `undefined` if the subject
 * (`${bookDocUrl}#this`) is not a `vcard:AddressBook`.
 */
export declare function parseAddressBook(bookDocUrl: string, dataset: DatasetCore): AddressBookData | undefined;
/**
 * Build a fresh n3 `Store` holding one address book rooted at `${bookDocUrl}#this`.
 *
 * Writes the SolidOS-readable shape: `dc:title` + `vcard:fn` (title), the
 * `vcard:nameEmailIndex` / `vcard:groupIndex` index links (defaulting to
 * `people.ttl` / `groups.ttl` resolved against the book doc when unsupplied), and
 * `acl:owner` when a valid WebID is given. Object-property fields that are not
 * absolute http(s) IRIs are dropped (untrusted input).
 */
export declare function buildAddressBook(bookDocUrl: string, data: AddressBookData): Store;
/** Serialise an address book to Turtle (via `n3.Writer`). */
export declare function serializeAddressBook(bookDocUrl: string, data: AddressBookData): Promise<string>;
/**
 * Parse a Turtle / JSON-LD body into an address book, dispatching on `contentType`
 * via `@jeswr/fetch-rdf`'s `parseRdf`. Returns `undefined` if the document holds no
 * `vcard:AddressBook` at `${bookDocUrl}#this`.
 */
export declare function parseAddressBookTtl(bookDocUrl: string, body: string, contentType?: string | null): Promise<AddressBookData | undefined>;
/**
 * Parse a contact out of a dataset, or `undefined` if the subject
 * (`${personDocUrl}#this`) is not a `vcard:Individual`.
 */
export declare function parsePerson(personDocUrl: string, dataset: DatasetCore): ContactData | undefined;
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
export declare function buildPerson(personDocUrl: string, data: ContactData): Store;
/** Serialise a contact to Turtle (via `n3.Writer`). */
export declare function serializePerson(personDocUrl: string, data: ContactData): Promise<string>;
/**
 * Parse a Turtle / JSON-LD body into a contact, dispatching on `contentType` via
 * `@jeswr/fetch-rdf`'s `parseRdf`. Returns `undefined` if the document holds no
 * `vcard:Individual` at `${personDocUrl}#this`.
 */
export declare function parsePersonTtl(personDocUrl: string, body: string, contentType?: string | null): Promise<ContactData | undefined>;
/**
 * Parse a contact group out of a dataset, or `undefined` if the subject
 * (`${groupDocUrl}#this`) is not a `vcard:Group`.
 */
export declare function parseGroup(groupDocUrl: string, dataset: DatasetCore): ContactGroupData | undefined;
/**
 * Build a fresh n3 `Store` holding one contact group rooted at `${groupDocUrl}#this`.
 *
 * Writes `vcard:Group`, `vcard:fn`, an optional `vcard:inAddressBook` back-link, and
 * the `vcard:hasMember` member edges. Non-http(s) members and a non-http(s)
 * inAddressBook are dropped (untrusted input).
 */
export declare function buildGroup(groupDocUrl: string, data: ContactGroupData): Store;
/** Serialise a contact group to Turtle (via `n3.Writer`). */
export declare function serializeGroup(groupDocUrl: string, data: ContactGroupData): Promise<string>;
/**
 * Parse a Turtle / JSON-LD body into a contact group, dispatching on `contentType`
 * via `@jeswr/fetch-rdf`'s `parseRdf`. Returns `undefined` if the document holds no
 * `vcard:Group` at `${groupDocUrl}#this`.
 */
export declare function parseGroupTtl(groupDocUrl: string, body: string, contentType?: string | null): Promise<ContactGroupData | undefined>;
/**
 * Build the **people index** document (`vcard:nameEmailIndex` target). For each
 * contact it writes `person vcard:inAddressBook <book>` and `person vcard:fn <name>`
 * — the minimal listing SolidOS reads to enumerate the book's contacts. `entries`
 * pairs each person IRI with its display name; non-http(s) person IRIs are dropped.
 */
export declare function buildPeopleIndex(bookSubjectIri: string, entries: {
    person: string;
    name: string;
}[]): Store;
/** Serialise a people index to Turtle (via `n3.Writer`). */
export declare function serializePeopleIndex(bookSubjectIri: string, entries: {
    person: string;
    name: string;
}[]): Promise<string>;
/**
 * Build the **groups index** document (`vcard:groupIndex` target). It writes `book
 * vcard:includesGroup <group>` for each group, plus each group's `vcard:Group` type
 * and `vcard:fn` name — the listing SolidOS reads to enumerate the book's groups.
 * `entries` pairs each group IRI with its display name; non-http(s) IRIs are dropped.
 */
export declare function buildGroupsIndex(bookSubjectIri: string, entries: {
    group: string;
    name: string;
}[]): Store;
/** Serialise a groups index to Turtle (via `n3.Writer`). */
export declare function serializeGroupsIndex(bookSubjectIri: string, entries: {
    group: string;
    name: string;
}[]): Promise<string>;
//# sourceMappingURL=contacts.d.ts.map