// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Sample iCalendar / vCard payloads for the unit tests — real-world-shaped VEVENTs
 * (incl. an RRULE, folded lines, a TZID, a VALUE=DATE all-day event) and vCards
 * (multi-card, structured email/phone, an http(s)-UID WebID), plus hostile /
 * malformed entries proving the drop-don't-abort discipline. Nothing here hits the
 * network. CRLF line endings (`\r\n`) match what a real DAV server emits.
 */

/** A VCALENDAR with one VEVENT carrying a weekly RRULE, a UTC DTSTART/DTEND. */
export const veventWithRrule = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//EN",
  "BEGIN:VEVENT",
  "UID:standup-001@example.com",
  "SUMMARY:Weekly standup",
  "DESCRIPTION:Sync on the week\\, then plan.",
  "DTSTART:20260622T090000Z",
  "DTEND:20260622T093000Z",
  "LOCATION:Room 4A",
  "URL:https://meet.example.com/standup",
  "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** An all-day event (VALUE=DATE) — DTSTART has no time component. */
export const veventAllDay = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:holiday-xmas@example.com",
  "SUMMARY:Public holiday",
  "DTSTART;VALUE=DATE:20261225",
  "DTEND;VALUE=DATE:20261226",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** A floating + TZID DATE-TIME event (no UTC `Z`), to exercise tzid carry. */
export const veventTzid = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:local-meeting@example.com",
  "SUMMARY:Local meeting",
  "DTSTART;TZID=Europe/London:20260622T140000",
  "DTEND;TZID=Europe/London:20260622T150000",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** A VCALENDAR with TWO events (a multi-event feed). */
export const veventMulti = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:a@example.com",
  "SUMMARY:Event A",
  "DTSTART:20260601T100000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:b@example.com",
  "SUMMARY:Event B",
  "DTSTART:20260602T100000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/**
 * A HOSTILE / malformed VEVENT: a garbage DTSTART, a `javascript:` URL, an empty
 * SUMMARY, a property with no `:` separator, and a folded line. The mapper MUST
 * drop the bad fields and still produce a typed event (never throw).
 */
export const veventHostile = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:hostile@example.com",
  "SUMMARY:Recovered summary",
  "DTSTART:not-a-real-date",
  "DTEND:20261301T990000Z", // month 13, hour 99 — out of bounds
  "URL:javascript:alert(1)",
  "DESCRIPTION:A very long description that has been folded across",
  "  multiple physical lines per RFC 5545 section 3.1 unfolding rules.",
  "THIS LINE HAS NO COLON SO IS DROPPED",
  "RRULE:FREQ=DAILY",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** A folded SUMMARY (line continuation) to prove unfolding. */
export const veventFolded = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:folded@example.com",
  "SUMMARY:This is a long summary that spans",
  " \tacross two folded lines",
  "DTSTART:20260601T100000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** A single vCard with FN, two EMAILs, a TEL, ORG and NOTE. */
export const vcardBasic = [
  "BEGIN:VCARD",
  "VERSION:4.0",
  "FN:Alice Example",
  "EMAIL;TYPE=work:alice@example.com",
  "EMAIL;TYPE=home:alice.personal@example.net",
  "TEL;TYPE=cell:+1 (555) 123-4567",
  "ORG:Example Corp;Engineering",
  "NOTE:Met at the conference.",
  "UID:urn:uuid:11111111-1111-1111-1111-111111111111",
  "END:VCARD",
].join("\r\n");

/** A vCard whose UID is an http(s) WebID. */
export const vcardWebId = [
  "BEGIN:VCARD",
  "VERSION:4.0",
  "FN:Bob WebID",
  "EMAIL:bob@example.com",
  "UID:https://bob.example/profile/card#me",
  "END:VCARD",
].join("\r\n");

/** A vCard stream of TWO cards (CardDAV multi-card export). */
export const vcardMulti = [
  "BEGIN:VCARD",
  "VERSION:4.0",
  "FN:Carol One",
  "EMAIL:carol@example.com",
  "UID:urn:uuid:aaaa1111-0000-0000-0000-000000000001",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:4.0",
  "FN:Dave Two",
  "TEL:+442071234567",
  "UID:urn:uuid:aaaa1111-0000-0000-0000-000000000002",
  "END:VCARD",
].join("\r\n");

/**
 * A HOSTILE / malformed vCard: a `javascript:` URL, a malformed EMAIL (no `@`), a
 * TEL with no digits, an empty FN. The mapper MUST drop the bad fields and still
 * produce a usable ContactData (never throw).
 */
export const vcardHostile = [
  "BEGIN:VCARD",
  "VERSION:4.0",
  "FN:",
  "EMAIL:not-an-email",
  "EMAIL:good@example.com",
  "TEL:abc-no-digits",
  "URL:javascript:steal()",
  "UID:javascript:evil()",
  "NOTE:still imports the valid bits",
  "END:VCARD",
].join("\r\n");

/**
 * A vCard using RFC 6350 §3.3 property GROUPS (`item1.EMAIL`, `item1.X-ABLabel`) —
 * the shape iCloud / macOS Contacts export. The grouped EMAIL/TEL/URL MUST still be
 * read (the group prefix is stripped from the property name).
 */
export const vcardGrouped = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Grace Grouped",
  "item1.EMAIL;type=INTERNET;type=pref:grace@example.com",
  "item1.X-ABLabel:_$!<Work>!$_",
  "item2.TEL;type=pref:+1-555-987-6543",
  "item2.X-ABLabel:_$!<Mobile>!$_",
  "item3.URL:https://grace.example/profile/card#me",
  "UID:urn:uuid:dddd0000-0000-0000-0000-000000000004",
  "END:VCARD",
].join("\r\n");

/** A vCard with an EMAIL containing IRI-illegal characters — must be dropped. */
export const vcardBadEmailChars = [
  "BEGIN:VCARD",
  "VERSION:4.0",
  "FN:Mallory",
  "EMAIL:bad<inject>@example.com",
  "EMAIL:also bad@example.com",
  "EMAIL:fine@example.com",
  "END:VCARD",
].join("\r\n");

/** A vCard stream with junk between two valid cards. */
export const vcardMessy = [
  "garbage line with no begin",
  "BEGIN:VCARD",
  "VERSION:4.0",
  "FN:Eve Good",
  "EMAIL:eve@example.com",
  "UID:urn:uuid:cccc0000-0000-0000-0000-000000000003",
  "END:VCARD",
  "ANOTHER:stray property outside a card",
  "END:VCARD", // a stray END with no matching BEGIN
].join("\r\n");
