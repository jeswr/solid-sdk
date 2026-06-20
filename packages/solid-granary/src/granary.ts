// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The granary ActivityStreams 2.0 JSON shapes this adapter accepts (`format=as2`).
 *
 * [granary](https://github.com/snarfed/granary) (CC0) converts social posts/feeds
 * from FB / Instagram / Twitter / Mastodon / Bluesky / Nostr / Farcaster / GitHub /
 * Flickr + RSS / Atom / JSON-Feed / mf2 into ActivityStreams 2.0 when asked for
 * `format=as2`. AS2 with the `@context` of `https://www.w3.org/ns/activitystreams`
 * IS JSON-LD — but granary's JSON dialect carries fields the suite's RDF parser does
 * not natively project onto the canonical model (an object-valued `attributedTo` /
 * `inReplyTo`, a `type` of `Article`/`Activity` rather than `Note`, `contentMap`,
 * and an outer `Collection`/`OrderedCollection` wrapper). So this module models the
 * granary JSON shape as plain TypeScript and maps it to the canonical
 * {@link CanonicalMessage} (see `map.ts`), then hands the canonical model to
 * `@jeswr/solid-chat-interop`'s typed-accessor SERIALISERS for the RDF write — no
 * hand-built triples, no bespoke RDF parser.
 *
 * Every field is treated as UNTRUSTED imported input: a wrong-typed value is
 * ignored, never coerced; IRI-valued fields are filtered http(s)-only downstream.
 *
 * @packageDocumentation
 */

/**
 * An AS2 actor reference as granary emits it: either a bare IRI string or an
 * embedded object carrying at least an `id`/`url`. Only the IRI is consumed (the
 * canonical model holds a WebID/IRI); the display name etc. are ignored.
 */
export type GranaryActorRef =
  | string
  | {
      readonly id?: string;
      readonly url?: string | string[];
      readonly [k: string]: unknown;
    };

/** An AS2 object reference (e.g. `inReplyTo`): a bare IRI or an object with an `id`/`url`. */
export type GranaryObjectRef =
  | string
  | {
      readonly id?: string;
      readonly url?: string | string[];
      readonly [k: string]: unknown;
    };

/**
 * A granary AS2 OBJECT (`type: "Note" | "Article" | "Image" | ...`) OR an AS2
 * ACTIVITY (`type: "Create" | "Announce" | ...`) whose payload is in `object`.
 * Modelled permissively: every field is optional and untrusted.
 */
export interface GranaryAs2Object {
  /** The object/activity IRI. */
  readonly id?: string;
  /** The AS2 type (string or array of strings). */
  readonly type?: string | string[];
  /** Body text — `as:content`. */
  readonly content?: string;
  /** Language-tagged body map (e.g. `{ "en": "hi" }`); first value is used as a fallback. */
  readonly contentMap?: Record<string, string>;
  /** Body content type — `as:mediaType` (e.g. `text/html`). */
  readonly mediaType?: string;
  /** Post timestamp — `as:published` (ISO-8601). */
  readonly published?: string;
  /** Last-update timestamp — `as:updated` (ISO-8601). */
  readonly updated?: string;
  /** Author — `as:attributedTo` (IRI string or embedded actor). */
  readonly attributedTo?: GranaryActorRef | GranaryActorRef[];
  /** Author (legacy AS1-ish alias granary sometimes carries). */
  readonly actor?: GranaryActorRef | GranaryActorRef[];
  /** Reply target — `as:inReplyTo` (IRI string or object). */
  readonly inReplyTo?: GranaryObjectRef | GranaryObjectRef[];
  /** The thread/conversation/room — `as:context` (IRI string or object). */
  readonly context?: GranaryObjectRef;
  /** The thread/conversation — granary's `conversation` (IRI), used as a room fallback. */
  readonly conversation?: string;
  /** Permalink — `as:url` (string or array). */
  readonly url?: string | string[];
  /** When this is an Activity (Create/Announce/...), the wrapped object. */
  readonly object?: GranaryAs2Object | GranaryAs2Object[];
  readonly [k: string]: unknown;
}

/**
 * A granary AS2 COLLECTION wrapping many items (`type: "Collection"` /
 * `"OrderedCollection"`). granary returns this for a feed / a user's timeline.
 * Items live under `items` (Collection) or `orderedItems` (OrderedCollection).
 */
export interface GranaryAs2Collection {
  readonly id?: string;
  readonly type?: string | string[];
  readonly items?: GranaryAs2Object[];
  readonly orderedItems?: GranaryAs2Object[];
  readonly [k: string]: unknown;
}

/** The top-level granary `format=as2` payload: a single object or a collection. */
export type GranaryAs2 = GranaryAs2Object | GranaryAs2Collection;

/** AS2 collection types granary uses as a multi-item wrapper. */
const COLLECTION_TYPES = new Set(["Collection", "OrderedCollection"]);

/** AS2 activity types whose real payload is the wrapped `object`. */
const ACTIVITY_TYPES = new Set([
  "Create",
  "Update",
  "Announce",
  "Add",
  "Like",
  "Accept",
  "Activity",
]);

/** Normalise an AS2 `type` (string | string[] | absent) to a string set. */
export function typeSet(type: string | string[] | undefined): Set<string> {
  if (typeof type === "string") return new Set([type]);
  if (Array.isArray(type)) return new Set(type.filter((t): t is string => typeof t === "string"));
  return new Set();
}

/** Is this payload an AS2 Collection / OrderedCollection wrapper? */
export function isCollection(value: GranaryAs2): value is GranaryAs2Collection {
  for (const t of typeSet((value as GranaryAs2Collection).type)) {
    if (COLLECTION_TYPES.has(t)) return true;
  }
  // Some feeds omit `type` but carry `items`/`orderedItems`.
  const c = value as GranaryAs2Collection;
  return Array.isArray(c.items) || Array.isArray(c.orderedItems);
}

/** Is this object an AS2 Activity whose payload is its wrapped `object`? */
export function isActivity(obj: GranaryAs2Object): boolean {
  for (const t of typeSet(obj.type)) {
    if (ACTIVITY_TYPES.has(t)) return true;
  }
  return false;
}

/**
 * Yield the message OBJECTS to import from a granary payload, flattening an outer
 * Collection and unwrapping Activity envelopes (Create/Announce/... → their
 * `object`). A malformed/non-object entry is skipped (never throws). Bounded by
 * `maxItems` (default unbounded) so a hostile huge collection cannot force an
 * unbounded write loop on the caller's behalf — the caller sets the cap.
 */
export function* iterateObjects(
  payload: GranaryAs2,
  maxItems = Number.POSITIVE_INFINITY,
): Generator<GranaryAs2Object> {
  let yielded = 0;
  const emit = (obj: unknown): GranaryAs2Object | undefined => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
    return obj as GranaryAs2Object;
  };

  const items: unknown[] = isCollection(payload)
    ? [...(payload.items ?? []), ...(payload.orderedItems ?? [])]
    : [payload];

  for (const raw of items) {
    if (yielded >= maxItems) return;
    const obj = emit(raw);
    if (!obj) continue;
    // Unwrap an Activity envelope to its wrapped object(s).
    if (isActivity(obj) && obj.object !== undefined) {
      const wrapped = Array.isArray(obj.object) ? obj.object : [obj.object];
      for (const w of wrapped) {
        if (yielded >= maxItems) return;
        const inner = emit(w);
        if (inner) {
          yield inner;
          yielded++;
        }
      }
      continue;
    }
    yield obj;
    yielded++;
  }
}
