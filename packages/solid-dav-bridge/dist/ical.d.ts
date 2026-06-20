/**
 * A minimal, self-contained iCalendar / vCard CONTENT-LINE parser — the shared
 * RFC 5545 §3.1 / RFC 6350 §3.2 grammar (both formats line-fold and
 * property-parse identically).
 *
 * **Why in-house, not a third-party parser.** The suite's GitHub-installable
 * rule requires a SELF-CONTAINED committed `dist/` that installs under
 * `ignore-scripts=true` with no build step. A third-party iCal parser
 * (`ical.js`, `node-ical`, `vcf`) would have to be esbuild-INLINED into `dist/`
 * to satisfy that — pulling its whole (RRULE-expansion / timezone-database)
 * surface into the audit. This bridge does NOT expand recurrences in phase 1
 * (it carries the raw `RRULE` string), so it needs only the line/property/param
 * grammar — a small, exhaustively-testable parser. Keeping it in-house shrinks
 * the reviewable + installable surface to exactly what we use, with no inlined
 * dependency. (If full RRULE expansion is added later, revisit whether `ical.js`
 * — esbuild-inlined — then earns its place; tracked as a follow-up.)
 *
 * Every input is treated as UNTRUSTED: the parser never throws on malformed
 * lines (a line without a `:` is skipped), and it imposes hard caps on line
 * length, line count and total size so a hostile file cannot exhaust memory.
 */
/** A parsed content line: `[group "."] NAME;param=value:VALUE`. */
export interface ContentLine {
    /**
     * The property name, upper-cased and with any vCard property-group prefix
     * stripped (e.g. `SUMMARY`, `DTSTART`; `item1.EMAIL` → `EMAIL`). RFC 6350 §3.3
     * lets a vCard property carry a `group "."` prefix (iCloud/macOS emit
     * `item1.EMAIL`, `item1.X-ABLabel`, …); the bare property name is what callers
     * look up, so the prefix is moved to {@link group} rather than kept in the name
     * (which would otherwise silently hide grouped EMAIL/TEL/URL fields).
     */
    readonly name: string;
    /** The vCard property group (the part before the `.`), upper-cased, if any. */
    readonly group?: string;
    /** Parameters, names upper-cased; a multi-valued param keeps the raw comma string. */
    readonly params: Record<string, string>;
    /** The raw (still-escaped) property value text. */
    readonly value: string;
}
/** A parsed component (`BEGIN:VEVENT` … `END:VEVENT`), possibly nested. */
export interface Component {
    /** The component name, upper-cased (e.g. `VEVENT`, `VCARD`, `VCALENDAR`). */
    readonly name: string;
    /** Direct property lines of this component (not those of sub-components). */
    readonly properties: ContentLine[];
    /** Nested sub-components. */
    readonly components: Component[];
}
/**
 * Unfold RFC 5545 §3.1 / RFC 6350 §3.2 folded lines: a CRLF (or bare LF/CR)
 * followed by a single space or HTAB continues the previous logical line; the
 * leading whitespace is removed. Returns logical lines (empty lines dropped).
 *
 * Bounded by {@link MAX_LINES}; an over-long single logical line is truncated to
 * {@link MAX_LINE_LENGTH} (it cannot grow unboundedly via folds).
 */
export declare function unfoldLines(text: string): string[];
/**
 * Parse a single unfolded content line into {@link ContentLine}, or `undefined`
 * if it is malformed (no `:` separating name+params from value). UNTRUSTED:
 * never throws.
 *
 * Grammar: `name *(";" param ) ":" value`, where a param is `pname "=" pvalue`
 * and a quoted pvalue (`"..."`) may contain `:`/`;`/`,`. We scan to the first
 * UNQUOTED `:` to split off the value.
 */
export declare function parseContentLine(line: string): ContentLine | undefined;
/**
 * Unescape an iCalendar TEXT value (RFC 5545 §3.3.11): `\\n`/`\\N` → newline,
 * `\\,` → `,`, `\\;` → `;`, `\\\\` → `\\`. vCard (RFC 6350 §3.4) uses the same
 * escaping for TEXT. Done in a single left-to-right pass so an escaped backslash
 * is not re-interpreted.
 */
export declare function unescapeText(value: string): string;
/**
 * Parse a full iCalendar / vCard text into a tree of {@link Component}s.
 *
 * Handles nested `BEGIN:<name>` / `END:<name>` blocks (a VCALENDAR holding
 * VEVENTs; a stream of VCARDs). UNTRUSTED input: it never throws — a stray
 * `END` with no matching `BEGIN`, or a malformed line, is ignored; nesting is
 * capped at {@link MAX_NESTING}; total text is capped at {@link MAX_TOTAL_BYTES}.
 * Returns the TOP-LEVEL components (a VCALENDAR, or a flat list of VCARDs).
 */
export declare function parseComponents(text: string): Component[];
/**
 * Collect every component named `name` (case-insensitive) anywhere in the tree,
 * depth-first. Used to pull VEVENTs out of a VCALENDAR and VCARDs out of a
 * stream, without caring about the wrapper depth.
 */
export declare function findComponents(roots: Component[], name: string): Component[];
/** The first property line named `name` (case-insensitive) of a component, or `undefined`. */
export declare function getProperty(component: Component, name: string): ContentLine | undefined;
/** Every property line named `name` (case-insensitive) of a component. */
export declare function getProperties(component: Component, name: string): ContentLine[];
//# sourceMappingURL=ical.d.ts.map