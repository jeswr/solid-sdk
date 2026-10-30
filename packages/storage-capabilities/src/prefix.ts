// AUTHORED-BY Claude Opus 5.5
// Root-prefix arithmetic and record comparison shared by the caches, resolver and capabilities() (internal).
import type { StorageDescription } from "./types.js";

export type Prefix = { root: string; storageId: string };

export function prefixUrl(value: string): URL {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url;
}

/** Match path boundaries as well as origins; /alice must never match /alice-other. */
function contains(root: URL, url: URL): boolean {
  return (
    root.origin === url.origin &&
    (url.pathname === root.pathname ||
      url.pathname.startsWith(root.pathname.endsWith("/") ? root.pathname : `${root.pathname}/`))
  );
}

/** Whether `url` lies under `root` (same origin, path-boundary prefix; query/fragment ignored). */
export function isWithinRoot(url: string, root: string): boolean {
  return contains(prefixUrl(root), prefixUrl(url));
}

export function longestPrefix(value: string, prefixes: Iterable<Prefix>): string | undefined {
  const url = prefixUrl(value);
  let longest = -1;
  let storageId: string | undefined;
  for (const prefix of prefixes) {
    const root = prefixUrl(prefix.root);
    if (contains(root, url) && root.pathname.length > longest) {
      longest = root.pathname.length;
      storageId = prefix.storageId;
    }
  }
  return storageId;
}

/** Same cache generation: an identical description (deleted or replaced records never match). */
export function sameDescription(a: StorageDescription, b: StorageDescription): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
