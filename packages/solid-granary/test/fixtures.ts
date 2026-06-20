// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * granary `format=as2` sample payloads for a couple of silos + a feed, plus a
 * hostile/malformed object. Shapes mirror what `snarfed/granary` emits: AS2 JSON
 * with `@context`, `type`, `content`, `published`, an object- OR string-valued
 * `attributedTo`/`inReplyTo`, and an outer `Collection`/`OrderedCollection` for a
 * feed. Used by the unit tests; nothing in here hits the network.
 */

import type { GranaryAs2Collection, GranaryAs2Object } from "../src/granary.js";

/** A single Mastodon Note (object-valued actor + inReplyTo string). */
export const mastodonNote: GranaryAs2Object = {
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "Note",
  id: "https://mastodon.social/users/alice/statuses/110001",
  content: "Just shipped @jeswr/solid-granary 🌾",
  mediaType: "text/html",
  published: "2026-06-20T09:30:00Z",
  attributedTo: { id: "https://mastodon.social/users/alice", displayName: "Alice" },
  inReplyTo: "https://mastodon.social/users/bob/statuses/109999",
  url: "https://mastodon.social/@alice/110001",
};

/** A single Bluesky post wrapped in a Create activity (granary often wraps). */
export const blueskyCreate: GranaryAs2Object = {
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "Create",
  id: "https://bsky.app/activity/abc",
  actor: "https://bsky.app/profile/carol.bsky.social",
  object: {
    type: "Note",
    id: "https://bsky.app/profile/carol.bsky.social/post/3k",
    content: "gm from the firehose",
    published: "2026-06-20T08:00:00Z",
    attributedTo: "https://bsky.app/profile/carol.bsky.social",
    url: ["https://bsky.app/profile/carol.bsky.social/post/3k"],
    context: "https://bsky.app/profile/carol.bsky.social",
  },
};

/** An RSS/Atom feed converted to an AS2 OrderedCollection of two entries. */
export const rssFeed: GranaryAs2Collection = {
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "OrderedCollection",
  id: "https://granary.io/url?input=rss&output=as2&url=https://blog.example/feed",
  orderedItems: [
    {
      type: "Article",
      id: "https://blog.example/posts/1",
      content: "First post body",
      published: "2026-06-19T12:00:00Z",
      attributedTo: { url: "https://blog.example/about" },
      url: "https://blog.example/posts/1",
    },
    {
      type: "Article",
      id: "https://blog.example/posts/2",
      contentMap: { en: "Second post body (contentMap)" },
      published: "2026-06-20T12:00:00Z",
      url: ["https://blog.example/posts/2"],
    },
  ],
};

/** A plain Collection (non-ordered) with a single item — granary's other wrapper. */
export const githubCollection: GranaryAs2Collection = {
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "Collection",
  items: [
    {
      type: "Note",
      id: "https://github.com/jeswr/solid-granary/issues/1",
      content: "Opened an issue",
      published: "2026-06-20T11:11:11Z",
      attributedTo: "https://github.com/dave",
      url: "https://github.com/jeswr/solid-granary/issues/1",
    },
  ],
};

/**
 * A HOSTILE / malformed AS2 object: a non-http(s) (javascript:) actor + url, a
 * `urn:` inReplyTo, a garbage `published`, an object-valued `content` (wrong type),
 * and a non-string `mediaType`. The mapper MUST drop every bad field and still
 * produce a usable message rather than throw.
 */
export const hostileNote: GranaryAs2Object = {
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "Note",
  id: "javascript:alert(1)",
  // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong-typed untrusted input.
  content: { evil: true } as any,
  contentMap: { en: "recovered body from contentMap" },
  // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong-typed untrusted input.
  mediaType: 42 as any,
  published: "not-a-real-date",
  attributedTo: "javascript:steal()",
  inReplyTo: "urn:uuid:1234",
  url: "javascript:void(0)",
  context: "mailto:nope@example.com",
};

/**
 * A feed whose items array contains junk (a string, a null, a number) mixed with
 * one valid Note — iteration must skip the junk and import only the valid item.
 */
export const messyFeed: GranaryAs2Collection = {
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "Collection",
  items: [
    // biome-ignore lint/suspicious/noExplicitAny: junk entries for resilience test.
    "not an object" as any,
    // biome-ignore lint/suspicious/noExplicitAny: junk entries for resilience test.
    null as any,
    // biome-ignore lint/suspicious/noExplicitAny: junk entries for resilience test.
    7 as any,
    {
      type: "Note",
      id: "https://example.org/valid",
      content: "the one good item",
      published: "2026-06-20T00:00:00Z",
      attributedTo: "https://example.org/eve",
      url: "https://example.org/valid",
    },
  ],
};
