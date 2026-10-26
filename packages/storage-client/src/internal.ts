// AUTHORED-BY Claude Opus 5.5
// Shared, backend-neutral internals (not exported from the package).
import { StorageError } from "./errors.js";
import type { Body, Entry, Page, PageCursor } from "./types.js";

/** ADR-003 §4: listAll stops here. */
export const MAX_PAGES = 10_000;

/** Throw `network` (retryable: false) when the caller's signal has fired. */
export function throwIfAborted(method: string, url: string, signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new StorageError("network", {
      method,
      url,
      retryable: false,
      cause: signal.reason,
      message: `${method} ${url} aborted`,
    });
  }
}

/** Collect any supported body into bytes. Strings are UTF-8 encoded. */
export async function toBytes(body: Body): Promise<Uint8Array> {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** Iterate every page of a listing (ADR-003 §4): loop guard on repeated cursors and a page cap. */
export async function* paginate(
  container: string,
  list: (cursor: PageCursor | undefined) => Promise<Page<Entry>>,
  signal: AbortSignal | undefined,
): AsyncGenerator<Entry> {
  const seen = new Set<string>();
  let cursor: PageCursor | undefined;
  for (let pages = 0; ; pages++) {
    throwIfAborted("GET", cursor?.url ?? container, signal);
    if (pages >= MAX_PAGES) {
      throw new StorageError("invalid-response", {
        method: "GET",
        url: container,
        message: `Listing ${container} exceeds ${MAX_PAGES} pages`,
      });
    }
    const page = await list(cursor);
    yield* page.items;
    if (page.next === null) return;
    if (seen.has(page.next.url) || page.next.url === container) {
      throw new StorageError("invalid-response", {
        method: "GET",
        url: page.next.url,
        message: `Listing ${container} repeats page ${page.next.url}`,
      });
    }
    seen.add(page.next.url);
    cursor = page.next;
  }
}

/** Same origin, and the path is the root's or below it (path-segment boundary). */
export function isWithin(url: string, root: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const base = new URL(root);
  if (target.origin !== base.origin || target.username || target.password) return false;
  const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return target.pathname === base.pathname || target.pathname.startsWith(prefix);
}

/** Solid path arithmetic: the container one level up, or null at the storage root. */
export function pathParent(url: string, root: string): string | null {
  const target = new URL(url);
  target.search = "";
  target.hash = "";
  if (target.href === new URL(root).href) return null;
  const parent = new URL(target.pathname.endsWith("/") ? ".." : ".", target);
  return parent.href;
}
