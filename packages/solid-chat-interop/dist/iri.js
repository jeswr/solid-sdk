// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// The IRI-safety guards below now DELEGATE to @jeswr/rdf-serialize (Fable 5) —
// see the "Consolidated" note below. The retained text/date helpers are Opus 4.8.
/**
 * Pure IRI + text helpers — the ONE reviewed home for the small, total
 * predicates the reconciler and the adapter share.
 *
 * **Consolidated (bead suite-tracker-olt0).** The injection-safe IRI guards
 * (`isHttpIri` / `safeHttpIri` / `escapeIri`) were formerly a hand-copied variant
 * of the suite's untrusted-IRI filter. They now re-export the ONE audited
 * implementation from `@jeswr/rdf-serialize` (`src/iri.ts`), so this package
 * carries no divergent copy. The re-exports preserve this module's public API —
 * `./iri.js` remains the single import site for the reconciler + adapter.
 *
 * **Semantic note — LEXICAL, not canonicalising.** The previous local
 * `safeHttpIri` returned `new URL(v).href` (adding a trailing slash, lower-casing
 * the host, dropping a default port) then encoded residual forbidden bytes. The
 * canonical replacement is purely LEXICAL: it percent-encodes the Turtle-`IRIREF`
 * forbidden set and otherwise preserves the value byte-for-byte, and REJECTS a
 * value with a leading/trailing control-or-space rather than letting the URL
 * parser silently strip it. This is deliberate — RDF identity is lexical, so a
 * `NamedNode` must carry the caller's value, not a silently-canonicalised one. No
 * call site in this package depends on the old canonicalisation: the only
 * derived-URL mint (the LibreChat `resolveId` base-resolution) canonicalises
 * explicitly via `new URL`, not via this guard.
 *
 * **Pure core, no platform.** The retained helpers depend only on the WHATWG
 * `URL` global (Node + browser) — no `node:*`, no DOM, no RDF/`n3` machinery — so
 * this module stays client-safe.
 */
// The canonical, audited IRI-safety guards. `escapeIri` — lexical percent-encode
// of the forbidden set; `safeHttpIri` — the http(s)-only untrusted-IRI guard;
// `isHttpIri` — the lexical safety predicate. NB: we deliberately do NOT import the
// canonical scheme-agnostic `safeIri` — this package's `safeIri` is http(s)-ONLY
// (see the alias below).
import { escapeIri, isHttpIri, safeHttpIri } from "@jeswr/rdf-serialize";
// Re-export the canonical guards so `./iri.js` stays the single import site for
// the reconciler + the adapter (no divergent local copy).
export { escapeIri, isHttpIri, safeHttpIri };
/**
 * The injection-safe http(s) IRI for an untrusted value, else `undefined` — the
 * recurring untrusted-input filter for an OPTIONAL object-property write (drop a
 * non-http(s) value rather than coerce it into a malformed `NamedNode`, and
 * percent-escape an http(s) value so no IRI-injection character survives into
 * `n3.Writer`). A thin, http(s)-only alias of the canonical {@link safeHttpIri};
 * named separately so the write sites read as a "drop or keep" filter.
 */
export function httpIriOrUndefined(value) {
    return safeHttpIri(value);
}
/**
 * HTTP(S)-ONLY safe-IRI alias — historically this package's `safeIri`.
 *
 * ⚠️ NAME-COLLISION HAZARD: the canonical `@jeswr/rdf-serialize` `safeIri` is
 * SCHEME-AGNOSTIC (it accepts `urn:` / `did:` / `mailto:` / …). This package's
 * `safeIri` has ALWAYS been http(s)-only, so it is deliberately aliased to the
 * canonical {@link safeHttpIri} — NOT the canonical `safeIri`. Rewiring it to the
 * scheme-agnostic canonical `safeIri` would be a SECURITY REGRESSION (foreign
 * `urn:` / non-http object values would start being accepted as IRIs). Kept for
 * API stability; prefer {@link safeHttpIri} at new call sites.
 */
