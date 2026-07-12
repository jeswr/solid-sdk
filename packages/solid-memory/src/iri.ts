// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Pure IRI helpers — the ONE reviewed home for the small, total IRI predicates
 * the memory / store modules share.
 *
 * **Pure core, no platform.** This module depends only on the WHATWG `URL`
 * global (available in both Node and the browser) — no `node:*`, no DOM, no
 * RDF/`n3` machinery — so it is client-safe and can be read as a small spec.
 */

/**
 * The **canonicalised** value if it is an absolute http(s) IRI, else `undefined`
 * — the recurring untrusted-input filter for an OPTIONAL object-property write
 * (drop a non-http(s) value rather than coerce it into a malformed `NamedNode`).
 *
 * **Security — n3.Writer IRI-injection defence (load-bearing).** `n3.Writer`
 * does NOT escape IRIs: it emits an object IRI verbatim between `<…>`, so an
 * untrusted string containing `>` / a space / `< " { } | ^ \`` breaks out of the
 * IRI and injects arbitrary triples into the serialised graph. This helper is
 * the single chokepoint that neutralises that: it returns the **canonical form**
 * (`URL.href`, which percent-encodes `< > " SPACE` and strips control chars),
 * then percent-encodes the FULL residual set of Turtle-IRIREF-forbidden
 * characters the URL parser leaves intact in a query/fragment position
 * (`\ { } | ^ \``). The returned value therefore contains no character that can
 * escape an `<…>` term. Both the OPTIONAL object-property write sites AND the
 * set-valued `categories` sites (write + read) go through here, persisting the
 * canonicalised form of every http(s) value and dropping only genuinely
 * non-http(s) ones. ({@link isHttpIri} is the separate boolean SAFETY guard for
 * callers that only need a yes/no; it is not what the category sites use.)
 *
 * Values that are not absolute http(s) IRIs (e.g. `javascript:`, `mailto:`,
 * `urn:`, a bare string) return `undefined` so a caller never coerces one into a
 * malformed `NamedNode` nor surfaces it to a UI as a link.
 */
export function httpIriOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  // Canonicalise (percent-encodes < > " space, strips control chars) then
  // percent-encode the FULL Turtle-IRIREF-forbidden residual set the URL parser
  // leaves literal in a query/fragment position: \ { } | ^ ` (mirrors the
  // @jeswr/federation-registry escapeIri set). Encode `\` first so it cannot be
  // reintroduced by a later replacement.
  return u.href
    .replace(/\\/g, "%5C")
    .replace(/\{/g, "%7B")
    .replace(/\}/g, "%7D")
    .replace(/\|/g, "%7C")
    .replace(/\^/g, "%5E")
    .replace(/`/g, "%60");
}

/**
 * The raw characters forbidden inside a Turtle `IRIREF` (`<…>`): the control /
 * space range `U+0000–U+0020` plus `< > " { } | ^ \` \\`. Any of these written
 * verbatim by `n3.Writer` breaks out of the IRI term and injects triples — so a
 * string containing one is unsafe to write raw.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the U+0000–U+0020 IRIREF-forbidden range is the point.
const TURTLE_IRIREF_FORBIDDEN = /[\u0000-\u0020<>"{}|^`\\]/;

/**
 * A **safety** type guard: true for an absolute http(s) IRI that is safe to emit
 * verbatim in a Turtle `IRIREF` — i.e. one that carries NONE of the raw
 * {@link TURTLE_IRIREF_FORBIDDEN} characters. A narrowing guard so callers can
 * use it in a `?:` / `.filter()` without an extra cast.
 *
 * This is deliberately NOT canonical-equality: benign WHATWG canonicalisation
 * differences (a missing trailing slash, an upper-case host, a stripped default
 * port) do not make an IRI unsafe, so accepting them here avoids silently
 * DROPPING valid data. The injection defence is the forbidden-character
 * rejection: a value that passes contains no character that can escape an `<…>`
 * term. (Write sites that want to persist the normalised form use
 * {@link httpIriOrUndefined}, which percent-encodes rather than rejects.)
 */
export function isHttpIri(value: string | undefined): value is string {
  if (typeof value !== "string") return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return !TURTLE_IRIREF_FORBIDDEN.test(value);
}

/**
 * Strip the fragment from an IRI to get its document URL (e.g. the memory
 * document that a `#it` subject lives in). Throws on a non-parseable IRI (the
 * callers only ever pass an absolute subject IRI they minted, so a throw here is
 * a programmer error, not untrusted input).
 */
export function docOf(iri: string): string {
  const u = new URL(iri);
  u.hash = "";
  return u.toString();
}
