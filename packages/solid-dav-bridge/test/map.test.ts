// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { findComponents, parseComponents } from "../src/ical.js";
import { vcardToContact, veventToEvent } from "../src/map.js";
import {
  ICAL_RRULE,
  ICAL_VEVENT,
  RDF_TYPE,
  SCHEMA_DESCRIPTION,
  SCHEMA_END_DATE,
  SCHEMA_EVENT,
  SCHEMA_IDENTIFIER,
  SCHEMA_NAME,
  SCHEMA_START_DATE,
  SCHEMA_URL,
} from "../src/vocab.js";
import {
  vcardBadEmailChars,
  vcardBasic,
  vcardGrouped,
  vcardHostile,
  vcardWebId,
  veventAllDay,
  veventHostile,
  veventTzid,
  veventWithRrule,
} from "./fixtures.js";

const SUBJECT = "https://alice.pod.example/imports/dav/event-x.ttl#it";

/** Pull the single VEVENT out of a fixture. */
function firstVevent(ics: string) {
  return findComponents(parseComponents(ics), "VEVENT")[0]!;
}
/** Pull the first VCARD out of a fixture. */
function firstVcard(vcf: string) {
  return findComponents(parseComponents(vcf), "VCARD")[0]!;
}

/** Find quads with a given predicate IRI. */
function predValues(quads: ReturnType<typeof veventToEvent>["quads"], predicate: string): string[] {
  return quads.filter((q) => q.predicate.value === predicate).map((q) => q.object.value);
}

describe("veventToEvent", () => {
  it("maps a VEVENT with an RRULE to schema:Event + ical:Vevent", () => {
    const { quads, subject, uid } = veventToEvent(firstVevent(veventWithRrule), {
      subject: SUBJECT,
    });
    expect(subject).toBe(SUBJECT);
    expect(uid).toBe("standup-001@example.com");

    // typed BOTH schema:Event AND ical:Vevent
    const types = predValues(quads, RDF_TYPE);
    expect(types).toContain(SCHEMA_EVENT);
    expect(types).toContain(ICAL_VEVENT);

    expect(predValues(quads, SCHEMA_NAME)).toContain("Weekly standup");
    // DESCRIPTION had an escaped comma → unescaped
    expect(predValues(quads, SCHEMA_DESCRIPTION)).toContain("Sync on the week, then plan.");
    expect(predValues(quads, SCHEMA_IDENTIFIER)).toContain("standup-001@example.com");

    // dates parsed to xsd:dateTime (UTC)
    expect(predValues(quads, SCHEMA_START_DATE)).toContain("2026-06-22T09:00:00Z");
    expect(predValues(quads, SCHEMA_END_DATE)).toContain("2026-06-22T09:30:00Z");

    // RRULE carried RAW as ical:rrule (not expanded)
    expect(predValues(quads, ICAL_RRULE)).toContain("FREQ=WEEKLY;BYDAY=MO;COUNT=10");

    // URL was http(s) → schema:url is a NamedNode
    const urlQuad = quads.find((q) => q.predicate.value === SCHEMA_URL);
    expect(urlQuad?.object.termType).toBe("NamedNode");
    expect(urlQuad?.object.value).toBe("https://meet.example.com/standup");

    // LOCATION → a schema:Place blank node with schema:name "Room 4A"
    const placeName = quads.find(
      (q) => q.predicate.value === SCHEMA_NAME && q.object.value === "Room 4A",
    );
    expect(placeName).toBeDefined();
    expect(placeName?.subject.termType).toBe("BlankNode");
  });

  it("maps an all-day (VALUE=DATE) event to xsd:date start/end", () => {
    const { quads } = veventToEvent(firstVevent(veventAllDay), { subject: SUBJECT });
    const start = quads.find((q) => q.predicate.value === SCHEMA_START_DATE);
    expect(start?.object.value).toBe("2026-12-25");
    expect(start?.object.termType).toBe("Literal");
    // the literal datatype is xsd:date
    expect((start?.object as { datatype?: { value: string } }).datatype?.value).toBe(
      "http://www.w3.org/2001/XMLSchema#date",
    );
  });

  it("carries a TZID for a local (non-UTC) DATE-TIME", () => {
    const { quads } = veventToEvent(firstVevent(veventTzid), { subject: SUBJECT });
    expect(predValues(quads, SCHEMA_START_DATE)).toContain("2026-06-22T14:00:00");
    expect(predValues(quads, "http://www.w3.org/2002/12/cal/ical#tzid")).toContain("Europe/London");
  });

  it("HARDENING: a hostile VEVENT drops bad fields but still yields a typed event", () => {
    const { quads } = veventToEvent(firstVevent(veventHostile), { subject: SUBJECT });
    // typed
    expect(predValues(quads, RDF_TYPE)).toContain(SCHEMA_EVENT);
    // good summary kept
    expect(predValues(quads, SCHEMA_NAME)).toContain("Recovered summary");
    // garbage DTSTART dropped, out-of-bounds DTEND dropped
    expect(predValues(quads, SCHEMA_START_DATE)).toHaveLength(0);
    expect(predValues(quads, SCHEMA_END_DATE)).toHaveLength(0);
    // javascript: URL dropped — no schema:url, and the string never appears
    expect(predValues(quads, SCHEMA_URL)).toHaveLength(0);
    expect(quads.some((q) => q.object.value.includes("javascript:"))).toBe(false);
    // RRULE still carried raw
    expect(predValues(quads, ICAL_RRULE)).toContain("FREQ=DAILY");
    // the folded description was unfolded into one value
    expect(predValues(quads, SCHEMA_DESCRIPTION)[0]).toContain("multiple physical lines");
  });

  it("an empty VEVENT still produces a valid (typed) event", () => {
    const vevent = findComponents(parseComponents("BEGIN:VEVENT\r\nEND:VEVENT"), "VEVENT")[0]!;
    const { quads } = veventToEvent(vevent, { subject: SUBJECT });
    expect(predValues(quads, RDF_TYPE)).toContain(SCHEMA_EVENT);
    expect(predValues(quads, RDF_TYPE)).toContain(ICAL_VEVENT);
  });
});

