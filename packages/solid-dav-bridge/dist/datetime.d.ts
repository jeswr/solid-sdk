/**
 * iCalendar DATE / DATE-TIME (RFC 5545 §3.3.4, §3.3.5) → RDF literal helpers.
 *
 * A `DTSTART` / `DTEND` value comes in one of these forms:
 *  - `VALUE=DATE`         → `19970714`               → an `xsd:date` "1997-07-14"
 *  - DATE-TIME, UTC       → `19970714T173000Z`       → an `xsd:dateTime` "...Z"
 *  - DATE-TIME, floating  → `19970714T173000`        → an `xsd:dateTime` (no offset)
 *  - DATE-TIME, with TZID → `;TZID=...:19970714T173000` (local to that zone)
 *
 * Phase-1 discipline (read/import-only): we PRESERVE the source value's
 * wall-clock + its zone INFORMATION as faithfully as a literal allows, and we
 * DROP (return `undefined`) anything we cannot parse — an unparseable date never
 * aborts an event, it just omits that one field (untrusted-input hardening).
 *
 * We deliberately do NOT resolve a named `TZID` to a UTC instant (that needs a
 * full IANA tz database — out of scope + a large dependency). For a TZID/floating
 * value we emit the local wall-clock as a no-offset `xsd:dateTime` and carry the
 * original `TZID` separately (the caller attaches it via `ical:tzid`), so no
 * information is lost and no instant is silently mis-converted. This is noted as
 * a follow-up (tz-aware normalisation) in the README.
 */
/** The XSD datatype + lexical value of a parsed iCal date/date-time. */
export interface RdfDateLiteral {
    /** The lexical form (e.g. "2026-06-20" or "2026-06-20T17:30:00Z"). */
    readonly value: string;
    /** The XSD datatype IRI — `xsd:date` or `xsd:dateTime`. */
    readonly datatype: "http://www.w3.org/2001/XMLSchema#date" | "http://www.w3.org/2001/XMLSchema#dateTime";
}
/**
 * Parse an iCalendar DATE or DATE-TIME value into an RDF literal, honouring the
 * `VALUE` parameter (DATE vs DATE-TIME) when present. Returns `undefined` for an
 * absent / wrong-typed / unparseable value (it is then dropped, never fatal).
 *
 * @param raw     - the property VALUE text (e.g. "19970714T173000Z").
 * @param isDate  - whether the property declared `VALUE=DATE` (date-only).
 */
export declare function parseICalDate(raw: unknown, isDate?: boolean): RdfDateLiteral | undefined;
//# sourceMappingURL=datetime.d.ts.map