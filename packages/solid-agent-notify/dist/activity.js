// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * activity.ts — the typed ActivityStreams 2.0 (AS2.0) notification model + a
 * Turtle serialiser, built via TYPED `@rdfjs/wrapper` accessors and an n3 `Store`
 * (house rule: never hand-concat / hand-build RDF triples).
 *
 * The plain {@link ActivityNotification} shape is what callers build (no RDF
 * terms); {@link buildActivity} turns it into an n3 `Store`; {@link ActivityDoc}
 * is the typed view used both to write (send) and read (inbox parse).
 */
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { AS, RDF_TYPE } from "./config.js";
/** True for an absolute http(s) URL usable as an AS2.0 IRI object/actor/target. */
export function isHttpIri(value) {
    if (!value)
        return false;
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:";
    }
    catch {
        return false;
    }
}
/**
 * The characters Turtle's `IRIREF` production forbids inside `<…>` — the full
 * `[^#x00-#x20<>"{}|^`\] ` complement, i.e. every code point U+0000–U+0020
 * (controls incl. SPACE, handled numerically in {@link escapeIri}) plus the
 * NON-control set below. `n3.Writer` escapes none of these, so any that reach a
 * NamedNode's value are emitted VERBATIM and can terminate the `<…>`.
 */
const IRIREF_FORBIDDEN_CHARS = new Set(["<", ">", '"', "{", "}", "|", "^", "`", "\\"].map((c) => c.charCodeAt(0)));
/**
 * LEXICAL, scheme-agnostic escape for an IRI destined for ANY term position:
 * percent-encode EXACTLY the characters the Turtle IRIREF grammar forbids
 * (U+0000–U+0020 plus `< > " { } | ^ ` \`) and NOTHING else. A well-formed IRI —
 * which contains none of those — round-trips BYTE-FOR-BYTE unchanged (so default
 * ports, host case, dot-segments etc. are preserved; RDF identity is lexical),
 * while an injection payload (whose `>`, SPACE, `<`, `"` would break out of the
 * `<…>` delimiters) is rendered inert. Mirrors the `@jeswr/federation-registry`
 * `escapeIri` reference implementation.
 */
