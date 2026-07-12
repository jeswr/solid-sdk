// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The share-card MODEL (Phase 4B, design §4.1). A share card is a **separate,
 * derived, sanitised** pod resource — NEVER the diary. It carries only the minimal
 * shareable fields the user opted into; it never carries the diary, genetics, a
 * diary provenance IRI, or raw symptom detail.
 *
 * Each card is modelled as a `@jeswr/solid-chat-interop`-shaped {@link
 * CanonicalMessage} (`content` = the card text, `mediaType=text/plain`) so it
 * interoperates with the suite chat/feed model and can be read by Pod Manager. The
 * `CanonicalMessage` type here is a faithful, minimal mirror of chat-interop's
 * published interface (design §1.3); a documented follow-up graduates the model to
 * consume chat-interop's typed `buildAs2Message`/`canonicalToAs2` builders and
 * moves the `diet:*Share` class terms into `@jeswr/solid-health-diary` (+ the
 * fed-vocab mirror) once a node-24 lockfile regen is available. The `diet:*Share`
 * IRIs below are ADDITIVE to the existing `diet:` namespace exported by the diary
 * package — no term is renamed or removed.
 */
import { DIET } from "@jeswr/solid-health-diary";

/** The Activity Streams 2.0 namespace (chat-interop's canonical write vocab). */
export const AS2 = "https://www.w3.org/ns/activitystreams#";

/**
 * `diet:SafeFoodShare` — a sanitised "safe foods" card. Additive to the `diet:`
 * namespace; SHACL-shaped upstream when it graduates to the diary package.
 */
export const DIET_SAFE_FOOD_SHARE = `${DIET}SafeFoodShare`;
/** `diet:SafeVenueShare` — a sanitised "safe venue" card. */
export const DIET_SAFE_VENUE_SHARE = `${DIET}SafeVenueShare`;
/** `diet:ExperienceShare` — a user-authored free-text experience card. */
export const DIET_EXPERIENCE_SHARE = `${DIET}ExperienceShare`;

/** The three share-card kinds. */
export type ShareKind = "safe-food" | "safe-venue" | "experience";

/** The `diet:*Share` class IRI for each kind. */
export const SHARE_CLASS: Readonly<Record<ShareKind, string>> = Object.freeze({
  "safe-food": DIET_SAFE_FOOD_SHARE,
  "safe-venue": DIET_SAFE_VENUE_SHARE,
  experience: DIET_EXPERIENCE_SHARE,
});

/**
 * The audience a card is shared to. `owner-only` (the DEFAULT) keeps the card
 * private; `group` shares to a trusted named group; `public` widens to everyone —
 * and is the tier that REQUIRES an origin-unlinkable identity (see `identity.ts`).
 */
export type ShareAudience = "owner-only" | "group" | "public";

/** The default text media type for a card body. */
export const DEFAULT_MEDIA_TYPE = "text/plain";

/**
 * A faithful, minimal mirror of `@jeswr/solid-chat-interop`'s `CanonicalMessage`
 * (design §1.3). A share card is one of these. Provenance is deliberately modelled
 * but the sanitiser (`share.ts`) forbids `provenance.derivedFrom` on a card — the
 * source link lives ONLY in the owner-only sidecar (design §4.1).
 */
export interface CanonicalMessage {
  /** Subject IRI (optional; the pod resource IRI once written). */
  id?: string;
  /** The card text (required). */
  content: string;
  /** MIME type of `content`; defaults to `text/plain`. */
  mediaType: string;
  /** Author WebID IRI — the PSEUDONYM (or omitted for a public card). */
  author?: string;
  /** ISO-8601 publish timestamp. */
  published?: string;
  /** Conversation/room IRI. */
  room?: string;
  /** Parent message IRI (reply). */
  inReplyTo?: string;
  /** Edit pointer to a replacement message. */
  replacedBy?: string;
  /** Tombstone timestamp (ISO). */
  deletedAt?: string;
  /** PROV-O provenance. `derivedFrom` is FORBIDDEN on a share card (sanitiser). */
  provenance?: {
    attributedTo?: string;
    generatedBy?: string;
    derivedFrom?: string;
  };
}

/**
 * A sanitised, derived share card: a `CanonicalMessage` body plus the `diet:*Share`
 * class it is typed as, and the audience it is destined for. This is the ONLY
 * artifact the peer layer publishes — it is generated FROM the user's data but
 * carries none of the sensitive context (`share.ts`).
 */
export interface ShareCard {
  kind: ShareKind;
  /** The `diet:*Share` class IRI (`SHARE_CLASS[kind]`). */
  shareClass: string;
  /** The chat-interop-shaped message body. */
  message: CanonicalMessage;
  /** The destination audience (`owner-only` by default). */
  audience: ShareAudience;
}
