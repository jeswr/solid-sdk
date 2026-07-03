// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Pod storage layout for the pod-owned peer-sharing layer (Phase 4B, design
 * §4.3). Pure URL helpers — no I/O — so they are exhaustively unit-testable and
 * cannot hide a path-traversal bug, exactly like `pod/layout.ts`.
 *
 * The load-bearing invariant of this file: **`/community/` is a DISJOINT ACL
 * scope from `/health/diary/`.** A share is a NEW, derived, sanitised resource
 * under `${storageRoot}community/`; nothing under `${storageRoot}health/diary/`
 * ever has its ACL widened by a share (design §4.3 / §8). The scope guards below
 * make that structural: `assertCommunityScope` refuses any URL that is not under
 * the community root, and `containsDiaryScope` fails closed on any `/health/diary/`
 * IRI reaching a share.
 *
 * ```
 * /community/
 *   profile/card.ttl                # pseudonymous community profile (no diary link)
 *   shares/{ulid}.ttl               # a shared, sanitised card
 *   shares/{ulid}.provenance.ttl    # owner-only sidecar (source link; NEVER bundled into the card)
 * ```
 */
import { asContainer, assertUlid } from "../pod/layout";

/**
 * The path segment that marks a health-diary resource. Any IRI carrying it is a
 * diary IRI and must never enter a shared card (design §4.1 roborev High — even an
 * owner-private diary IRI leaks diary structure + health context once published).
 */
export const DIARY_SCOPE_SEGMENT = "/health/diary/";

/**
 * Decode EVERY well-formed percent-escape in a string, iteratively (to unwrap
 * multi-level encodings like `%252F`), while leaving any malformed `%` untouched.
 * Fail-safe by construction: a single bad escape (`%ZZ`) can no longer make a whole
 * value undecodable — the previous `decodeURIComponent(value)` threw on that and let
 * an encoded diary path slip past (roborev High). A legitimate stray `%` (e.g.
 * "50% gluten-free") is left as-is rather than over-rejected.
 */
export function safeDecodeAll(value: string): string {
  let cur = value;
  // Decode to a FIXED POINT (roborev High: a fixed low pass-cap let a value encoded
  // more times than the cap slip past). This terminates: every successful decode
  // strictly SHORTENS the string (`%XX` → 1 char), so the fixed point is reached in
  // at most `value.length` passes — the bound below is a safety belt never hit.
  for (let i = 0; i <= value.length; i++) {
    const next = cur.replace(/%[0-9A-Fa-f]{2}/g, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

/**
 * Whether a string carries the diary scope segment (raw OR percent-decoded,
 * multi-level, OR after URL dot-segment normalisation). Used both for IRI-valued
 * fields and free-text bodies, so a diary IRI can never leak into a card by any
 * field — including a normalised form like `…/health/x/../diary/…` that only
 * resolves to `/health/diary/` after `new URL` collapses `..` (roborev High).
 * Fail-closed.
 */
export function containsDiaryScope(value: string): boolean {
  for (const s of [value, safeDecodeAll(value)]) {
    if (s.includes(DIARY_SCOPE_SEGMENT)) return true;
    // The whole string as a URL (an IRI-valued field), normalised.
    if (normalisedHasDiaryScope(s)) return true;
    // Any http(s) URL embedded in free text, each normalised.
    for (const m of s.match(/https?:\/\/[^\s"'<>]+/gi) ?? []) {
      if (normalisedHasDiaryScope(m)) return true;
    }
  }
  return false;
}

/** Whether an absolute URL's normalised href carries the diary scope (or `false` if not a URL). */
function normalisedHasDiaryScope(candidate: string): boolean {
  try {
    return new URL(candidate).href.includes(DIARY_SCOPE_SEGMENT);
  } catch {
    return false;
  }
}

/** Whether an IRI is a health-diary IRI (carries the diary scope segment). */
export function isDiaryIri(iri: string): boolean {
  return containsDiaryScope(iri);
}

/** The community root container: `${storageRoot}community/`. */
export function communityRoot(storageRoot: string): string {
  const root = asContainer(storageRoot);
  const u = new URL(root); // throws on a non-absolute URL
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`storageRoot must be http(s): ${storageRoot}`);
  }
  return `${root}community/`;
}

/** The pseudonymous community profile container (`…/community/profile/`). */
export function communityProfileContainer(storageRoot: string): string {
  return `${communityRoot(storageRoot)}profile/`;
}

/** The pseudonymous community profile document (`…/community/profile/card.ttl`). */
export function communityProfileUrl(storageRoot: string): string {
  return `${communityProfileContainer(storageRoot)}card.ttl`;
}

/** The shared-cards container (`…/community/shares/`). */
export function communitySharesContainer(storageRoot: string): string {
  return `${communityRoot(storageRoot)}shares/`;
}

/**
 * A shared-card resource URL: `…/community/shares/{ulid}.ttl`. The `ulid` is
 * validated (Crockford base32, 26 chars) so it can never inject a path segment.
 */
export function shareUrl(storageRoot: string, ulid: string): string {
  return `${communitySharesContainer(storageRoot)}${assertUlid(ulid)}.ttl`;
}

/**
 * The OWNER-ONLY provenance sidecar for a share:
 * `…/community/shares/{ulid}.provenance.ttl`. This — and ONLY this — may hold the
 * user↔source link for their own bookkeeping (design §4.1). It has its own
 * never-widened owner-only ACL and the publish path is structurally incapable of
 * bundling it into the public card.
 */
export function shareProvenanceSidecarUrl(storageRoot: string, ulid: string): string {
  return `${communitySharesContainer(storageRoot)}${assertUlid(ulid)}.provenance.ttl`;
}

/** The set of community containers that must exist (each ACL-protected) before writes. */
export function communityContainers(storageRoot: string): string[] {
  return [
    communityRoot(storageRoot),
    communityProfileContainer(storageRoot),
    communitySharesContainer(storageRoot),
  ];
}

/**
 * Assert a write target is inside the community scope and is NOT a diary IRI.
 * Fail-closed: any URL outside `${storageRoot}community/` — or any diary IRI —
 * throws, so the share pipeline can never write to (or widen) a diary resource.
 */
export function assertCommunityScope(url: string, storageRoot: string): string {
  const root = communityRoot(storageRoot);
  // Normalise dot-segments FIRST (roborev Medium): a raw `startsWith` would accept
  // `…/community/../health/diary/x` — `new URL` collapses `..` so the real target is
  // checked, not the pre-traversal string.
  let normalized: string;
  try {
    normalized = new URL(url).href;
  } catch {
    throw new Error(`refusing to write a non-absolute share URL: ${url}`);
  }
  if (isDiaryIri(normalized) || isDiaryIri(url)) {
    throw new Error(`refusing to write a share to a diary IRI: ${url}`);
  }
  if (!normalized.startsWith(root)) {
    throw new Error(`refusing to write outside the community scope (${root}): ${normalized}`);
  }
  return normalized;
}
