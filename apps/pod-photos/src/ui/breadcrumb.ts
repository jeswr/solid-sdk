// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Breadcrumb derivation for the gallery view — pure string logic, kept out of
// the component so it is unit-testable in isolation (incl. the defensive
// "navigated outside the root" path the UI itself never produces).

/** One breadcrumb hop: the container URL to navigate to + its display label. */
export interface Crumb {
  url: string;
  label: string;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The label for a stand-alone container URL: its decoded last path segment. */
function labelForSegment(url: string): string {
  const trimmed = url.replace(/\/$/, '');
  const last = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return decodeSegment(last) || url;
}

/**
 * The breadcrumb trail from the gallery root down to `currentUrl` (inclusive).
 * The root crumb carries `rootLabel` (default "Photos"); each descendant its
 * decoded path segment. If `currentUrl` is somehow outside `rootUrl` (not
 * reachable via the UI, but guarded), returns a single crumb for the current
 * container.
 */
export function breadcrumbFor(currentUrl: string, rootUrl: string, rootLabel = 'Photos'): Crumb[] {
  const root = rootUrl.endsWith('/') ? rootUrl : `${rootUrl}/`;
  if (!currentUrl.startsWith(root)) {
    return [{ url: currentUrl, label: labelForSegment(currentUrl) }];
  }
  const crumbs: Crumb[] = [{ url: root, label: rootLabel }];
  const tail = currentUrl.slice(root.length).replace(/\/$/, '');
  if (tail.length === 0) {
    return crumbs;
  }
  let acc = root;
  for (const segment of tail.split('/')) {
    acc = `${acc}${segment}/`;
    crumbs.push({ url: acc, label: decodeSegment(segment) });
  }
  return crumbs;
}
