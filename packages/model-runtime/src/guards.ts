// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6
/**
 * The guard inventory — the single audited home for the untrusted-input filters
 * that the six hand-written `@jeswr` data-model packages each duplicated. Every
 * generated model interprets a manifest through these; no generated artifact
 * carries any of this logic itself (the data-not-code invariant, design §7.1).
 *
 * **Pure core, no platform.** This module depends only on the WHATWG `URL`
 * global (available in both Node and the browser) — no `node:*`, no DOM, no RDF
 * machinery — so it is client-safe and reads as a small spec.
 *
 * The `httpIriOrUndefined` / `isHttpIri` pair is the **injection-safe LEXICAL**
 * IRI filter: it retains solid-bookmark's `URL.href` canonicalisation for parity,
 * then rejects any remaining IRIREF-forbidden characters before a NamedNode is
 * emitted. rdf-serialize instead escapes the lexical input and preserves identity;
 * the composite graph-walk validates lexical safety and follows the exact linked term.
 */

/** True when an IRI contains bytes unsafe in a Turtle IRIREF. */
export function hasForbiddenIriCharacters(value: string): boolean {
  for (const ch of value) {
    const c = ch.codePointAt(0) as number;
    if (c <= 0x20 || (c >= 0x7f && c <= 0x9f) || '<>"{}|^`\\'.includes(ch)) return true;
  }
  return false;
}

/** Absolute, lexical IRI safety; never rewrites RDF identity. */
export function isSafeAbsoluteIri(value: unknown): value is string {
  if (typeof value !== "string" || hasForbiddenIriCharacters(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// Turtle 1.1 PN_CHARS_BASE and the additional PN_CHARS characters. Match code
// points, including the grammar's astral range, rather than JavaScript \w.
const PN_CHARS_BASE =
  /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]$/u;
// biome-ignore lint/suspicious/noMisleadingCharacterClass: the Turtle grammar explicitly permits these individual combining code points.
const PN_CHARS_EXTRA = /^[_0-9\-\u00B7\u0300-\u036F\u203F-\u2040]$/u;

/** Turtle PN_PREFIX, or the empty label of a default prefix. */
export function isTurtlePrefixName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let first = true;
  let last = "";
  for (const ch of value) {
    if (
      first
        ? !PN_CHARS_BASE.test(ch)
        : ch !== "." && !PN_CHARS_BASE.test(ch) && !PN_CHARS_EXTRA.test(ch)
    )
      return false;
    first = false;
    last = ch;
  }
  return last !== ".";
}

/** Turtle BLANK_NODE_LABEL, excluding the `_:` introducer. */
export function isTurtleBlankNodeLabel(value: string): boolean {
  if (value === "") return false;
  let first = true;
  let last = "";
  for (const ch of value) {
    if (
      first
        ? !PN_CHARS_BASE.test(ch) && !/^[_0-9]$/.test(ch)
        : ch !== "." && !PN_CHARS_BASE.test(ch) && !PN_CHARS_EXTRA.test(ch)
    )
      return false;
    first = false;
    last = ch;
  }
  return last !== ".";
}

/** XML 1.0 Name/NCName/Nmtoken productions used by the XSD string family. */
export function isXsdName(value: string, kind: "Name" | "NCName" | "NMTOKEN"): boolean {
  if (!value) return false;
  let first = true;
  for (const ch of value) {
    const start = PN_CHARS_BASE.test(ch) || ch === "_" || (kind !== "NCName" && ch === ":");
    if (!start && ((first && kind !== "NMTOKEN") || (ch !== "." && !PN_CHARS_EXTRA.test(ch))))
      return false;
    first = false;
  }
  return true;
}

/** Validate both the resource and its derived subject, preserving lexical identity. */
export function subjectIri(resourceUrl: string, fragment?: string): string {
  if (!isSafeAbsoluteIri(resourceUrl))
    throw new TypeError("resource URL must be a safe absolute IRI");
  const subject = fragment === undefined ? resourceUrl : `${resourceUrl}#${fragment}`;
  if (!isSafeAbsoluteIri(subject)) throw new TypeError("subject must be a safe absolute IRI");
  return subject;
}

/**
 * The **canonical** absolute http(s) IRI for `value`, else `undefined` — the
 * recurring untrusted-input filter for an object-property value (drop a
 * non-http(s) value rather than coerce it into a malformed `NamedNode`). This is
 * the single canonicalization primitive; {@link isHttpIri} is defined in terms of
 * it so the boolean guard and the value filter can never disagree.
 *
 * Returns the parsed `URL.href`, NOT the raw input. This matters because WHATWG
 * `new URL()` TOLERATES (and strips) leading/trailing C0-control + space
 * characters and some tab/newline noise — so `"  https://x.org/a  "` and
 * `"https://x.org/a\n"` parse "OK" but the RAW string contains whitespace illegal
 * inside an RDF IRI. Returning `u.href` writes only the normalized, well-formed
 * IRI, so a hostile / sloppy input can never land an invalid `NamedNode` with
 * embedded whitespace on the wire.
 */
export function httpIriOrUndefined(value: unknown): string | undefined {
  // A non-string is dropped fail-closed: `new URL()` would otherwise STRINGIFY an
  // object (via its `toString`), so a hostile non-string could be coerced into a
  // NamedNode. Only a genuine string may become an IRI.
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return hasForbiddenIriCharacters(u.href) ? undefined : u.href;
  } catch {
    return undefined;
  }
}

