// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * granary AS2 object → canonical {@link CanonicalMessage} mapping.
 *
 * The MAP is near-free because granary already emits ActivityStreams 2.0 — the
 * suite's canonical write vocabulary (exactly what `@jeswr/pod-chat` /
 * `@jeswr/solid-chat-interop` speak). This module reads the granary JSON fields
 * (which the suite RDF parser does not natively project — object-valued
 * `attributedTo`/`inReplyTo`, `contentMap`, an outer activity envelope) onto the
 * canonical model, sanitising EVERY imported IRI through {@link safeHttpIri}
 * (http(s)-only AND canonicalised — a `javascript:`/`mailto:`/`urn:`/bare-string
 * value is DROPPED, and an injection-bearing `https://…> . <…>` value is
 * percent-encoded so it can never break out of an `n3.Writer` IRIREF) and EVERY
 * imported date through a parse-and-validate guard (garbage is dropped, never fatal).
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

/** The canonical default body content type (matches solid-chat-interop). */
const DEFAULT_MEDIA_TYPE = "text/plain";

/**
 * Canonicalise an UNTRUSTED value to a SAFE, injection-proof http(s) IRI, or
 * `undefined` when it is absent / not a string / not an absolute http(s) URL.
 *
 * WHY THIS EXISTS (a HIGH the plain `safeIri` filter does NOT close). granary maps
 * untrusted social-network output, and every IRI here becomes an RDF `NamedNode`
 * that is ultimately serialised by `n3.Writer`. **`n3.Writer` does NOT escape IRIs**
 * — it emits `<value>` verbatim. So a boolean "is this http(s)?" filter is
 * INSUFFICIENT: a hostile `attributedTo`/`id`/`url`/`inReplyTo` value such as
 * `https://e.org/x> . <https://victim/#me> <…#oidcIssuer> <https://attacker/`
 * still *passes* an http(s) check (`new URL()` accepts it) yet, written raw as
 * `<…x> . <victim> <oidcIssuer> <attacker> …>`, BREAKS OUT of the `<…>` IRIREF and
 * INJECTS ARBITRARY TRIPLES into the pod — a forged `solid:oidcIssuer` on the
 * owner's WebID is account-takeover. (Execution-proved; see `map.test.ts`.)
 *
 * The fix is to CANONICALISE, not merely filter: `new URL(value).href` percent-
 * encodes the breakout character `>` (and `<` `"`, space, newline, controls) in EVERY
 * URL component, so the resulting IRI can NEVER terminate its own `<…>` token — triple
 * injection is impossible. But `href` alone is NOT quite a well-formed Turtle IRIREF:
 * a handful of IRIREF-ILLEGAL characters — `|` `^` `` ` `` `{` `}` — still survive
 * `href` inside the query/fragment (verified: `new URL("https://h/a?x=|^\`{}").href`
 * keeps them literal). Emitted raw by `n3.Writer` as `<…|…>` they form an INVALID
 * IRIREF that a strict downstream parser (a different pod/app reading the resource) can
 * reject, failing the whole document — a resource-availability / interop hazard on
 * attacker-influenceable input. So after canonicalising we ALSO percent-encode the
 * residual IRIREF-illegal set, yielding an always-well-formed Turtle IRIREF. The result
 * is idempotent (an already-encoded `%7C` is untouched — `%` is not in the set) and
 * stays a valid, dereferenceable IRI. This mirrors the suite-wide `safeHttpIri`
 * remediation (validate http(s) → canonicalise → encode residual `|`/`^`/`` ` ``).
 */

/**
 * IRIREF-illegal characters (Turtle grammar: `[^#x00-#x20<>"{}|^`\]`) that can SURVIVE
 * `new URL().href`. `>`/`<`/`"`/space/controls are already encoded by `href` in every
 * component and are listed only for belt-and-suspenders; `|`/`^`/`` ` ``/`{`/`}` are the
 * ones that genuinely leak through in a query/fragment. `\` is normalised to `/` by the
 * URL parser for http(s) so never reaches here, but is included for completeness.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: encoding IRIREF-illegal controls is the point.
const RESIDUAL_IRIREF_ILLEGAL = /[\x00-\x20<>"{}|^`\\]/g;

function encodeResidualIriRefChars(href: string): string {
  return href.replace(
    RESIDUAL_IRIREF_ILLEGAL,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

export function safeHttpIri(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  // Canonicalise (`href` encodes the `>` breakout char everywhere) THEN percent-encode
  // the residual IRIREF-illegal chars that survive `href` in a query/fragment, so the
  // value is both injection-proof AND a well-formed Turtle IRIREF.
  return encodeResidualIriRefChars(u.href);
}

/**
 * Resolve an AS2 actor/object reference (string | { id?, url? } | array) to a
 * single SAFE, canonicalised http(s) IRI, or `undefined`. Prefers the first element
 * of an array, then `id`, then the first `url`. Every candidate is run through
 * {@link safeHttpIri} so a non-http(s) value is dropped and an injection-bearing one
 * is canonicalised (never coerced raw into a `NamedNode`).
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
  if (typeof ref === "string") return safeHttpIri(ref);
  // Embedded object: prefer id, then url (first if an array). `safeHttpIri` returns
  // `undefined` for a non-string, so no per-field `typeof` guard is needed.
  const id = safeHttpIri(ref.id);
  if (id !== undefined) return id;
  return firstUrl(ref.url);
}

/** First safe, canonicalised http(s) IRI from a `url` field (string | string[] | other). */
function firstUrl(url: unknown): string | undefined {
  if (Array.isArray(url)) {
    for (const u of url) {
      const safe = safeHttpIri(u);
      if (safe !== undefined) return safe;
    }
    return undefined;
  }
  return safeHttpIri(url);
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
 * IRI-valued field is {@link safeHttpIri}-canonicalised; every date is parse-validated. `content`
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
  const room = refToIri(obj.context) ?? safeHttpIri(obj.conversation);
  const inReplyTo = refToIri(obj.inReplyTo);

  // The source permalink/id the post was imported from (provenance, not identity).
  const derivedFrom = firstUrl(obj.url) ?? safeHttpIri(obj.id);

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
