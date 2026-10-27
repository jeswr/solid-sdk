// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Codex GPT-6.1-Sol
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
 * canonical `tel:` IRI, FN → name, NOTE → note, ORG's first component →
 * organization. Any organisational units are preserved in `note`.
 *
 * UNTRUSTED-INPUT DISCIPLINE throughout: an unparseable date drops THAT field
 * (never aborts the event); a non-http(s) URL/UID is dropped from the IRI fields;
 * a missing required field yields an empty/placeholder value rather than a throw.
 */

import type { ContactData } from "@jeswr/solid-task-model/contacts";
import type { Quad } from "@rdfjs/types";
import { DataFactory } from "n3";
import { parseICalDate } from "./datetime.js";
import {
  type Component,
  type ContentLine,
  getProperties,
  getProperty,
  unescapeText,
} from "./ical.js";
import {
  ICAL_RRULE,
  ICAL_TZID,
  ICAL_UID,
  ICAL_VEVENT,
  RDF_TYPE,
  SCHEMA_DESCRIPTION,
  SCHEMA_END_DATE,
  SCHEMA_EVENT,
  SCHEMA_IDENTIFIER,
  SCHEMA_LOCATION,
  SCHEMA_NAME,
  SCHEMA_PLACE,
  SCHEMA_START_DATE,
  SCHEMA_URL,
  safeHttpIri,
} from "./vocab.js";

const { namedNode, literal, blankNode, quad } = DataFactory;

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

/** Read the first property value of a component, TEXT-unescaped, or `undefined`. */
function textProp(component: Component, name: string): string | undefined {
  const prop = getProperty(component, name);
  if (!prop || typeof prop.value !== "string") return undefined;
  // .trim() is INTENTIONAL: RFC 5545/6350 content-line values can carry surrounding
  // / folding whitespace, so every field (incl. the IRI fields URL/UID that feed
  // safeHttpIri) is trimmed here first. This is SAFE for the IRI path — safeHttpIri
  // still LEXICALLY escapes the trimmed result before it becomes a NamedNode, so a
  // hostile value can never inject; trimming only means a padded-but-otherwise-valid
  // URL/UID is accepted (as its trimmed IRI) rather than rejected on the whitespace.
  // (safeHttpIri's OWN raw-whitespace rejection still guards a caller that passes an
  // untrimmed value directly — e.g. options.inAddressBook — belt-and-suspenders.)
  const text = unescapeText(prop.value).trim();
  return text.length > 0 ? text : undefined;
}

/** Whether a date property declared `VALUE=DATE` (date-only). */
function isDateValue(prop: ContentLine | undefined): boolean {
  return prop?.params.VALUE?.toUpperCase() === "DATE";
}

/**
 * Add a `schema:startDate`/`schema:endDate` (typed xsd:date / xsd:dateTime) plus,
 * when the source carried a `TZID`, an `ical:tzid` literal so the zone is not lost.
 * An unparseable date is DROPPED (no triple), never fatal.
 */
