/**
 * Whether `resource` is `container` itself or inside it, respecting path-segment boundaries.
 *
 * A container is treated as ending with `/`: `https://h/alice` contains `https://h/alice/x`
 * but not `https://h/alice-evil/x`. Origins (scheme, host, port) must be equal. URLs with
 * credentials or non-HTTP(S) schemes never match.
 *
 * Paths with percent-encoded `/`, `\` or `.` never match: servers may decode them after routing
 * (`/alice/%2e%2e%2fbob`), so they could name a resource outside the trusted container.
 */
export function isWithin(resource: string | URL, container: string | URL): boolean {
  const r = parseHttpUrl(resource);
  const c = parseHttpUrl(container);
  if (r === undefined || c === undefined || r.origin !== c.origin) return false;

  if (hasAmbiguousPath(r) || hasAmbiguousPath(c)) return false;

  const prefix = c.pathname.endsWith("/") ? c.pathname : `${c.pathname}/`;
  return r.pathname === c.pathname || r.pathname.startsWith(prefix);
}

/** Parses an absolute `http:`/`https:` URL without embedded credentials, or returns `undefined`. */
export function parseHttpUrl(value: string | URL): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return url;
}

/** The URL without fragment, as used for HTTP requests and DPoP `htu` comparisons. */
export function withoutFragment(url: string | URL): string {
  const copy = new URL(url);
  copy.hash = "";
  return copy.href;
}

/**
 * Whether the path contains percent-encoded separators or dots that a server could decode into a
 * different path (`%2f`, `%5c`, `%2e`). WHATWG URL parsing already normalizes literal `\` and `..`.
 */
export function hasAmbiguousPath(url: URL): boolean {
  return /%2f|%5c|%2e/i.test(url.pathname);
}
