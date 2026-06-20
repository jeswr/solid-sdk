// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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

/** Hard limits — a hostile file must not be able to exhaust memory. */
const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MiB of text
const MAX_LINES = 200_000; // unfolded logical lines
const MAX_LINE_LENGTH = 1_000_000; // one (unfolded) logical line, chars
const MAX_NESTING = 20; // BEGIN/END depth

/**
 * Unfold RFC 5545 §3.1 / RFC 6350 §3.2 folded lines: a CRLF (or bare LF/CR)
 * followed by a single space or HTAB continues the previous logical line; the
 * leading whitespace is removed. Returns logical lines (empty lines dropped).
 *
 * Bounded by {@link MAX_LINES}; an over-long single logical line is truncated to
 * {@link MAX_LINE_LENGTH} (it cannot grow unboundedly via folds).
 */
export function unfoldLines(text: string): string[] {
  // Normalise all newline conventions to \n, then split. We do NOT split on the
  // fold whitespace; instead we re-join a line that the NEXT physical line
  // continues. RFC 5545 folds with CRLF + (SP | HTAB).
  const physical = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const raw of physical) {
    if (out.length >= MAX_LINES) break;
    // A continuation line starts with a single SPACE or HTAB.
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
      const prev = out[out.length - 1] ?? "";
      const joined = prev + raw.slice(1);
      out[out.length - 1] =
        joined.length > MAX_LINE_LENGTH ? joined.slice(0, MAX_LINE_LENGTH) : joined;
      continue;
    }
    if (raw.length === 0) continue;
    out.push(raw.length > MAX_LINE_LENGTH ? raw.slice(0, MAX_LINE_LENGTH) : raw);
  }
  return out;
}

/**
 * Parse a single unfolded content line into {@link ContentLine}, or `undefined`
 * if it is malformed (no `:` separating name+params from value). UNTRUSTED:
 * never throws.
 *
 * Grammar: `name *(";" param ) ":" value`, where a param is `pname "=" pvalue`
 * and a quoted pvalue (`"..."`) may contain `:`/`;`/`,`. We scan to the first
 * UNQUOTED `:` to split off the value.
 */
export function parseContentLine(line: string): ContentLine | undefined {
  // Find the first unquoted ':' — that separates the name+params from the value.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return undefined;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  // Split the head into name + params on UNQUOTED ';'.
  const parts: string[] = [];
  let buf = "";
  inQuote = false;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (ch === '"') {
      inQuote = !inQuote;
      buf += ch;
    } else if (ch === ";" && !inQuote) {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  parts.push(buf);

  let name = (parts[0] ?? "").trim().toUpperCase();
  if (name.length === 0) return undefined;

  // RFC 6350 §3.3: a vCard property may carry a `group "."` prefix (e.g.
  // `item1.EMAIL`). The group is a 1*(ALPHA/DIGIT/"-") token; if the name
  // contains a `.`, split off the LAST segment as the bare property name and
  // keep the prefix as the group. (BEGIN/END/VERSION never carry a group, and a
  // value like a URL never reaches here because the value is after the colon.)
  let group: string | undefined;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    const candidateGroup = name.slice(0, dot);
    const bareName = name.slice(dot + 1);
    // Only treat it as a group prefix if the group token is the vCard group
    // grammar (ALPHA/DIGIT/"-") and the bare name is a plausible property token.
    if (/^[A-Z0-9-]+$/.test(candidateGroup) && /^[A-Z0-9-]+$/.test(bareName)) {
      group = candidateGroup;
      name = bareName;
    }
  }

  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i] ?? "";
    const eq = p.indexOf("=");
    if (eq < 0) continue; // malformed param — skip, do not throw
    const pname = p.slice(0, eq).trim().toUpperCase();
    let pvalue = p.slice(eq + 1).trim();
    // Strip surrounding DQUOTEs from a quoted param value.
    if (pvalue.startsWith('"') && pvalue.endsWith('"') && pvalue.length >= 2) {
      pvalue = pvalue.slice(1, -1);
    }
    if (pname.length > 0) params[pname] = pvalue;
  }

  return group !== undefined ? { name, group, params, value } : { name, params, value };
}

