/**
 * granary AS2 object → canonical {@link CanonicalMessage} mapping.
 *
 * The MAP is near-free because granary already emits ActivityStreams 2.0 — the
 * suite's canonical write vocabulary (exactly what `@jeswr/pod-chat` /
 * `@jeswr/solid-chat-interop` speak). This module reads the granary JSON fields
 * (which the suite RDF parser does not natively project — object-valued
 * `attributedTo`/`inReplyTo`, `contentMap`, an outer activity envelope) onto the
 * canonical model, sanitising EVERY imported IRI through
 * `@jeswr/solid-chat-interop`'s `safeIri` (http(s)-only — a `javascript:`/`mailto:`/
 * `urn:`/bare-string value is DROPPED, never coerced) and EVERY imported date
 * through a parse-and-validate guard (a garbage date is dropped, never fatal).
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
 * Resolve an AS2 actor/object reference (string | { id?, url? } | array) to a
 * single SAFE http(s) IRI, or `undefined`. Prefers the first element of an array,
 * then `id`, then the first `url`. Every candidate is run through `safeIri` so a
 * non-http(s) value is dropped.
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
 * IRI-valued field is `safeIri`-filtered; every date is parse-validated. `content`
 * falls back to the first `contentMap` value then to the empty string. The source
 * post's author + permalink are recorded as PROV-O provenance so the imported
 * message carries honest "where this came from" attribution.
 */
export declare function granaryObjectToCanonical(obj: GranaryAs2Object): CanonicalMessage;
//# sourceMappingURL=map.d.ts.map