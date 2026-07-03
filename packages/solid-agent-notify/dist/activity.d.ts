/**
 * activity.ts — the typed ActivityStreams 2.0 (AS2.0) notification model + a
 * Turtle serialiser, built via TYPED `@rdfjs/wrapper` accessors and an n3 `Store`
 * (house rule: never hand-concat / hand-build RDF triples).
 *
 * The plain {@link ActivityNotification} shape is what callers build (no RDF
 * terms); {@link buildActivity} turns it into an n3 `Store`; {@link ActivityDoc}
 * is the typed view used both to write (send) and read (inbox parse).
 */
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
/** AS2.0 activity verbs this package emits. (Reads accept any `as:*` type.) */
export type ActivityType = "Announce" | "Invite" | "Offer" | "Create" | "Update" | "Add" | "Remove";
/** The plain shape of a notification (no RDF terms) callers build / consume. */
export interface ActivityNotification {
    /** `as:type` — the activity verb (defaults to `Announce` on send). */
    type: ActivityType;
    /** `as:actor` — the sender's WebID. */
    actor: string;
    /** `as:object` — an IRI the activity is about (e.g. a chat container, a poll). */
    object?: string;
    /** `as:target` — an IRI the activity targets. */
    target?: string;
    /** `as:summary` — a short human-readable line. */
    summary?: string;
    /** `as:content` — a longer human-readable body. */
    content?: string;
    /** `as:published` — when it was sent (defaults to now on send). */
    published?: Date;
}
/** True for an absolute http(s) URL usable as an AS2.0 IRI object/actor/target. */
export declare function isHttpIri(value: string | undefined): boolean;
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
export declare function escapeIri(value: string): string;
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
export declare function safeHttpIri(value: string | undefined): string | undefined;
/** Typed `@rdfjs/wrapper` view of a single AS2.0 activity subject (read + write). */
export declare class ActivityDoc extends TermWrapper {
    get types(): Set<string>;
    setType(t: ActivityType): this;
    /** `as:actor` — sender WebID (object property). */
    get actor(): string | undefined;
    set actor(v: string | undefined);
    /**
     * `as:object` — an IRI the activity is about. Named `activityObject` (not
     * `object`) because `TermWrapper` already defines an `object` term getter.
     */
    get activityObject(): string | undefined;
    set activityObject(v: string | undefined);
    get target(): string | undefined;
    set target(v: string | undefined);
    get summary(): string | undefined;
    set summary(v: string | undefined);
    get content(): string | undefined;
    set content(v: string | undefined);
    get published(): Date | undefined;
    set published(v: Date | undefined);
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
export declare function buildActivity(notification: ActivityNotification, subject?: string): Store;
/** Serialise an n3 Store to Turtle with the `as:` prefix. */
export declare function serializeTurtle(store: Store): Promise<string>;
//# sourceMappingURL=activity.d.ts.map