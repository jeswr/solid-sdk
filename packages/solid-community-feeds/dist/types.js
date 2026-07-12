// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see prod-solid-server docs/MODEL-PROVENANCE.md
/**
 * The UNIFIED community-feed model.
 *
 * Both sources — Matrix rooms and Discourse forum topics — normalize onto one
 * shape so the Pod Manager renders a single "Solid Community" surface without
 * caring which backend a message came from:
 *
 *     CommunityChannel  (a Matrix room OR a Discourse category)
 *       └─ CommunityThread   (a Matrix room is one implicit thread; a Discourse
 *                             topic is a thread)
 *            └─ CommunityMessage  (a Matrix m.room.message; a Discourse post)
 *
 * Every message carries author, timestamp, body and a `permalink` back to the
 * source so click-through always lands on the canonical web view. `source`
 * discriminates the backend.
 */
/** A normalized error from any feed source. */
export class CommunityFeedError extends Error {
    source;
    cause;
    constructor(source, message, cause) {
        super(message);
        this.name = "CommunityFeedError";
        this.source = source;
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}
//# sourceMappingURL=types.js.map