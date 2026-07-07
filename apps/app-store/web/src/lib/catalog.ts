// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// catalog.ts — the typed shape of the app-store catalog (the data the UI renders
// and the DCAT serializer emits). The single source of truth for an app entry is
// the committed `web/data/apps.json`; this module declares its TypeScript type and
// the small derived helpers (category grouping, live-only filtering) so the UI and
// the gen-catalog.mjs serializer agree on the shape.

/** Lifecycle/curation status of a listing (drives whether Launch is enabled). */
export type AppStatus = "live" | "wip" | "local-only" | "gated";

/**
 * How an app accepts an inbound launch:
 *  - "autologin" → `#autologin/<webid>` full-page redirect SSO (the 8 vite
 *    pod-apps + Solid Issues, built on the create-solid-app redirect autologin);
 *  - "prefill"   → `?webid=<webid>` query prefill + one-click sign-in (Pod Manager);
 *  - "none"      → no deep-link contract; a plain link to the app origin (its own
 *    login). Used for not-yet-live apps and as the logged-out fallback.
 */
export type LaunchKind = "autologin" | "prefill" | "none";

/** A category bucket (the recon grouping order is fixed in {@link CATEGORY_ORDER}). */
export type Category =
  | "Documents"
  | "Media"
  | "Comms"
  | "Health"
  | "Productivity"
  | "Finance"
  | "Demo";

/** One app listing — mirrors a `web/data/apps.json` entry exactly. */
export interface AppEntry {
  /** Stable id / slug (matches the repo name where there is one). */
  id: string;
  /** Human display name (the card title + Launch label). */
  name: string;
  /** One-line description rendered on the card. */
  description: string;
  /** Display category bucket. */
  category: Category;
  /**
   * The deployed app origin (no trailing slash needed). `null` for apps that are
   * not deployed (wip / local-only) — those render "Coming soon", never a Launch.
   */
  deployedUrl: string | null;
  /** Lifecycle status — `live` is the only one with an enabled Launch. */
  status: AppStatus;
  /** Public source repo URL, or `null` when the repo is private / has no remote. */
  repo: string | null;
  /** The inbound launch mechanism this app accepts. */
  launch: LaunchKind;
}

/**
 * The fixed category render order (the recon grouping). The UI iterates this so a
 * category with no live entries can still be skipped deterministically.
 */
export const CATEGORY_ORDER: readonly Category[] = [
  "Documents",
  "Media",
  "Comms",
  "Health",
  "Productivity",
  "Finance",
  "Demo",
];

/** True when an app is deployed + listable with a working Launch. */
export function isLive(app: AppEntry): boolean {
  return app.status === "live" && app.deployedUrl !== null;
}

/**
 * The verb for a live app's action button. "Launch" is only honest when the store
 * actually carries the user's identity into the target — i.e. the app declares a
 * deep-link contract (autologin/prefill) AND a WebID is known. Externally-hosted
 * apps (`launch: "none"`) get no identity deep-link, so they are always "Open" — a
 * plain link to the app's own login, even for a signed-in user.
 */
export function launchVerb(app: AppEntry, webId: string | null): "Launch" | "Open" {
  return webId && app.launch !== "none" ? "Launch" : "Open";
}

/**
 * Pure client-side fuzzy-ish match over an app's name + description + category +
 * id. A plain case-insensitive substring match on the normalised query tokens —
 * every whitespace-separated token must appear somewhere in the haystack (AND).
 * An empty / whitespace-only query matches everything.
 */
export function matchesQuery(app: AppEntry, query: string): boolean {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = `${app.name} ${app.description} ${app.category} ${app.id}`.toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Group entries by category in the fixed {@link CATEGORY_ORDER}, dropping empty
 * categories. Pure — the UI renders the result directly.
 */
export function groupByCategory(apps: readonly AppEntry[]): Array<[Category, AppEntry[]]> {
  const out: Array<[Category, AppEntry[]]> = [];
  for (const category of CATEGORY_ORDER) {
    const inCat = apps.filter((a) => a.category === category);
    if (inCat.length > 0) out.push([category, inCat]);
  }
  return out;
}