function addDate(
  quads: Quad[],
  subjectTerm: ReturnType<typeof namedNode>,
  prop: ContentLine | undefined,
  predicate: string,
): void {
  if (!prop || typeof prop.value !== "string") return;
  const parsed = parseICalDate(prop.value, isDateValue(prop));
  if (!parsed) return;
  quads.push(
    quad(subjectTerm, namedNode(predicate), literal(parsed.value, namedNode(parsed.datatype))),
  );
  const tzid = prop.params.TZID;
  if (typeof tzid === "string" && tzid.trim().length > 0) {
    quads.push(quad(subjectTerm, namedNode(ICAL_TZID), literal(tzid.trim())));
  }
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
export function veventToEvent(component: Component, options: VeventToEventOptions): MappedEvent {
  const subject = options.subject;
  const s = namedNode(subject);
  const quads: Quad[] = [];

  // Type the subject as both schema:Event and ical:Vevent.
  quads.push(quad(s, namedNode(RDF_TYPE), namedNode(SCHEMA_EVENT)));
  quads.push(quad(s, namedNode(RDF_TYPE), namedNode(ICAL_VEVENT)));

  const uid = textProp(component, "UID");
  if (uid !== undefined) {
    quads.push(quad(s, namedNode(SCHEMA_IDENTIFIER), literal(uid)));
    quads.push(quad(s, namedNode(ICAL_UID), literal(uid)));
  }

  const summary = textProp(component, "SUMMARY");
  if (summary !== undefined) {
    quads.push(quad(s, namedNode(SCHEMA_NAME), literal(summary)));
  }

  const description = textProp(component, "DESCRIPTION");
  if (description !== undefined) {
    quads.push(quad(s, namedNode(SCHEMA_DESCRIPTION), literal(description)));
  }

  addDate(quads, s, getProperty(component, "DTSTART"), SCHEMA_START_DATE);
  addDate(quads, s, getProperty(component, "DTEND"), SCHEMA_END_DATE);

  // LOCATION → a schema:Place blank node with a schema:name (a literal location
  // would also be valid, but a Place with a name is the richer, lossless shape).
  const location = textProp(component, "LOCATION");
  if (location !== undefined) {
    const place = blankNode();
    quads.push(quad(s, namedNode(SCHEMA_LOCATION), place));
    quads.push(quad(place, namedNode(RDF_TYPE), namedNode(SCHEMA_PLACE)));
    quads.push(quad(place, namedNode(SCHEMA_NAME), literal(location)));
  }

  // URL → schema:url only when it is an absolute http(s) IRI (untrusted input).
  // safeHttpIri (not the raw value) is emitted: it lexically percent-encodes every
  // Turtle-IRIREF-illegal char, so a hostile `URL:` value cannot break out of the
  // `<...>` and inject triples (n3.Writer does not escape IRIs).
  const url = safeHttpIri(textProp(component, "URL"));
  if (url !== undefined) {
    quads.push(quad(s, namedNode(SCHEMA_URL), namedNode(url)));
  }

  // RRULE → ical:rrule, raw string verbatim (phase-1: not expanded). There can be
  // more than one RRULE/RDATE in theory; carry each raw value.
  for (const rrule of getProperties(component, "RRULE")) {
    if (typeof rrule.value === "string" && rrule.value.trim().length > 0) {
      quads.push(quad(s, namedNode(ICAL_RRULE), literal(rrule.value.trim())));
    }
  }

  const result: MappedEvent = uid !== undefined ? { subject, quads, uid } : { subject, quads };
  return result;
}

// --- vCard → ContactData ---

/**
 * A conservative email-address allowlist: an RFC 5322 `atext` local part (the
 * common atom characters), exactly one `@`, and a dotted domain of
 * letters/digits/hyphens. This REJECTS characters that cannot appear in an email
 * at all (e.g. `<`, `>`, `"`, `(`, `)`, `[`, `]`, `,`, `;`, `:`, whitespace,
 * control chars) so a malformed/hostile address is dropped rather than handed on.
 * It is intentionally not a full RFC 5322 validator — it errs on the side of
 * dropping the unusual.
 *
 * NOTE: some atext characters that are LEGAL in an email (`#`, `%`, `` ` ``, `{`,
 * `|`, `}`, `/`, `?`, `&`, `=`, `+`) are NOT safe UNESCAPED in a `mailto:` IRI, so
 * {@link toMailto} percent-encodes the local part for the IRI — the address passes
 * the allowlist, but the emitted IRI is always well-formed (no raw IRI-illegal char
 * ever reaches the serializer).
 */
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

/**
 * The characters RFC 6068 §2 allows UNESCAPED in a `mailto:` addr-spec local part
 * (`unreserved` + the `some-delims` subset that does not break URI parsing). Any
 * other (still email-legal) atext char — `#`, `%`, `/`, `?`, `&`, `=`, `+`,
 * `` ` ``, `{`, `|`, `}` — is percent-encoded. (`@` is the separator and is never
 * in the local part here; the domain is hostname-restricted by EMAIL_RE.)
 */
const MAILTO_LOCAL_SAFE = /[A-Za-z0-9!$'*\-.^_~]/;

/** Percent-encode one character (its UTF-8 bytes) for a URI. */
function pctEncodeChar(ch: string): string {
  let out = "";
  const bytes = new TextEncoder().encode(ch);
  for (const b of bytes) out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  return out;
}

/** Percent-encode any non-{@link MAILTO_LOCAL_SAFE} char in a mailto local part. */
function encodeMailtoLocal(local: string): string {
  let out = "";
  for (const ch of local) out += MAILTO_LOCAL_SAFE.test(ch) ? ch : pctEncodeChar(ch);
  return out;
}

/**
 * Normalise a raw email address to a WELL-FORMED canonical `mailto:` IRI, or
 * `undefined`. The address must pass {@link EMAIL_RE}; the local part is then
 * percent-encoded for the IRI so no IRI-illegal character (e.g. `#`, `%`, `` ` ``)
 * is ever emitted unescaped (the domain is already hostname-restricted).
 */
function toMailto(raw: string): string | undefined {
  const addr = raw
    .trim()
    .replace(/^mailto:/i, "")
    .trim();
  if (!EMAIL_RE.test(addr)) return undefined;
  // Split on the LAST '@' (the local part of EMAIL_RE has no '@', so there is
  // exactly one, but be defensive).
  const at = addr.lastIndexOf("@");
  const local = addr.slice(0, at);
  const domain = addr.slice(at + 1);
  return `mailto:${encodeMailtoLocal(local)}@${domain}`;
}

/**
 * Normalise a raw phone number to a canonical `tel:` IRI, or `undefined`. Keeps a
 * leading `+` and digits; strips spaces, dashes, parens, dots. A value with no
 * digits is dropped.
 */
function toTel(raw: string): string | undefined {
  let v = raw.trim().replace(/^tel:/i, "").trim();
  const plus = v.startsWith("+");
  v = v.replace(/[^0-9]/g, "");
  if (v.length === 0) return undefined;
  return `tel:${plus ? "+" : ""}${v}`;
}

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

/** Split ORG on unescaped semicolons BEFORE TEXT-unescaping each component. */
function organizationComponents(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\") {
      // Skip the escaped character, including an escaped backslash. This keeps
      // odd/even backslash runs from turning literal semicolons into separators.
      i++;
    } else if (value[i] === ";") {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  // Preserve an empty first component: a unit must never become the name.
  return parts.map((part) => unescapeText(part).trim());
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
 *  - `ORG`   → first component to `organization`, remaining units to `note`
 *
 * Untrusted-input hardened: every field is independently guarded; a malformed
 * entry is dropped, never fatal.
 */
export function vcardToContact(
  component: Component,
  options: VcardToContactOptions = {},
): MappedContact {
  const name = textProp(component, "FN") ?? "";

  const emails: string[] = [];
  for (const e of getProperties(component, "EMAIL")) {
    if (typeof e.value !== "string") continue;
    const mailto = toMailto(unescapeText(e.value));
    if (mailto && !emails.includes(mailto)) emails.push(mailto);
  }

  const phones: string[] = [];
  for (const t of getProperties(component, "TEL")) {
    if (typeof t.value !== "string") continue;
    const tel = toTel(unescapeText(t.value));
    if (tel && !phones.includes(tel)) phones.push(tel);
  }

  // WebID: a UID that is an http(s) URL is the WebID; else the first http(s) URL.
  const uidRaw = textProp(component, "UID");
  // A UID may be `urn:uuid:...` (not a WebID) — only treat an http(s) UID as a WebID.
  // safeHttpIri validates the scheme AND lexically escapes the value: the webId flows
  // into serializePerson → an IRI object, so it MUST be injection-safe (never the raw
  // untrusted string).
  let webId: string | undefined = safeHttpIri(uidRaw);
  if (webId === undefined) {
    for (const u of getProperties(component, "URL")) {
      if (typeof u.value === "string") {
        // .trim() intentional (folding whitespace) — see textProp; safeHttpIri still
        // lexically escapes the trimmed result, so this cannot inject.
        const candidate = safeHttpIri(unescapeText(u.value).trim());
        if (candidate !== undefined) {
          webId = candidate;
          break;
        }
      }
    }
  }

  // ORG is structured (name;unit;...), with RFC 6350 §3.4 TEXT escaping.
  const noteText = textProp(component, "NOTE");
  const orgRaw = getProperty(component, "ORG")?.value;
  const [organization, ...units] = typeof orgRaw === "string" ? organizationComponents(orgRaw) : [];
  const orgUnits = units.filter((p) => p.length > 0).join(" — ");
  const noteParts: string[] = [];
  if (noteText) noteParts.push(noteText);
  if (orgUnits) noteParts.push(`Organization: ${orgUnits}`);
  const note = noteParts.length > 0 ? noteParts.join("\n") : undefined;

  const data: ContactData = { name };
  // inAddressBook is caller-supplied but still becomes an IRI object → validate + escape.
  const inAddressBook = safeHttpIri(options.inAddressBook);
  if (inAddressBook !== undefined) {
    data.inAddressBook = inAddressBook;
  }
  if (emails.length > 0) data.emails = emails;
  if (phones.length > 0) data.phones = phones;
  if (webId !== undefined) data.webId = webId;
  if (organization) data.organization = organization;
  if (note !== undefined) data.note = note;

  // The re-sync uid is the raw UID (which may be `urn:uuid:` or an http WebID) —
  // used by the ingest layer to mint a stable slug. It is NOT a ContactData field.
  return uidRaw !== undefined ? { data, uid: uidRaw } : { data };
}
