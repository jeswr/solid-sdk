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
export function typeSet(type) {
    if (typeof type === "string")
        return new Set([type]);
    if (Array.isArray(type))
        return new Set(type.filter((t) => typeof t === "string"));
    return new Set();
}
/** Is this payload an AS2 Collection / OrderedCollection wrapper? */
export function isCollection(value) {
    for (const t of typeSet(value.type)) {
        if (COLLECTION_TYPES.has(t))
            return true;
    }
    // Some feeds omit `type` but carry `items`/`orderedItems`.
    const c = value;
    return Array.isArray(c.items) || Array.isArray(c.orderedItems);
}
/** Is this object an AS2 Activity whose payload is its wrapped `object`? */
export function isActivity(obj) {
    for (const t of typeSet(obj.type)) {
        if (ACTIVITY_TYPES.has(t))
            return true;
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
export function* iterateObjects(payload, maxItems = Number.POSITIVE_INFINITY) {
    let yielded = 0;
    const emit = (obj) => {
        if (!obj || typeof obj !== "object" || Array.isArray(obj))
            return undefined;
        return obj;
    };
    const items = isCollection(payload)
        ? [...(payload.items ?? []), ...(payload.orderedItems ?? [])]
        : [payload];
    for (const raw of items) {
        if (yielded >= maxItems)
            return;
        const obj = emit(raw);
        if (!obj)
            continue;
        // Unwrap an Activity envelope to its wrapped object(s).
        if (isActivity(obj) && obj.object !== undefined) {
            const wrapped = Array.isArray(obj.object) ? obj.object : [obj.object];
            for (const w of wrapped) {
                if (yielded >= maxItems)
                    return;
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
//# sourceMappingURL=granary.js.map