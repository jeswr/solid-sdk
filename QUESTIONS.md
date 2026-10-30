<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# TSK-L6 conservative interpretations

1. **Row limit and locations** (14-pure-libraries-6 / TSK-L6): count CSV data
   records, excluding the header; quoted newlines do not create records. Accept
   20,000 data records. Locations are one-based physical starting lines. Check
   UTF-8 bytes and record count before constructing fields or drafts. Accept LF
   and RFC 4180 CRLF separators; reject bare CR separators and malformed quoting.
2. **Missing and ambiguous fields** (TSK-L6): require only TYPE and CONTENT, as
   explicitly specified; absent other columns behave as empty. Default empty
   INDENT to 1. Reject duplicate known headers, inconsistent widths, empty task/section
   titles, invalid priorities, and invalid dates/zones with typed errors. Ignore
   extra columns. Reset the parent stack at sections; notes attach to the last
   task in file order, even across sections or skipped rows.
3. **ISO dates and DST** (TSK-L6; 06-tasks §5.3): accept extended Gregorian
   YYYY-MM-DD and YYYY-MM-DDTHH:mm[:ss[.fraction]] (up to milliseconds), with an
   optional Z or ±HH:mm offset. Preserve the all-day date plus the corresponding
   midnight UTC instant and zone. Explicit offsets determine the instant. Reject
   invalid/unsupported ISO-shaped dates and ambiguous/nonexistent local times
   rather than choosing an offset or normalising. Other date text remains verbatim
   with a warning; DATE_LANG is preserved without interpretation.
4. **Draft details** (TSK-L6; 06-tasks §4.1): use deterministic record-based local
   IDs and zero-based integer order keys (gaps for notes/skipped rows); priorities
   are 1–4 as in the existing quick-add draft. Preserve author/responsible strings
   without resolving identities. Extract standalone @labels (letters, numbers,
   underscore, hyphen), preserving case and duplicates. Leave markdown, escaped
   tokens, emails, links and code spans intact. Labels beside markdown punctuation
   remain literal to avoid changing markup. Durations must be positive finite
   decimal amounts that round-trip without precision loss/exponent notation, with
   the exact unit minute/day; an empty amount with Todoist's `None` unit marker
   means absent, while other units without an amount fail. Accept IANA names
   and links supported by Intl, but reject non-IANA abbreviations such as PST.

These choices allow implementation without a blocking design decision. No UI is
built, so visual fixture routes, screenshots and browser checks do not apply.
