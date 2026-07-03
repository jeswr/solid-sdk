// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The community LINK-OUT host allowlist (Phase 4A, design §2 rail 4 / §3.1).
 *
 * Phase 4A is **link-OUT only** — the app fetches NO community content (the
 * coeliac community lives on closed platforms with no open read API; design §0).
 * This module is therefore a *link-target* allowlist, not a fetch chokepoint: it
 * exists so the curated `communities.ts` catalog is validated against a small,
 * committed, reviewed set of reputable hosts, and any entry whose host drifts
 * off-list is dropped fail-closed at render (a reviewed code change is the only
 * way to add a host — never a runtime input). No `foreignFetch`/`knowledgeFetch`
 * is layered here because nothing is fetched; if a read-only feed (design §3.3,
 * bead 4A-2) ever ships, it gets its OWN feed-URL allowlist on top of the
 * community-feeds `safeFetch`, not this link-target list.
 */

/**
 * The closed allowlist of community link-out hosts (hostnames). Frozen — never
 * mutated. Adding a host is a reviewed code change (design rail §4).
 */
export const COMMUNITY_HOSTS: readonly string[] = Object.freeze([
  "www.coeliac.org.uk", // Coeliac UK (charity: community + GF-accredited venue guide)
  "www.findmeglutenfree.com", // Find Me Gluten Free (community venue reviews)
  "celiac.org", // Celiac Disease Foundation (US charity)
  "www.reddit.com", // r/Celiac etc. (Reddit-moderated peer communities)
  "www.celiac.com", // celiac.com forums (site-moderated peer forum)
  "healthunlocked.com", // HealthUnlocked (moderated patient communities)
]);

/**
 * Whether `url` is an https URL on the closed community allowlist. Fail-closed: a
 * malformed URL, a non-https scheme, embedded credentials, or an off-list host
 * all return `false`. This is a link-TARGET check (no network I/O) — it gates
 * what the static catalog may render, not a fetch.
 */
export function isAllowlistedCommunityHost(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  // Reject URL-embedded credentials (never legitimate on a public link-out).
  if (u.username || u.password) return false;
  return COMMUNITY_HOSTS.includes(u.hostname);
}