/**
 * Unescape an iCalendar TEXT value (RFC 5545 §3.3.11): `\\n`/`\\N` → newline,
 * `\\,` → `,`, `\\;` → `;`, `\\\\` → `\\`. vCard (RFC 6350 §3.4) uses the same
 * escaping for TEXT. Done in a single left-to-right pass so an escaped backslash
 * is not re-interpreted.
 */
export function unescapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === "n" || next === "N") {
        out += "\n";
        i++;
      } else if (next === "," || next === ";" || next === "\\") {
        out += next;
        i++;
      } else {
        out += ch;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Parse a full iCalendar / vCard text into a tree of {@link Component}s.
 *
 * Handles nested `BEGIN:<name>` / `END:<name>` blocks (a VCALENDAR holding
 * VEVENTs; a stream of VCARDs). UNTRUSTED input: it never throws — a stray
 * `END` with no matching `BEGIN`, or a malformed line, is ignored; nesting is
 * capped at {@link MAX_NESTING}; total text is capped at {@link MAX_TOTAL_BYTES}.
 * Returns the TOP-LEVEL components (a VCALENDAR, or a flat list of VCARDs).
 */
export function parseComponents(text: string): Component[] {
  // Cap total size by ENCODED utf-8 bytes (not utf-16 code units), so a
  // multi-byte payload cannot slip past the byte-named cap.
  if (new TextEncoder().encode(text).length > MAX_TOTAL_BYTES) {
    text = text.slice(0, MAX_TOTAL_BYTES);
  }
  const lines = unfoldLines(text);

  const top: Component[] = [];
  // A mutable component frame used while building (properties/components are
  // pushed in place, then frozen into the readonly Component shape on END).
  type Frame = { name: string; properties: ContentLine[]; components: Component[] };
  const stack: Frame[] = [];

  for (const line of lines) {
    const parsed = parseContentLine(line);
    if (!parsed) continue;

    if (parsed.name === "BEGIN") {
      if (stack.length >= MAX_NESTING) continue; // refuse to nest deeper
      const compName = parsed.value.trim().toUpperCase();
      if (compName.length === 0) continue;
      stack.push({ name: compName, properties: [], components: [] });
      continue;
    }

    if (parsed.name === "END") {
      const closing = parsed.value.trim().toUpperCase();
      const current = stack[stack.length - 1];
      // Ignore an END that doesn't match the open frame (malformed input).
      if (!current || current.name !== closing) continue;
      stack.pop();
      const finished: Component = {
        name: current.name,
        properties: current.properties,
        components: current.components,
      };
      const parent = stack[stack.length - 1];
      if (parent) parent.components.push(finished);
      else top.push(finished);
      continue;
    }

    // A normal property line — attach to the current open frame, if any.
    const current = stack[stack.length - 1];
    if (current) current.properties.push(parsed);
    // A property outside any BEGIN/END is dropped (nothing to attach it to).
  }

  // Any frames still open at EOF (missing END) are dropped — we only return
  // properly-closed components, which keeps a truncated/hostile file from
  // yielding a half-built event.
  return top;
}

/**
 * Collect every component named `name` (case-insensitive) anywhere in the tree,
 * depth-first. Used to pull VEVENTs out of a VCALENDAR and VCARDs out of a
 * stream, without caring about the wrapper depth.
 */
export function findComponents(roots: Component[], name: string): Component[] {
  const target = name.toUpperCase();
  const out: Component[] = [];
  const walk = (c: Component): void => {
    if (c.name === target) out.push(c);
    for (const child of c.components) walk(child);
  };
  for (const r of roots) walk(r);
  return out;
}

/** The first property line named `name` (case-insensitive) of a component, or `undefined`. */
export function getProperty(component: Component, name: string): ContentLine | undefined {
  const target = name.toUpperCase();
  return component.properties.find((p) => p.name === target);
}

/** Every property line named `name` (case-insensitive) of a component. */
export function getProperties(component: Component, name: string): ContentLine[] {
  const target = name.toUpperCase();
  return component.properties.filter((p) => p.name === target);
}
