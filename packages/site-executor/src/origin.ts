// AUTHORED-BY Claude Opus 5.5
// The origin guard. Every URL the executor is about to request (operation, CSRF
// page, redirect target) passes through `guardUrl`; anything that is not on the
// site model's own origin is refused before a byte is sent, so the user's session
// can never be carried to another host.

export class OriginError extends Error {
  override name = "OriginError";
}

const LOOPBACK_HOSTS = new Set(["localhost", "[::1]"]);

/** True for 127.0.0.0/8, ::1 and localhost. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  return /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
}

/**
 * Parse and validate a site origin: https anywhere, http only on loopback; no
 * credentials in the authority. Returns the canonical origin string.
 */
export function siteOrigin(site: string): string {
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    throw new OriginError("site model origin is not an absolute URL");
  }
  if (url.username !== "" || url.password !== "") {
    throw new OriginError("site model origin must not carry credentials");
  }
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return url.origin;
  throw new OriginError("site model origin must be https (http is allowed on loopback only)");
}

/** A URL safe to print in errors: origin and path only (no query, which may carry tokens). */
export function describeUrl(url: string | URL): string {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    return `${u.origin}${u.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}

/**
 * Resolve `candidate` against the site origin and refuse it unless the result is
 * on exactly that origin (scheme, host and port), carries no userinfo and uses an
 * http(s) scheme. Protocol-relative (`//evil.test`), backslash and userinfo tricks
 * are all neutralised because the check runs on the WHATWG-parsed result.
 */
export function guardUrl(candidate: string, origin: string): URL {
  let url: URL;
  try {
    url = new URL(candidate, `${origin}/`);
  } catch {
    throw new OriginError("request URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OriginError(`refused non-http(s) URL scheme ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new OriginError("refused URL with credentials in the authority");
  }
  if (url.origin !== origin) {
    throw new OriginError(`refused request to ${url.origin}: not on the site origin ${origin}`);
  }
  return url;
}
