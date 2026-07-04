/**
 * granary AS2 object → canonical {@link CanonicalMessage} mapping.
 *
 * The MAP is near-free because granary already emits ActivityStreams 2.0 — the
 * suite's canonical write vocabulary (exactly what `@jeswr/pod-chat` /
 * `@jeswr/solid-chat-interop` speak). This module reads the granary JSON fields
 * (which the suite RDF parser does not natively project — object-valued
 * `attributedTo`/`inReplyTo`, `contentMap`, an outer activity envelope) onto the
 * canonical model, sanitising EVERY imported IRI through {@link safeHttpIri}
 * (http(s)-only AND injection-escaped — a `javascript:`/`mailto:`/`urn:`/bare-string
 * value is DROPPED, and an injection-bearing `https://…> . <…>` value has its
 * IRIREF-forbidden characters percent-encoded LEXICALLY so it can never break out
 * of an `n3.Writer` IRIREF, while its RDF identity is preserved byte-for-byte) and
 * EVERY imported date through a parse-and-validate guard (garbage dropped, never fatal).
 *
 * It maps granary's social-post fields to PROV-O provenance so an imported post
 * lands as the SAME shape native chat uses, with HONEST attribution:
 *  - `attributedTo`/`actor` → `author` (a human/actor WebID/IRI) AND, since the
 *    post is IMPORTED rather than authored in the pod, the source author also
 *    becomes `provenance.attributedTo`;
 *  - `url`/`id` → `provenance.derivedFrom` (the source permalink the post came from).
 *
 * The output is a plain serialisable {@link CanonicalMessage}; the RDF WRITE is done
 * by `@jeswr/solid-chat-interop`'s typed-accessor serialisers — this module builds
 * NO triples.
 */
import type { CanonicalMessage } from "@jeswr/solid-chat-interop";
import type { GranaryActorRef, GranaryAs2Object, GranaryObjectRef } from "./granary.js";
/**
 * The SAFE, injection-proof http(s) IRI guard for UNTRUSTED input — re-exported
 * unchanged from `@jeswr/rdf-serialize` (the suite's ONE audited implementation,
 * distilled from ~40 cumulative adversarial review rounds across six hand-copied
 * variants — this repo's former local copy among them).
 *
 * WHY IT EXISTS (a HIGH the plain `safeIri` http(s)-only filter does NOT close).
 * granary maps untrusted social-network output, and every IRI here becomes an RDF
 * `NamedNode` ultimately serialised by `n3.Writer`. **`n3.Writer` does NOT escape
 * IRIs** — it emits `<value>` verbatim. So a boolean "is this http(s)?" filter is
 * INSUFFICIENT: a hostile `attributedTo`/`id`/`url`/`inReplyTo` value such as
 * `https://e.org/x> . <https://victim/#me> <…#oidcIssuer> <https://attacker/`
 * still *passes* an http(s) check (`new URL()` accepts it) yet, written raw as
 * `<…x> . <victim> <oidcIssuer> <attacker> …>`, BREAKS OUT of the `<…>` IRIREF and
 * INJECTS ARBITRARY TRIPLES into the pod — a forged `solid:oidcIssuer` on the
 * owner's WebID is account-takeover. (Proved end-to-end through `ingestGranary`;
 * see `ingest.test.ts`.)
 *
 * The canonical guard escapes the FULL Turtle IRIREF-forbidden set — `<` `>` `"`
 * `{` `}` `|` `^` `` ` `` `\` and every C0 control + SPACE — LEXICALLY (percent-
 * encoding those bytes before the value ever reaches `namedNode`), then validates
 * http(s) scheme + a non-empty authority. It returns the ESCAPED LEXICAL value,
 * NOT `new URL().href`: RDF identity is lexical, so host case, an explicit `:443`,
 * dot-segments and a present/absent trailing slash are preserved byte-for-byte
 * rather than silently canonicalised into a different NamedNode. A non-string, a
 * `javascript:`/`mailto:`/`urn:`/bare-string value, or one wrapped in a
 * leading/trailing control-or-space is DROPPED (`undefined`).
 */
export { safeHttpIri } from "@jeswr/rdf-serialize";
/**
 * Resolve an AS2 actor/object reference (string | { id?, url? } | array) to a
 * single SAFE, injection-escaped http(s) IRI, or `undefined`. Prefers the first element
 * of an array, then `id`, then the first `url`. Every candidate is run through
 * {@link safeHttpIri} so a non-http(s) value is dropped and an injection-bearing one
 * is IRIREF-escaped (never coerced raw into a `NamedNode`).
 */
export declare function refToIri(ref: GranaryActorRef | GranaryObjectRef | (GranaryActorRef | GranaryObjectRef)[] | undefined): string | undefined;
/**
 * Serialise an UNTRUSTED imported date string to ISO-8601, or `undefined` if it is
 * absent / not a string / unparseable. A garbage `published` is DROPPED — never
 * fatal and never coerced (mirrors solid-chat-interop's `toIsoOrUndefined`).
 */
export declare function importedDate(value: unknown): string | undefined;
/**
 * Map a single granary AS2 object to a {@link CanonicalMessage}.
 *
 * Untrusted-input discipline throughout: a wrong-typed field is ignored; every
 * IRI-valued field is {@link safeHttpIri}-escaped; every date is parse-validated. `content`
 * falls back to the first `contentMap` value then to the empty string. The source
 * post's author + permalink are recorded as PROV-O provenance so the imported
 * message carries honest "where this came from" attribution.
 */
export declare function granaryObjectToCanonical(obj: GranaryAs2Object): CanonicalMessage;
//# sourceMappingURL=map.d.ts.map