export function escapeIri(value) {
    let out = "";
    for (const ch of value) {
        const code = ch.codePointAt(0);
        if (code <= 0x20 || IRIREF_FORBIDDEN_CHARS.has(code)) {
            out += `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
        }
        else {
            out += ch;
        }
    }
    return out;
}
/**
 * Validate an untrusted string as a SAFE absolute http(s) IRI and return its
 * LEXICAL, Turtle-safe form, or `undefined` if it is not a safe http(s) IRI.
 *
 * SECURITY (Turtle IRI-injection). `n3.Writer` does NOT escape IRIs: a string fed
 * straight to `NamedNodeFrom.string` is emitted VERBATIM between `<…>`, so a raw
 * `>` / space / `<` breaks out of the IRI and injects attacker-chosen triples into
 * the serialised document — which this package then POSTs to a peer's LDN inbox.
 * `isHttpIri` only returns a boolean and the callers used to write the RAW value,
 * so a hostile actor/target/assignee field could smuggle triples into a victim's
 * inbox. Routing every WRITE-side IRI through this validator closes that.
 *
 * We validate STRUCTURE + SCHEME via the WHATWG `URL` parser, but return the
 * LEXICALLY-preserved input via {@link escapeIri} rather than `URL.href`, because
 * RDF identity is lexical: `.href` would silently canonicalise the IRI (drop a
 * default port, lowercase the host, collapse dot-segments) and change which
 * resource the triple is about. {@link escapeIri} touches only the IRIREF-forbidden
 * characters, so the result contains no `<…>`-terminating character yet denotes the
 * exact IRI the caller supplied.
 *
 * Values carrying a LEADING or TRAILING C0-control-or-space are REJECTED outright:
 * the WHATWG parser STRIPS those before parsing, so `" https://x"` would validate
 * as `https://x` while `escapeIri(" https://x")` would emit `%20https://x` — a
 * DIFFERENT, malformed IRI. Rejecting keeps the validated string and the emitted
 * string from ever diverging.
 */
export function safeHttpIri(value) {
    if (typeof value !== "string")
        return undefined;
    // WHATWG URL trims leading/trailing C0-controls-or-space (code point <= U+0020)
    // BEFORE parsing — reject such values so the parsed (trimmed) value can never
    // diverge from the escaped (untrimmed) value we emit. (Char-code check, not a
    // control-character regex, which the linter forbids.) Every trimmed byte is in
    // the BMP single-unit range, so `charCodeAt` is sufficient.
    const firstCode = value.charCodeAt(0);
    const lastCode = value.charCodeAt(value.length - 1);
    if (firstCode <= 0x20 || lastCode <= 0x20)
        return undefined;
    let u;
    try {
        u = new URL(value);
    }
    catch {
        return undefined;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:")
        return undefined;
    return escapeIri(value);
}
/**
 * A safe same-document `#`-fragment: starts with `#` and contains ONLY RFC 3987
 * `ifragment` characters that are NOT Turtle-IRIREF-forbidden (no space/control,
 * no `< > " { } | ^ ` \`). Such a fragment cannot break out of `<…>`, so it is a
 * safe relative activity subject (it resolves against the inbox-assigned document
 * IRI). The conventional default `#it` matches.
 */
const SAFE_FRAGMENT = /^#[A-Za-z0-9\-._~%!$&'()*+,;=:@/?]*$/;
/**
 * Validate the activity SUBJECT (fail-closed). Unlike the object-position IRIs
 * (actor/object/target — dropped when unsafe), the subject is the id of EVERY
 * emitted quad, so an unsafe subject silently corrupts the whole document. Accept
 * ONLY (a) the conventional relative `#it` default or another safe `#`-fragment,
 * or (b) an absolute http(s) IRI (returned in its lexical, escaped form). Anything
 * else THROWS — we never emit a subject that could break out of `<…>`.
 */
function safeSubjectIri(subject) {
    if (SAFE_FRAGMENT.test(subject))
        return subject;
    const safe = safeHttpIri(subject);
    if (safe === undefined) {
        throw new TypeError(`activity subject must be a safe '#'-fragment (e.g. the default '#it') or an absolute http(s) IRI: ${subject}`);
    }
    return safe;
}
/** Typed `@rdfjs/wrapper` view of a single AS2.0 activity subject (read + write). */
export class ActivityDoc extends TermWrapper {
    get types() {
        return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
    }
    setType(t) {
        this.types.add(`${AS}${t}`);
        return this;
    }
    /** `as:actor` — sender WebID (object property). */
    get actor() {
        return OptionalFrom.subjectPredicate(this, `${AS}actor`, NamedNodeAs.string);
    }
    set actor(v) {
        OptionalAs.object(this, `${AS}actor`, v, NamedNodeFrom.string);
    }
    /**
     * `as:object` — an IRI the activity is about. Named `activityObject` (not
     * `object`) because `TermWrapper` already defines an `object` term getter.
     */
    get activityObject() {
        return OptionalFrom.subjectPredicate(this, `${AS}object`, NamedNodeAs.string);
    }
    set activityObject(v) {
        OptionalAs.object(this, `${AS}object`, v, NamedNodeFrom.string);
    }
    get target() {
        return OptionalFrom.subjectPredicate(this, `${AS}target`, NamedNodeAs.string);
    }
    set target(v) {
        OptionalAs.object(this, `${AS}target`, v, NamedNodeFrom.string);
    }
    get summary() {
        return OptionalFrom.subjectPredicate(this, `${AS}summary`, LiteralAs.string);
    }
    set summary(v) {
        OptionalAs.object(this, `${AS}summary`, v, LiteralFrom.string);
    }
    get content() {
        return OptionalFrom.subjectPredicate(this, `${AS}content`, LiteralAs.string);
    }
    set content(v) {
        OptionalAs.object(this, `${AS}content`, v, LiteralFrom.string);
    }
    get published() {
        return OptionalFrom.subjectPredicate(this, `${AS}published`, LiteralAs.date);
    }
    set published(v) {
        OptionalAs.object(this, `${AS}published`, v, LiteralFrom.dateTime);
    }
}
/**
 * Build a fresh AS2.0 notification dataset rooted at the given subject (default
 * the relative `#it` — the inbox assigns the final IRI). Only http(s) IRIs are
 * written for actor/object/target (never coerce arbitrary text into a NamedNode).
 *
 * SECURITY (subject IRI-injection). The subject is the id of EVERY emitted quad,
 * so — unlike the object-position IRIs, which are dropped when unsafe — it MUST
 * fail closed: {@link safeSubjectIri} accepts only a safe `#`-fragment (the `#it`
 * default) or an absolute http(s) IRI (emitted in its lexical, escaped form) and
 * THROWS on anything that could break out of `<…>`.
 *
 * HOST-LEAK CARE: the payload carries only what the caller intended — the sender
 * WebID, optional object/target IRIs the caller explicitly supplies, a timestamp,
 * a type, and free-text summary/content. We never sweep in arbitrary internal pod
 * URLs, so a notification cannot exfiltrate private resource locations.
 *
 * @throws TypeError if `subject` is neither a safe `#`-fragment nor an http(s) IRI.
 */
export function buildActivity(notification, subject = "#it") {
    const store = new Store();
    const doc = new ActivityDoc(safeSubjectIri(subject), store, DataFactory).setType(notification.type);
    // Object-position IRIs: canonicalise (Turtle IRI-injection guard) and DROP the
    // triple when the value is not a safe http(s) IRI — never write a raw string.
    doc.actor = safeHttpIri(notification.actor);
    doc.activityObject = safeHttpIri(notification.object);
    doc.target = safeHttpIri(notification.target);
    doc.summary = notification.summary?.trim() || undefined;
    doc.content = notification.content?.trim() || undefined;
    doc.published = notification.published ?? new Date();
    return store;
}
/** Serialise an n3 Store to Turtle with the `as:` prefix. */
export function serializeTurtle(store) {
    return new Promise((resolve, reject) => {
        const writer = new Writer({ prefixes: { as: AS } });
        for (const quad of store)
            writer.addQuad(quad);
        writer.end((error, result) => {
            if (error)
                reject(error);
            else
                resolve(result);
        });
    });
}
//# sourceMappingURL=activity.js.map