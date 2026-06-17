// AUTHORED-BY Claude Opus 4.8
/**
 * URL-driven view selection for IssuesView.
 *
 * The URL search param `?view=<name>` is the source of truth for the active
 * view.  LocalStorage is a fallback used only when the URL carries no `?view`
 * param (first visit / bare "/" navigation).  This module is extracted so the
 * logic can be unit-tested without React or Next.js.
 */

export type View = "list" | "board" | "epics" | "dashboard" | "backlog" | "timeline" | "calendar" | "workload" | "inbox";

export const VIEWS: readonly View[] = [
  "list",
  "board",
  "epics",
  "backlog",
  "timeline",
  "calendar",
  "dashboard",
  "workload",
  "inbox",
] as const;

export const VIEW_KEY = "solid-issues:view";

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * Derive the active view from the URL param and the localStorage fallback.
 *
 * @param urlParam  The value of the `?view=` search param (null if absent).
 * @param storage   A localStorage-shaped object (injectable for testing).
 * @returns         The resolved View, defaulting to "list".
 */
export function resolveView(urlParam: string | null, storage: KeyValueStorage): View {
  if (urlParam !== null && VIEWS.includes(urlParam as View)) {
    return urlParam as View;
  }
  const saved = storage.getItem(VIEW_KEY);
  return saved !== null && VIEWS.includes(saved as View) ? (saved as View) : "list";
}

/**
 * Return the URL path+query string to navigate to when the user selects a
 * view.  "list" is the bare "/" (no ?view param); every other view appends
 * `?view=<name>`.
 */
export function viewHref(v: View): string {
  return v === "list" ? "/" : `/?view=${v}`;
}
