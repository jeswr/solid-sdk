// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { safeIri } from "@jeswr/solid-chat-interop";
import type { GranaryActorRef, GranaryAs2Object, GranaryObjectRef } from "./granary.js";

/** The canonical default body content type (matches solid-chat-interop). */
const DEFAULT_MEDIA_TYPE = "text/plain";

/**
 * Resolve an AS2 actor/object reference (string | { id?, url? } | array) to a
 * single SAFE http(s) IRI, or `undefined`. Prefers the first element of an array,
 * then `id`, then the first `url`. Every candidate is run through `safeIri` so a
 * non-http(s) value is dropped.
 */
export function refToIri(
  ref: GranaryActorRef | GranaryObjectRef | (GranaryActorRef | GranaryObjectRef)[] | undefined,
): string | undefined {
  if (ref === undefined || ref === null) return undefined;
  if (Array.isArray(ref)) {
    for (const r of ref) {
      const iri = refToIri(r);
      if (iri !== undefined) return iri;
    }
    return undefined;
  }
  if (typeof ref === "string") return safeIri(ref);
  // Embedded object: prefer id, then url (first if an array).
  const id = typeof ref.id === "string" ? safeIri(ref.id) : undefined;
  if (id !== undefined) return id;
  const url = ref.url;
  if (typeof url === "string") return safeIri(url);
  if (Array.isArray(url)) {
    for (const u of url) {
      if (typeof u === "string") {
        const safe = safeIri(u);
        if (safe !== undefined) return safe;
      }
    }
  }
  return undefined;
}

/** First http(s) IRI from a `url` field (string | string[] | undefined). */
function firstUrl(url: string | string[] | undefined): string | undefined {
  if (typeof url === "string") return safeIri(url);
  if (Array.isArray(url)) {
    for (const u of url) {
      if (typeof u === "string") {
        const safe = safeIri(u);
        if (safe !== undefined) return safe;
      }
    }
  }
  return undefined;
}

/**
 * Serialise an UNTRUSTED imported date string to ISO-8601, or `undefined` if it is
 * absent / not a string / unparseable. A garbage `published` is DROPPED — never
 * fatal and never coerced (mirrors solid-chat-interop's `toIsoOrUndefined`).
 */
export function importedDate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** First non-empty string value of a `contentMap`, or `undefined`. */
function firstContentMapValue(map: Record<string, string> | undefined): string | undefined {
  if (!map || typeof map !== "object") return undefined;
  for (const v of Object.values(map)) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Map a single granary AS2 object to a {@link CanonicalMessage}.
 *
 * Untrusted-input discipline throughout: a wrong-typed field is ignored; every
 * IRI-valued field is `safeIri`-filtered; every date is parse-validated. `content`
 * falls back to the first `contentMap` value then to the empty string. The source
 * post's author + permalink are recorded as PROV-O provenance so the imported
 * message carries honest "where this came from" attribution.
 */
export function granaryObjectToCanonical(obj: GranaryAs2Object): CanonicalMessage {
  const content =
    (typeof obj.content === "string" ? obj.content : undefined) ??
    firstContentMapValue(obj.contentMap) ??
    "";

  const mediaType =
    typeof obj.mediaType === "string" && obj.mediaType.trim() !== ""
      ? obj.mediaType.trim()
      : DEFAULT_MEDIA_TYPE;

  const author = refToIri(obj.attributedTo) ?? refToIri(obj.actor);
  const published = importedDate(obj.published) ?? importedDate(obj.updated);
  const room = refToIri(obj.context) ?? safeIri(obj.conversation);
  const inReplyTo = refToIri(obj.inReplyTo);

  // The source permalink/id the post was imported from (provenance, not identity).
  const derivedFrom = firstUrl(obj.url) ?? safeIri(obj.id);

  const msg: CanonicalMessage = { content, mediaType };
  if (author !== undefined) msg.author = author;
  if (published !== undefined) msg.published = published;
  if (room !== undefined) msg.room = room;
  if (inReplyTo !== undefined) msg.inReplyTo = inReplyTo;

  // Provenance: an imported post is attributed to its source author and derived
  // from its source permalink, so it never masquerades as pod-native content.
  const provenance: NonNullable<CanonicalMessage["provenance"]> = {};
  if (author !== undefined) provenance.attributedTo = author;
  if (derivedFrom !== undefined) provenance.derivedFrom = derivedFrom;
  if (provenance.attributedTo !== undefined || provenance.derivedFrom !== undefined) {
    msg.provenance = provenance;
  }

  return msg;
}