describe("vcardToContact", () => {
  it("maps a basic vCard to ContactData (mailto/tel canonicalised)", () => {
    const { data, uid } = vcardToContact(firstVcard(vcardBasic), {
      inAddressBook: "https://alice.pod.example/contacts/book.ttl#this",
    });
    expect(data.name).toBe("Alice Example");
    expect(data.inAddressBook).toBe("https://alice.pod.example/contacts/book.ttl#this");
    expect(data.emails).toEqual(["mailto:alice@example.com", "mailto:alice.personal@example.net"]);
    // phone normalised: punctuation stripped, leading + kept
    expect(data.phones).toEqual(["tel:+15551234567"]);
    // ORG folded into note (ContactData has no org field)
    expect(data.note).toContain("Met at the conference.");
    expect(data.note).toContain("Organization: Example Corp — Engineering");
    // urn:uuid UID is NOT a WebID → no webId, but uid carried for slug
    expect(data.webId).toBeUndefined();
    expect(uid).toBe("urn:uuid:11111111-1111-1111-1111-111111111111");
  });

  it("uses an http(s) UID as the WebID", () => {
    const { data } = vcardToContact(firstVcard(vcardWebId));
    expect(data.webId).toBe("https://bob.example/profile/card#me");
  });

  it("HARDENING: a hostile vCard drops bad fields, keeps the good email", () => {
    const { data } = vcardToContact(firstVcard(vcardHostile));
    // empty FN → empty name (buildPerson tolerates it), never throws
    expect(data.name).toBe("");
    // malformed email dropped, valid one kept
    expect(data.emails).toEqual(["mailto:good@example.com"]);
    // TEL with no digits dropped
    expect(data.phones).toBeUndefined();
    // javascript: UID/URL dropped → no webId, never leaked
    expect(data.webId).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("javascript:");
    expect(data.note).toContain("still imports the valid bits");
  });

  it("drops a non-http(s) inAddressBook", () => {
    const { data } = vcardToContact(firstVcard(vcardWebId), { inAddressBook: "urn:not-a-book" });
    expect(data.inAddressBook).toBeUndefined();
  });

  it("de-duplicates repeated emails/phones", () => {
    const vcf = "BEGIN:VCARD\r\nFN:Dup\r\nEMAIL:a@x.com\r\nEMAIL:a@x.com\r\nEND:VCARD";
    const { data } = vcardToContact(firstVcard(vcf));
    expect(data.emails).toEqual(["mailto:a@x.com"]);
  });

  it("REGRESSION: reads grouped vCard properties (item1.EMAIL / item2.TEL / item3.URL)", () => {
    // iCloud/macOS export property groups; the EMAIL/TEL/URL must NOT be silently
    // dropped just because they carry an `itemN.` prefix.
    const { data } = vcardToContact(firstVcard(vcardGrouped));
    expect(data.name).toBe("Grace Grouped");
    expect(data.emails).toEqual(["mailto:grace@example.com"]);
    expect(data.phones).toEqual(["tel:+15559876543"]);
    expect(data.webId).toBe("https://grace.example/profile/card#me");
  });

  it("REGRESSION: drops an email containing IRI-illegal chars, keeps the valid one", () => {
    const { data } = vcardToContact(firstVcard(vcardBadEmailChars));
    // "bad<inject>@..." and "also bad@..." are dropped; only "fine@..." survives.
    expect(data.emails).toEqual(["mailto:fine@example.com"]);
    expect(JSON.stringify(data)).not.toContain("<inject>");
    expect(JSON.stringify(data)).not.toContain(" ");
  });

  it("REGRESSION: percent-encodes email-legal-but-IRI-unsafe local chars in the mailto IRI", () => {
    // `#`, `%`, `` ` ``, `{`, `|`, `}`, `?`, `&`, `=`, `/`, `+` are valid in an email
    // local part but NOT safe unescaped in a mailto: IRI — they must be percent-encoded,
    // never emitted raw (which would be a malformed/ambiguous IRI).
    const vcf = "BEGIN:VCARD\r\nFN:Hash\r\nEMAIL:a#b%c`d{e|f}g?h@example.com\r\nEND:VCARD";
    const { data } = vcardToContact(firstVcard(vcf));
    const email = data.emails?.[0] ?? "";
    expect(email.startsWith("mailto:")).toBe(true);
    // the raw special chars do not appear after `mailto:`
    for (const bad of ["#", "%c", "`", "{", "|", "}", "?"]) {
      // (note: `%c` not `%` alone, since `%` becomes the literal `%25`)
      expect(email).not.toContain(bad);
    }
    // they were percent-encoded (e.g. # → %23, % → %25, ? → %3F)
    expect(email).toContain("%23"); // #
    expect(email).toContain("%25"); // %
    expect(email).toContain("%3F"); // ?
    // the domain is untouched
    expect(email.endsWith("@example.com")).toBe(true);
  });

  it("a plain email is NOT encoded (round-trips cleanly)", () => {
    const vcf = "BEGIN:VCARD\r\nFN:Plain\r\nEMAIL:first.last@sub.example.com\r\nEND:VCARD";
    const { data } = vcardToContact(firstVcard(vcf));
    expect(data.emails).toEqual(["mailto:first.last@sub.example.com"]);
  });
});
