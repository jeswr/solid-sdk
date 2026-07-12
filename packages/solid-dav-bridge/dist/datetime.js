// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
const XSD_DATE = "http://www.w3.org/2001/XMLSchema#date";
const XSD_DATE_TIME = "http://www.w3.org/2001/XMLSchema#dateTime";
/** `19970714` (DATE) — 8 digits. */
const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
/** `19970714T173000` or `...Z` (DATE-TIME). The trailing `Z` marks UTC. */
const DATE_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;
/** Days in a given (1-based) month of a given year, with leap-year handling. */
function daysInMonth(year, month) {
    // Feb: 29 in a leap year (div by 4, not by 100 unless also by 400), else 28.
    if (month === 2) {
        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        return leap ? 29 : 28;
    }
    // Apr, Jun, Sep, Nov have 30; the rest 31.
    return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
/**
 * True if (y,m,d,h,mi,s) form a real calendar date + clock time (no leap-second).
 * The day is validated against the ACTUAL number of days in the parsed month
 * (incl. leap years), so impossible dates like `20260231` / non-leap `20250229`
 * are rejected (and then dropped) rather than emitted as typed literals.
 */
function inBounds(year, month, day, hour, minute, second) {
    if (month < 1 || month > 12)
        return false;
    if (day < 1 || day > daysInMonth(year, month))
        return false;
    if (hour > 23 || minute > 59 || second > 59)
        return false;
    return true;
}
/**
 * Parse an iCalendar DATE or DATE-TIME value into an RDF literal, honouring the
 * `VALUE` parameter (DATE vs DATE-TIME) when present. Returns `undefined` for an
 * absent / wrong-typed / unparseable value (it is then dropped, never fatal).
 *
 * @param raw     - the property VALUE text (e.g. "19970714T173000Z").
 * @param isDate  - whether the property declared `VALUE=DATE` (date-only).
 */
export function parseICalDate(raw, isDate = false) {
    if (typeof raw !== "string")
        return undefined;
    const text = raw.trim();
    if (text.length === 0)
        return undefined;
    // A `VALUE=DATE` (or a bare 8-digit value) → xsd:date.
    if (isDate || DATE_RE.test(text)) {
        const m = DATE_RE.exec(text);
        if (!m)
            return undefined;
        const [, y, mo, d] = m;
        if (!inBounds(Number(y), Number(mo), Number(d), 0, 0, 0))
            return undefined;
        return { value: `${y}-${mo}-${d}`, datatype: XSD_DATE };
    }
    // Otherwise a DATE-TIME (floating, UTC, or local-to-a-TZID).
    const m = DATE_TIME_RE.exec(text);
    if (!m)
        return undefined;
    const [, y, mo, d, h, mi, s, z] = m;
    if (!inBounds(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s)))
        return undefined;
    // Emit the wall-clock; append `Z` only when the source explicitly marked UTC.
    // A floating / TZID-local value gets NO offset (its zone, if any, is carried
    // separately as ical:tzid so no information is lost and no instant is faked).
    const suffix = z === "Z" ? "Z" : "";
    return { value: `${y}-${mo}-${d}T${h}:${mi}:${s}${suffix}`, datatype: XSD_DATE_TIME };
}
//# sourceMappingURL=datetime.js.map