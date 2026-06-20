/**
 * PURE MAPPERS — iCalendar VEVENT → schema:Event RDF, and vCard → the suite's
 * `ContactData` (consumed by `@jeswr/solid-task-model`'s `buildPerson`). No
 * network, no I/O — these are the fixture-tested core.
 *
 * **VEVENT → schema:Event.** schema.org has no event RDF in the suite already,
 * so this module emits `schema:Event` quads itself via the n3 `DataFactory`
 * (typed-quad construction — NEVER hand-concatenated Turtle strings) and serialises
 * with `n3.Writer`. It keeps the W3C RDF-iCal vocab (`ical:`) for fields schema.org
 * lacks — chiefly the raw `RRULE` (carried verbatim as `ical:rrule`; recurrence is
 * NOT expanded in phase 1) — and types the subject BOTH `schema:Event` and
 * `ical:Vevent` so a reader of either vocabulary finds it. No new vocab is invented.
 *
 * **vCard → ContactData.** We do NOT hand-build vcard triples — we map the vCard
 * to the plain `ContactData` shape and hand it to `@jeswr/solid-task-model`'s
 * `buildPerson`, which writes the SolidOS-readable structured `vcard:hasEmail [
 * vcard:value <mailto:..> ]` form. Email → canonical `mailto:` IRI, TEL →
 * canonical `tel:` IRI, FN → name, NOTE → note. `ContactData` has no ORG field, so
 * ORG is folded sensibly into `note` (flagged as a model gap to upstream).
 *
 * UNTRUSTED-INPUT DISCIPLINE throughout: an unparseable date drops THAT field
 * (never aborts the event); a non-http(s) URL/UID is dropped from the IRI fields;
 * a missing required field yields an empty/placeholder value rather than a throw.
 */
import type { ContactData } from "@jeswr/solid-task-model/contacts";
import type { Quad } from "@rdfjs/types";
import { type Component } from "./ical.js";
/** Options for {@link veventToEvent}. */
export interface VeventToEventOptions {
    /** The subject IRI to mint the event under (the resource `#it` is conventional). */
    readonly subject: string;
}
/** The result of mapping a VEVENT: the subject IRI + the constructed quads. */
export interface MappedEvent {
    /** The event subject IRI. */
    readonly subject: string;
    /** The constructed RDF quads (typed `schema:Event` + `ical:Vevent`). */
    readonly quads: Quad[];
    /** The VEVENT `UID` value, when present (for slug derivation / re-sync). */
    readonly uid?: string;
}
/**
 * Map a single iCalendar VEVENT {@link Component} to `schema:Event` RDF quads.
 *
 * Mapping (RFC 5545 → schema.org / W3C RDF-iCal):
 *  - `UID`         → `schema:identifier` (literal) + `ical:uid` + the {@link MappedEvent.uid}
 *  - `SUMMARY`     → `schema:name`
 *  - `DESCRIPTION` → `schema:description`
 *  - `DTSTART`     → `schema:startDate` (xsd:date / xsd:dateTime; +`ical:tzid`)
 *  - `DTEND`       → `schema:endDate`
 *  - `LOCATION`    → `schema:location` — a `schema:Place` blank node with `schema:name`
 *  - `URL`         → `schema:url` (only if an absolute http(s) IRI)
 *  - `RRULE`       → `ical:rrule` (raw string, NOT expanded)
 *  - the subject is typed BOTH `schema:Event` and `ical:Vevent`.
 *
 * Untrusted-input hardened: each field is independently parse-guarded so a bad
 * value drops only that field. The subject is always typed (a totally empty
 * VEVENT still yields a valid, if sparse, event).
 */
export declare function veventToEvent(component: Component, options: VeventToEventOptions): MappedEvent;
/** The result of mapping one vCard. */
export interface MappedContact {
    /** The plain `ContactData` to hand to `buildPerson`. */
    readonly data: ContactData;
    /** The vCard `UID` value, when present (for slug derivation / re-sync). */
    readonly uid?: string;
}
/** Options for {@link vcardToContact}. */
export interface VcardToContactOptions {
    /** `vcard:inAddressBook` — the owning address book IRI (`<book>#this`), optional. */
    readonly inAddressBook?: string;
}
/**
 * Map a single vCard {@link Component} to `ContactData` (the input to
 * `@jeswr/solid-task-model`'s `buildPerson`). We do NOT build vcard triples here —
 * that is the task-model's job; this is the field map only.
 *
 * Mapping (RFC 6350 → ContactData):
 *  - `FN`    → `name` (required; falls back to "" if absent so buildPerson never NPEs)
 *  - `EMAIL` → `emails[]` as canonical `mailto:` IRIs (malformed dropped)
 *  - `TEL`   → `phones[]` as canonical `tel:` IRIs (malformed dropped)
 *  - `UID`   → `webId` IF it is an http(s) WebID, else carried as the re-sync uid only
 *  - `URL`   → `webId` when `UID` was not a WebID and the URL is http(s)
 *  - `NOTE`  → `note`
 *  - `ORG`   → folded into `note` (ContactData has no ORG field — model gap, flagged)
 *
 * Untrusted-input hardened: every field is independently guarded; a malformed
 * entry is dropped, never fatal.
 */
export declare function vcardToContact(component: Component, options?: VcardToContactOptions): MappedContact;
//# sourceMappingURL=map.d.ts.map