export const safeIri = safeHttpIri;
/**
 * Characters STRIPPED from an untrusted text literal before it is written into a
 * pod resource: the C0/C1 control range, EXCLUDING tab (`\t`), line feed (`\n`)
 * and carriage return (`\r`), which are legitimate in a multi-line chat body and
 * are safely escaped by `n3.Writer`. The remaining controls — NUL, `ESC`
 * (`0x1B`), `DEL`, the C1 block (`0x80`–`0x9F`), … — are a smuggling / terminal-
 * escape vector, and `n3.Writer` emits several of them RAW (unescaped) into the
 * Turtle literal (verified: `0x1A`–`0x1F`, `0x7F`–`0x9F`). Strip them so an
 * untrusted body/title can never carry a control-sequence payload into the
 * serialised resource.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — we strip the control range from untrusted text before it is persisted.
const TEXT_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/**
 * Sanitise an untrusted text literal (a chat body / title / media type) destined
 * for a pod resource by stripping smuggling-prone control characters
 * ({@link TEXT_CONTROL_CHARS}). Bodies are stored as PLAIN TEXT literals only —
 * this keeps a hostile foreign message from persisting a raw `ESC`/`DEL`/C1
 * control sequence into the serialised RDF. `undefined` passes through unchanged
 * so an optional field stays absent.
 */
export function sanitizeText(value) {
    return (value === undefined ? undefined : value.replace(TEXT_CONTROL_CHARS, ""));
}
/**
 * Serialise an UNTRUSTED date to an ISO-8601 string, or `undefined` if it is
 * absent or invalid. A `Date` parsed from a malformed RDF literal (e.g.
 * `as:published "not-a-date"`) is an `Invalid Date`, and `Invalid Date.toISOString()`
 * THROWS (RangeError) — which would abort the whole parse instead of dropping the
 * bad field like we drop non-http IRIs. Funnel every read→canonical date through
 * this so a hostile/garbage date literal is filtered, never fatal. (Mirrors the
 * existing `Number.isNaN(d.getTime())` guard in the LibreChat adapter.)
 */
export function toIsoOrUndefined(d) {
    return d !== undefined && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined;
}
/**
 * Guard a single typed `@rdfjs/wrapper` read against a malformed-term THROW,
 * returning `undefined` on absence OR malformation. The `LiteralAs.*` /
 * `NamedNodeAs.*` mappings THROW on an untrusted RDF term of the wrong
 * datatype/kind — `LiteralAs.date`/`LiteralAs.string` raise `LiteralDatatypeError`
 * for a literal whose datatype is not the expected one, and `NamedNodeAs.string`
 * raises for a term that is a Literal where a NamedNode was expected. A foreign
 * chat document is UNTRUSTED input, so such a throw must never abort the whole
 * parse: pass each predicate read as a thunk (`() => OptionalFrom.subjectPredicate(
 * this, P, As)`) and a bad value is dropped like a non-http IRI. Guarding PER
 * PREDICATE also stops a malformed preferred predicate in an `a ?? b` fallback
 * chain (e.g. a garbage `dct:created`) from masking a valid fallback (`as:published`).
 */
export function tryRead(read) {
    try {
        return read();
    }
    catch {
        return undefined;
    }
}
/**
 * Read an UNTRUSTED date-valued property off a `@rdfjs/wrapper` doc and serialise
 * it to ISO-8601, or `undefined` if it is absent or malformed. TWO failure modes
 * from a hostile/garbage RDF literal are both caught here:
 *  1. `@rdfjs/wrapper`'s `LiteralAs.date` mapping **THROWS** (`LiteralDatatypeError`)
 *     when the literal's datatype is not `xsd:date`/`xsd:dateTime` — e.g. a plain
 *     `as:published "not-a-date"` string literal — caught by {@link tryRead}; and
 *  2. a well-typed but garbage value parses to an `Invalid Date`, whose
 *     `.toISOString()` throws (`RangeError`) — handled by {@link toIsoOrUndefined}.
 * Pass the getter as a thunk (`() => doc.published`) so the read happens inside the
 * guard. A bad date literal is then DROPPED like a non-http IRI, never fatal to the
 * whole parse.
 */
export function readIsoDate(read) {
    return toIsoOrUndefined(tryRead(read));
}
/**
 * Strip the fragment from an IRI to get its document URL (e.g. the chat resource
 * a `#this` / `#it` message subject lives in). Throws on a non-parseable IRI (the
 * callers only ever pass an absolute subject IRI they minted, so a throw here is a
 * programmer error, not untrusted input).
 */
export function docOf(iri) {
    const u = new URL(iri);
    u.hash = "";
    return u.toString();
}
//# sourceMappingURL=iri.js.map