// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The curated, hand-maintained community LINK-OUT catalog (Phase 4A, design
 * §3.1). This is the reliable core of the community layer: get the user to the
 * good, already-moderated communities safely, without pretending we can
 * aggregate closed platforms we cannot read (design §0).
 *
 * Every entry is a static, REVIEWED constant — there is no runtime source, no
 * user-supplied URL, no open-web search. Each host is on the committed
 * {@link COMMUNITY_HOSTS} allowlist (asserted by a test); an entry whose host
 * drifts off-list is dropped fail-closed by {@link allowedCommunities}. None of
 * these are moderated by *this* app — the view carries a peer-content banner and
 * every link-out passes through an external-community interstitial (design §3.1).
 */
import { isAllowlistedCommunityHost } from "./allowlist";

/** How the entry is grouped in the view (drives section ordering + labels). */
export type CommunityCategory = "charity" | "venue-guide" | "peer-forum" | "patient-community";

/** A single curated community link-out. */
export interface CommunityLinkEntry {
  /** Stable id (React key + test target). */
  id: string;
  /** Human-facing name (the accessible link text base — WCAG 2.4.4). */
  name: string;
  /** The organisation / platform that runs and moderates it. */
  org: string;
  /** The external https URL (must be on {@link COMMUNITY_HOSTS}). */
  url: string;
  /** One-line description of what it is. */
  description: string;
  /** Grouping category. */
  category: CommunityCategory;
  /** Who moderates it — surfaced so the reader knows it is not this app. */
  moderatedBy: string;
  /**
   * Optional audience / safeguarding note (design §3.1 — e.g. member-gated, or a
   * minors-sensitive space we describe but do not deep-link into).
   */
  audience?: string;
}

/**
 * The catalog. Ordered charity/authoritative first, then venue guides, then peer
 * forums / patient communities — credibility-forward, mirroring the Research
 * view's ordering discipline.
 */
export const COMMUNITIES: readonly CommunityLinkEntry[] = Object.freeze([
  {
    id: "coeliac-uk-community",
    name: "Coeliac UK — support & community",
    org: "Coeliac UK",
    url: "https://www.coeliac.org.uk/living-with-coeliac-disease/community/",
    description:
      "The UK coeliac charity: local volunteer groups, helpline, and living-with-coeliac support.",
    category: "charity",
    moderatedBy: "Coeliac UK (registered charity)",
    audience:
      "Some spaces (e.g. Coeliac UK Connect, a private space for 16–19-year-olds) are members-only and not linked here.",
  },
  {
    id: "celiac-disease-foundation",
    name: "Celiac Disease Foundation",
    org: "Celiac Disease Foundation",
    url: "https://celiac.org/",
    description:
      "US patient charity: label-reading guidance, newly-diagnosed resources, and advocacy.",
    category: "charity",
    moderatedBy: "Celiac Disease Foundation (non-profit)",
  },
  {
    id: "coeliac-uk-venues",
    name: "Coeliac UK — GF-accredited venue guide",
    org: "Coeliac UK",
    url: "https://www.coeliac.org.uk/gluten-free-accredited-venues/",
    description:
      "Search 3,000+ gluten-free-accredited places to eat out — the authoritative UK venue guide.",
    category: "venue-guide",
    moderatedBy: "Coeliac UK (accreditation scheme)",
    audience: "The venue data lives behind their own scheme — we link to the guide, never re-host it.",
  },
  {
    id: "find-me-gluten-free",
    name: "Find Me Gluten Free",
    org: "Find Me Gluten Free",
    url: "https://www.findmeglutenfree.com/",
    description:
      "Community reviews of gluten-free-friendly restaurants and venues — a useful eating-out complement.",
    category: "venue-guide",
    moderatedBy: "Find Me Gluten Free (community reviews)",
  },
  {
    id: "reddit-celiac",
    name: "r/Celiac on Reddit",
    org: "Reddit",
    url: "https://www.reddit.com/r/Celiac/",
    description:
      "A large, active peer community sharing day-to-day coeliac experience — personal experience, not advice.",
    category: "peer-forum",
    moderatedBy: "Reddit volunteer moderators",
  },
  {
    id: "celiac-com-forums",
    name: "celiac.com forums",
    org: "celiac.com",
    url: "https://www.celiac.com/forums/",
    description: "A long-running (30-year) peer discussion forum for coeliac disease and gluten-free living.",
    category: "peer-forum",
    moderatedBy: "celiac.com site moderators",
  },
  {
    id: "healthunlocked-coeliac",
    name: "HealthUnlocked — coeliac & gluten-free communities",
    org: "HealthUnlocked",
    url: "https://healthunlocked.com/",
    description:
      "Moderated patient communities where people with coeliac disease share experience and support.",
    category: "patient-community",
    moderatedBy: "HealthUnlocked (community platform)",
  },
]);

/**
 * The catalog filtered to entries whose host is on the committed allowlist.
 * Fail-closed: an entry that somehow references an off-list or non-https host is
 * DROPPED, never rendered (design rail §4). In practice every committed entry
 * passes; this is a structural guard so a future bad edit cannot surface an
 * unreviewed destination.
 */
export function allowedCommunities(): CommunityLinkEntry[] {
  return COMMUNITIES.filter((c) => isAllowlistedCommunityHost(c.url));
}

/** Entries in a given category (allowlisted), preserving catalog order. */
export function communitiesByCategory(category: CommunityCategory): CommunityLinkEntry[] {
  return allowedCommunities().filter((c) => c.category === category);
}

/** Human labels for each category section. */
export const CATEGORY_LABELS: Record<CommunityCategory, string> = {
  charity: "Charities & official support",
  "venue-guide": "Eating out",
  "peer-forum": "Peer forums",
  "patient-community": "Patient communities",
};