/**
 * True for an absolute `http(s)` URL that is ALREADY in its canonical form —
 * i.e. {@link httpIriOrUndefined}`(value) === value`. A narrowing type guard so
 * callers can use it in a `?:` without a cast.
 *
 * **Canonical-consistent (not just "parseable").** A value that WHATWG `URL`
 * normalizes — e.g. one with leading/trailing whitespace or control characters,
 * or `http://x.org` (no trailing slash) which `URL` rewrites to `http://x.org/`
 * — returns `false` here, because the RAW string is NOT a well-formed RDF IRI
 * that should be written verbatim. This keeps the boolean guard and the
 * value-returning {@link httpIriOrUndefined} in lock-step: `isHttpIri(v)` is true
 * exactly when `v` may be written through unchanged. Pod data is untrusted input
 * (a `javascript:`/`data:` URL is a stored-XSS / open surface); when you need the
 * usable, normalized value, prefer {@link httpIriOrUndefined}.
 */
export function isHttpIri(value: string | undefined): value is string {
  return value !== undefined && httpIriOrUndefined(value) === value;
}

// C0/C1 control characters, EXCEPT the legal literal whitespace tab (0x09),
// line feed (0x0A) and carriage return (0x0D) which are preserved.
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching C0/C1 controls to strip them.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Strip C0/C1 control characters from an untrusted text literal that is about to
 * be written to RDF — a stored-XSS / log-injection / Turtle-noise guard applied
 * to every text write by default. `\t` (0x09), `\n` (0x0A) and `\r` (0x0D) are
 * PRESERVED (they are legal, meaningful whitespace inside a literal — markdown
 * notes, multi-line descriptions); every other C0 char (0x00–0x1F) and every C1
 * char (0x7F–0x9F) is removed. Returns the value unchanged when it is already
 * clean, so a well-formed literal round-trips byte-for-byte.
 */
export function sanitizeText(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

/**
 * Run a term→value read and fail CLOSED: if the read throws (a malformed literal
 * in untrusted pod data — e.g. an `xsd:boolean` typed accessor over a literal
 * whose lexical value is not a boolean), the field is DROPPED (returns
 * `undefined`) rather than aborting the whole parse. This is the per-predicate
 * `tryRead` isolation the hand-written packages each re-implemented.
 */
export function tryRead<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
