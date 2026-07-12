// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Pseudonymous community identity (Phase 4B, design §4.2) — the load-bearing
 * privacy control: **a health condition must never be tied to the real WebID
 * without explicit, per-context consent.**
 *
 * The single subtle rule (design §4.2, a roborev High fix): for a PUBLIC share the
 * pseudonym must be **origin-unlinkable**. A `/community/` path on the user's own
 * pod shares the host/origin with their real WebID and is therefore TRIVIALLY
 * linkable to the same person — so a "same-pod pseudonym" is honestly *linkable*
 * and unsafe for public sharing. This module models two honest tiers and enforces,
 * fail-closed, that a public card can never carry a same-origin (or real-WebID)
 * author.
 */

/**
 * Whether a pseudonym is linkable back to the pod owner:
 * - `linkable-same-pod` — hosted on the same origin as the real WebID (e.g. a
 *   `/community/profile/card` on the user's own pod). Allowed ONLY for owner-only
 *   or trusted-named-group shares, always with a clear "this is linkable to you"
 *   label. NEVER for public.
 * - `unlinkable` — a separate pod/account/origin (or an omitted author). REQUIRED
 *   before a card can be made public.
 */
export type IdentityLinkability = "linkable-same-pod" | "unlinkable";

/**
 * An opt-in pseudonymous community identity. The profile carries a display handle
 * and NO back-link (`rdfs:seeAlso` / same-as) to the health diary or the real
 * profile. `webId` is the pseudonym's WebID; it may be OMITTED entirely for a fully
 * anonymous public card (author dropped).
 */
export interface CommunityIdentity {
  /** A display handle (pseudonym). Never the user's real name by default. */
  handle: string;
  /** The pseudonym WebID IRI, or omitted for a fully-anonymous author. */
  webId?: string;
  /** The honest linkability tier (labelled in the UI). */
  linkability: IdentityLinkability;
}

/** Thrown when an identity is unsafe for the requested audience (fail-closed). */
export class ShareIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareIdentityError";
  }
}

/** The origin (`scheme://host:port`) of an http(s) IRI, or `null` if not http(s). */
export function httpOrigin(iri: string): string | null {
  const u = parseHttp(iri);
  return u === null ? null : u.origin;
}

/** The hostname of an http(s) IRI, or `null` if not http(s). */
export function httpHost(iri: string): string | null {
  const u = parseHttp(iri);
  return u === null ? null : u.hostname;
}

function parseHttp(iri: string): URL | null {
  let u: URL;
  try {
    u = new URL(iri);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  return u;
}

/**
 * Whether two IRIs share the same http(s) HOSTNAME — i.e. live on the same pod
 * host and are therefore trivially linkable to the same person, regardless of
 * scheme or port (`http://a/x` and `https://a/y` DO share the host `a`). A
 * non-http(s) IRI shares no host.
 */
export function sharesHost(a: string, b: string): boolean {
  const ha = httpHost(a);
  const hb = httpHost(b);
  return ha !== null && hb !== null && ha === hb;
}

/**
 * Whether `candidate` is genuinely origin-unlinkable from `realWebId`: a valid
 * http(s) IRI, not equal to the real WebID, and on a DIFFERENT hostname (a
 * different pod host — a separate scheme/port on the SAME host is still linkable,
 * roborev High). Fail-closed: an unparseable/non-http(s) candidate, or one sharing
 * the host, is NOT unlinkable.
 */
export function isOriginUnlinkable(candidate: string, realWebId: string): boolean {
  if (candidate === realWebId) return false;
  if (httpHost(candidate) === null) return false;
  return !sharesHost(candidate, realWebId);
}

/**
 * Validate that an identity's declared `linkability` matches reality — a pseudonym
 * LABELLED `unlinkable` whose WebID actually shares the real WebID's origin is a
 * mislabel and is rejected (so the UI cannot present a linkable identity as safe).
 *
 * @throws {@link ShareIdentityError} on a mislabelled identity.
 */
export function validateIdentity(identity: CommunityIdentity, realWebId: string): void {
  if (identity.linkability === "unlinkable" && identity.webId !== undefined) {
    if (!isOriginUnlinkable(identity.webId, realWebId)) {
      throw new ShareIdentityError(
        "identity is labelled origin-unlinkable but its WebID shares the origin of (or equals) your real WebID — it is linkable and unsafe to present as unlinkable",
      );
    }
  }
}

/**
 * Enforce the identity ↔ audience contract (design §4.2), fail-closed:
 * - `public` REQUIRES an `unlinkable` identity; a `linkable-same-pod` identity is
 *   refused, and a present author WebID must be origin-unlinkable from the real
 *   WebID.
 * - `owner-only` / `group` accept a `linkable-same-pod` identity (the audience
 *   already knows the pod owner).
 * Always validates the identity's self-consistency first ({@link validateIdentity}).
 *
 * @throws {@link ShareIdentityError} when the identity is unsafe for the audience.
 */
export function assertIdentityForAudience(
  identity: CommunityIdentity,
  audience: "owner-only" | "group" | "public",
  realWebId: string,
): void {
  validateIdentity(identity, realWebId);
  if (audience !== "public") return;

  if (identity.linkability !== "unlinkable") {
    throw new ShareIdentityError(
      "a public share requires an origin-unlinkable identity (a separate pod/account or an omitted author) — a same-pod pseudonym is linkable to your real WebID and cannot be made public",
    );
  }
  if (identity.webId !== undefined && !isOriginUnlinkable(identity.webId, realWebId)) {
    throw new ShareIdentityError(
      "a public share's author must be origin-unlinkable from your real WebID",
    );
  }
}

/**
 * The `CanonicalMessage.author` to stamp on a card: the pseudonym WebID, or
 * `undefined` (fully anonymous) when the identity has no separate WebID. For a
 * public card the WebID is already guaranteed origin-unlinkable by a prior
 * {@link assertIdentityForAudience} — this NEVER returns a same-origin/real WebID
 * for a public audience because that identity would have been refused upstream.
 */
export function authorForIdentity(identity: CommunityIdentity): string | undefined {
  return identity.webId;
}
