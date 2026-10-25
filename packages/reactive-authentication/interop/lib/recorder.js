// A non-reactive transport that records what was sent where — as booleans and schemes, never values — so
// scenarios can assert credential disclosure (and its absence) on the wire.

/**
 * @typedef {object} Exchange
 * @property {string} method
 * @property {string} origin
 * @property {string} path pathname only (no query: authorization responses and codes never enter the log)
 * @property {string | undefined} authorization scheme of the Authorization header (`DPoP`, `Bearer`, `Basic`)
 * @property {boolean} dpop whether a DPoP proof header was sent
 * @property {string | undefined} grantType `grant_type` of form posts (token endpoint requests)
 * @property {number | undefined} status
 * @property {string | undefined} challenge first scheme in `WWW-Authenticate`, reduced to a known name or "other"
 */

/** Known authentication scheme names; anything else a server sends is reported only as "other". */
const knownSchemes = new Map(
  ["Bearer", "DPoP", "UMA", "Basic", "Digest", "Negotiate", "GNAP"].map((s) => [
    s.toLowerCase(),
    s,
  ]),
);

/** A server-supplied scheme name made safe for messages and reports. */
export function schemeName(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return knownSchemes.get(String(value).toLowerCase()) ?? "other";
}

export function recordingFetch(base = globalThis.fetch.bind(globalThis)) {
  /** @type {Exchange[]} */
  const log = [];
  /** Latest token endpoint responses, kept in memory for server-side checks (introspection). Never reported. */
  const tokens = [];

  async function fetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    /** @type {Exchange} */
    const entry = {
      method: request.method,
      origin: url.origin,
      path: url.pathname,
      authorization: request.headers.get("authorization")?.split(" ", 1)[0],
      dpop: request.headers.has("dpop"),
      grantType: undefined,
      status: undefined,
      challenge: undefined,
    };
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")
    ) {
      entry.grantType =
        new URLSearchParams(await request.clone().text()).get("grant_type") ?? undefined;
    }
    log.push(entry);
    const response = await base(request);
    entry.status = response.status;
    entry.challenge = schemeName(response.headers.get("www-authenticate")?.split(/[\s,]/, 1)[0]);
    if (
      entry.grantType !== undefined &&
      response.ok &&
      response.headers.get("content-type")?.includes("json")
    ) {
      try {
        tokens.push(await response.clone().json());
      } catch {
        // not JSON after all; nothing to keep
      }
    }
    return response;
  }

  return {
    fetch,
    log,
    /** Exchanges since `mark()` returned `index`. */
    since: (index) => log.slice(index),
    mark: () => log.length,
    /** The most recent token response (sensitive; for server-side assertions only). */
    get lastTokens() {
      return tokens.at(-1);
    },
    http(allowInsecureRequests) {
      return { fetch, allowInsecureRequests };
    },
  };
}

/** Whether any request outside `allowed` (predicate over URL) carried credentials. */
export function leaks(exchanges, allowed) {
  return exchanges.filter(
    (e) => (e.authorization !== undefined || e.dpop) && !allowed(new URL(e.path, e.origin)),
  );
}
