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

/** The XSD datatype + lexical value of a parsed iCal date/date-time. */
export interface RdfDateLiteral {
  /** The lexical form (e.g. "2026-06-20" or "2026-06-20T17:30:00Z"). */
  readonly value: string;
  /** The XSD datatype IRI — `xsd:date` or `xsd:dateTime`. */
  readonly datatype:
    | "http://www.w3.org/2001/XMLSchema#date"
    | "http://www.w3.org/2001/XMLSchema#dateTime";
}

const XSD_DATE = "http://www.w3.org/2001/XMLSchema#date" as const;
const XSD_DATE_TIME = "http://www.w3.org/2001/XMLSchema#dateTime" as const;

/** `19970714` (DATE) — 8 digits. */
const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
/** `19970714T173000` or `...Z` (DATE-TIME). The trailing `Z` marks UTC. */
const DATE_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

/** True if (m,d,h,mi,s) are within calendar/clock bounds (no leap-second). */
function inBounds(
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
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
export function parseICalDate(raw: unknown, isDate = false): RdfDateLiteral | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (text.length === 0) return undefined;

  // A `VALUE=DATE` (or a bare 8-digit value) → xsd:date.
  if (isDate || DATE_RE.test(text)) {
    const m = DATE_RE.exec(text);
    if (!m) return undefined;
    const [, y, mo, d] = m;
    const month = Number(mo);
    const day = Number(d);
    if (!inBounds(month, day, 0, 0, 0)) return undefined;
    return { value: `${y}-${mo}-${d}`, datatype: XSD_DATE };
  }

  // Otherwise a DATE-TIME (floating, UTC, or local-to-a-TZID).
  const m = DATE_TIME_RE.exec(text);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!inBounds(Number(mo), Number(d), Number(h), Number(mi), Number(s))) return undefined;
  // Emit the wall-clock; append `Z` only when the source explicitly marked UTC.
  // A floating / TZID-local value gets NO offset (its zone, if any, is carried
  // separately as ical:tzid so no information is lost and no instant is faked).
  const suffix = z === "Z" ? "Z" : "";
  return { value: `${y}-${mo}-${d}T${h}:${mi}:${s}${suffix}`, datatype: XSD_DATE_TIME };
}
