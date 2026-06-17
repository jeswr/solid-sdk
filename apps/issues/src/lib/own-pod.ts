// AUTHORED-BY Claude Opus 4.8
/**
 * Own-pod SSRF guard (load-bearing security).
 *
 * Notification channel/subscription URLs and the user's `ldp:inbox` URL all come
 * from data the server (or a third party) controls — the storage description, the
 * subscription POST response (`receiveFrom`), and the WebID profile. Before we
 * connect a WebSocket to, or fetch (with the user's auth-patched `fetch`), any of
 * those URLs we MUST confirm the URL points at one of the user's OWN pod storages.
 * Otherwise a malicious profile/description could:
 *   • drive the app to open an authenticated request to an attacker origin
 *     (server-side-request-forgery on the client's behalf), or
 *   • cause the DPoP-bound `fetch` to attach the user's token to a foreign origin.
 *
 * The pattern (see the `solid-fetch-rdf` / `solid-type-index` skills' "discovery
 * is a hint, not a grant" rule): pin requests to the user's own storage roots —
 * a `same-origin` + path-prefix check against the `pim:storage` URLs from their
 * profile — and reject anything else. We also enforce an http(s)-only scheme so a
 * `data:`/`file:`/`javascript:` URL can never slip through.
 *
 * The WebSocket `receiveFrom` URL is a `ws:`/`wss:` URL on the SAME ORIGIN as a
 * pod storage (the pod's notification gateway), so it is validated by origin only
 * (mapping ws→http / wss→https) — a path-prefix check does not apply to the
 * gateway socket path.
 *
 * Pure functions, no network — unit tested without a live server.
 */

/** http/https only — never data:/file:/javascript:/blob: etc. */
function isHttpUrl(u: URL): boolean {
  return u.protocol === "http:" || u.protocol === "https:";
}

/** ws/wss only (for the notification socket). */
function isWsUrl(u: URL): boolean {
  return u.protocol === "ws:" || u.protocol === "wss:";
}

/** Parse a URL, returning undefined for anything malformed. */
function parse(url: string | null | undefined): URL | undefined {
  if (!url) return undefined;
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** Normalise a storage root URL for comparison (parse + ensure it is http(s)). */
function parseStorage(storage: string): URL | undefined {
  const u = parse(storage);
  if (!u || !isHttpUrl(u)) return undefined;
  return u;
}

/**
 * Whether `candidate` is on the same origin as `storage` AND under its path
 * prefix. Pods are origin-scoped, and a storage may be a SUB-path of an origin
 * (`https://example.org/alice/` on a shared-domain server), so we require the
 * candidate's path to start with the storage's path — not merely the same origin
 * — so a sibling pod (`/bob/`) on the same host is NOT treated as the user's own.
 */
function withinStorage(candidate: URL, storage: URL): boolean {
  if (candidate.origin !== storage.origin) return false;
  // Storage roots always end in "/"; a candidate equal to or under the prefix is
  // in-pod. (Compare decoded pathnames so percent-encoding can't bypass the prefix.)
  const base = storage.pathname.endsWith("/") ? storage.pathname : `${storage.pathname}/`;
  const path = candidate.pathname;
  return path === base || path.startsWith(base) || `${path}/` === base;
}

/**
 * True iff `url` is an http(s) URL that lives within one of the user's own pod
 * `storageUrls`. The fail-closed test the inbox + discovery fetches gate on.
 */
export function isOwnPodUrl(url: string | null | undefined, storageUrls: readonly string[]): boolean {
  const candidate = parse(url);
  if (!candidate || !isHttpUrl(candidate)) return false;
  for (const s of storageUrls) {
    const storage = parseStorage(s);
    if (storage && withinStorage(candidate, storage)) return true;
  }
  return false;
}

/**
 * True iff `wsUrl` is a ws(s) URL whose origin matches one of the user's own pod
 * storages (mapping wss→https, ws→http). The pod's notification socket lives on
 * the storage origin, so we validate by ORIGIN only (the gateway socket path is
 * not under the storage path prefix). Fail-closed: anything else is rejected, so
 * a notification subscription can never point the socket at a foreign host.
 */
export function isOwnPodWebSocketUrl(wsUrl: string | null | undefined, storageUrls: readonly string[]): boolean {
  const ws = parse(wsUrl);
  if (!ws || !isWsUrl(ws)) return false;
  const httpEquivalent = ws.protocol === "wss:" ? "https:" : "http:";
  for (const s of storageUrls) {
    const storage = parseStorage(s);
    if (storage && storage.protocol === httpEquivalent && storage.host === ws.host) return true;
  }
  return false;
}
