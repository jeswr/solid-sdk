// AUTHORED-BY Claude Opus 5.5
/**
 * Replace the current URL's query in place, without a navigation or a history entry.
 *
 * Next.js keeps `useSearchParams` in sync with `history.replaceState` (it patches it and
 * restores its own router state). `router.replace` to the same pathname, in contrast, was
 * ignored after a hard load of a URL with a query (`?task=`, `?add=1`), so the param stayed.
 */
export function replaceQuery(pathname: string, query: URLSearchParams): void {
  window.history.replaceState(null, "", `${pathname}${query.size ? `?${query}` : ""}`);
}
