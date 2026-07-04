// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `@jeswr/solid-granary` — import granary social posts/feeds into a Solid pod.
 *
 * [granary](https://github.com/snarfed/granary) (CC0) converts FB / Instagram /
 * Twitter / Mastodon / Bluesky / Nostr / Farcaster / GitHub / Flickr + RSS / Atom /
 * JSON-Feed / mf2 into ActivityStreams 2.0 (`format=as2`). Because granary ALREADY
 * emits AS2 — exactly the vocabulary `@jeswr/solid-chat-interop` reconciles — this
 * package is a THIN adapter: granary AS2 (a single object or an AS2 Collection of
 * items) → the canonical {@link CanonicalMessage} model → written to a Solid pod as
 * owner-private resources via solid-chat-interop's typed-accessor SERIALISERS. It
 * builds NO triples and ships no bespoke RDF parser.
 *
 * Untrusted-input hardened throughout (every imported IRI is filtered http(s)-only,
 * every date is parse-validated, a malformed object drops the bad field rather than
 * aborting the import). The optional {@link fetchGranary} remote helper dereferences
 * a user-configured granary URL ONLY through `@jeswr/guarded-fetch` (SSRF-safe).
 *
 * **Owner-privacy contract:** imported third-party data MUST default to owner-only.
 * This package never writes a broadening ACL and never auto-shares — written
 * resources inherit the (required owner-private) target container's access. See the
 * README SECURITY section.
 *
 * @packageDocumentation
 */

// --- re-exported canonical model + IRI guard from solid-chat-interop, so a
//     consumer has the hub types + the http(s)-only predicate to hand. ---
//     NOTE: `safeIri`/`isHttpIri` only *filter* (http(s)? yes/no) and return the
//     value UNCHANGED. If you build an RDF `NamedNode` from an UNTRUSTED value use
//     {@link safeHttpIri} (re-exported here from `@jeswr/rdf-serialize`) instead — it
//     LEXICALLY percent-encodes the IRIREF-forbidden set (`< > " { } | ^` backtick `\`
//     + C0/space) so a `>`-bearing IRI cannot break out of an `n3.Writer` IRIREF and
//     inject triples, while preserving the value's lexical RDF identity.
export type { CanonicalMessage, MessageProvenance } from "@jeswr/solid-chat-interop";
export { isHttpIri, safeIri } from "@jeswr/solid-chat-interop";
// --- granary AS2 JSON shapes + payload iteration ---
export type {
  GranaryActorRef,
  GranaryAs2,
  GranaryAs2Collection,
  GranaryAs2Object,
  GranaryObjectRef,
} from "./granary.js";
export { isActivity, isCollection, iterateObjects, typeSet } from "./granary.js";
// --- the ingest API (write to a pod) + the pure transform ---
export {
  defaultSlug,
  granaryToCanonical,
  type IngestFormat,
  type IngestGranaryOptions,
  type IngestGranaryResult,
  type IngestItemResult,
  ingestGranary,
} from "./ingest.js";
// --- granary AS2 object → canonical message mapping ---
export { granaryObjectToCanonical, importedDate, refToIri, safeHttpIri } from "./map.js";
// --- the optional SSRF-guarded fetch-from-granary helper ---
export { type FetchGranaryOptions, fetchGranary, GranaryFetchError } from "./remote.js";
