// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see prod-solid-server docs/MODEL-PROVENANCE.md
/**
 * SSRF-safe fetch wrapper.
 *
 * The Matrix homeserver and Discourse forum base URLs are USER-CONFIGURED, so an
 * attacker (or a careless user) could point them at an internal target
 * (`http://169.254.169.254/`, `http://localhost:…`, an RFC1918 host). Every
 * outbound request this package makes goes through {@link safeFetch}, which:
 *
 *   1. requires `https:` (no `http:`, no `file:`/`data:`/other schemes);
 *   2. rejects credentials embedded in the URL (`https://user:pass@host`);
 *   3. blocks literal-IP hosts in private / loopback / link-local / reserved
 *      ranges (IPv4 + IPv6), incl. the cloud metadata IP, AND known local /
 *      internal HOSTNAMES (`localhost`, `*.local`, `*.internal`, …);
 *   4. caps the response body size (default 5 MiB): a `Content-Length` pre-check
 *      rejects a declared-oversize body up front, and the body is then read
 *      INCREMENTALLY from the response stream, aborting the instant the byte
 *      count passes the cap — so a lying/absent `Content-Length` cannot force an
 *      unbounded buffer (a `text()` fallback + post-read cap covers seams that
 *      expose no stream);
 *   5. applies a request timeout (default 15 s) via AbortController that stays
 *      ACTIVE THROUGH THE BODY READ — a server can send headers fast then dribble
 *      the body forever, so clearing the timer at headers (a classic bug) would
 *      let the read hang; the timer is cleared only after the body resolves;
 *   6. does NOT follow redirects automatically (`redirect: "manual"`) — a 30x to
 *      an internal host is a classic SSRF bypass; a redirect is surfaced as an
 *      error rather than silently chased.
 *
 * It does NOT resolve DNS itself (that needs a Node-only resolver and would break
 * the browser); literal-IP hosts + local hostnames are blocked synchronously, and
 * DNS-name targets are constrained by the https-only + no-redirect + timeout +
 * size-cap envelope. For a hard guarantee against DNS-rebinding to internal hosts,
 * a server-side deployment should additionally pin DNS (cf. prod-solid-server's
 * webidResolver).
 *
 * The `fetch` itself is INJECTED (`opts.fetch`) so the suite's auth-`fetch` seam
 * and tests can substitute it — the default is the global `fetch`.
 */

/** A chunk yielded by a streamed response body — bytes or a decoded string. */
export type BodyChunk = Uint8Array | string;

/**
 * The response shape `safeFetch` consumes. `body` is OPTIONAL: when present (the
 * real WHATWG `fetch` returns a `ReadableStream` here, which is async-iterable in
 * Node 18+), `safeFetch` reads it INCREMENTALLY and aborts the moment the byte
 * count exceeds `maxBytes` — so an untrusted oversized body is never fully
 * buffered (a memory-DoS guard). When `body` is absent, it falls back to
 * `text()` with a post-read byte cap.
 */
export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  body?: AsyncIterable<BodyChunk> | null;
}

/** A minimal structural fetch type so we don't depend on lib.dom's exact shape. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: "follow" | "manual" | "error";
    signal?: AbortSignal;
  },
) => Promise<SafeFetchResponse>;

export interface SafeFetchOptions {
  /** Injected fetch (auth-fetch seam / test stub). Defaults to global `fetch`. */
  fetch?: FetchLike;
  /** Request timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Max response body size in bytes. Default 5 MiB. */
  maxBytes?: number;
}

export class SafeFetchError extends Error {
  readonly code:
    | "scheme"
    | "credentials"
    | "blocked-host"
    | "redirect"
    | "timeout"
    | "too-large"
    | "http"
    | "network";
  readonly status?: number;
  constructor(code: SafeFetchError["code"], message: string, status?: number) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** True if a host is a bracketed/bare IPv4 or IPv6 literal we can range-check. */
function isIpLiteral(host: string): boolean {
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIpv4(h) || h.includes(":");
}

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * True if a literal IP host is in a private / loopback / link-local / reserved
 * range (IPv4 + the common IPv6 cases). Non-literal hostnames return false here
 * (they pass the literal check; the https-only + no-redirect envelope still
 * applies). Conservative: anything we cannot confidently classify as PUBLIC and
 * is a literal IP is blocked.
 */
function isBlockedIp(host: string): boolean {
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  if (isIpv4(h)) {
    const [a, b] = h.split(".").map(Number) as [number, number, number, number];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this network"
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast + reserved 224.0.0.0/3
    return false;
  }

  // IPv6 (lower-cased)
  const v6 = h.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true; // loopback / unspecified
  if (v6.startsWith("fe80")) return true; // link-local
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // unique-local fc00::/7
  if (v6.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4.
  const mapped = v6.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped?.[1]) {
    return isBlockedIp(mapped[1]);
  }
  return true; // unknown IPv6 literal → fail closed
}

/**
 * True if a (non-literal-IP) hostname is a well-known LOCAL / internal name that
 * must never be fetched even before DNS resolution. This is a name-based block
 * complementing {@link isBlockedIp} (which only sees literal IPs).
 *
 * It is NOT a substitute for DNS-pinning: a public DNS name that *resolves* to a
 * private address still slips past a browser-safe (no-DNS) check. A server-side
 * deployment that wants a hard guarantee against DNS-rebinding should layer a
 * DNS-pinned resolver on top (see prod-solid-server's webidResolver). Here we
 * block the obvious local names + reserved special-use TLDs (RFC 6761/8375).
 */
function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, ""); // strip a trailing dot (FQDN root)
  if (h === "localhost" || h === "ip6-localhost" || h === "ip6-loopback") {
    return true;
  }
  // Reserved / internal special-use labels (RFC 6761/8375) that must never leave
  // the box — stored WITHOUT a leading dot. Each is blocked both as a bare
  // single-label name (`https://internal/`) AND as a suffix (`https://x.internal/`).
  const blockedLabels = [
    "localhost",
    "local", // mDNS
    "internal", // common internal convention + GCP
    "intranet",
    "lan",
    "home.arpa", // RFC 8375 home networks
    "in-addr.arpa",
    "ip6.arpa",
  ];
  return blockedLabels.some((label) => h === label || h.endsWith(`.${label}`));
}

/**
 * Validate a target URL for SSRF safety and return the parsed URL. Throws
 * {@link SafeFetchError} on any violation. Exported for reuse by callers that
 * want to validate a user-supplied base URL up front (e.g. at config time).
 */
export function assertSafeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("network", `invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new SafeFetchError("scheme", `only https: URLs are allowed (got ${url.protocol})`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new SafeFetchError("credentials", "URLs must not embed credentials (user:pass@host)");
  }
  if (isIpLiteral(url.hostname)) {
    if (isBlockedIp(url.hostname)) {
      throw new SafeFetchError(
        "blocked-host",
        `refusing to fetch a private/reserved address: ${url.hostname}`,
      );
    }
  } else if (isBlockedHostname(url.hostname)) {
    throw new SafeFetchError(
      "blocked-host",
      `refusing to fetch a local/internal hostname: ${url.hostname}`,
    );
  }
  return url;
}

/**
 * Perform an SSRF-guarded GET (or other method) and return the response text.
 * The body is read in a size-capped fashion; the call times out after
 * `timeoutMs`. Throws {@link SafeFetchError} on any guard violation, non-2xx, a
 * redirect, timeout, or an oversize body.
 */
export async function safeFetch(
  rawUrl: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
  opts: SafeFetchOptions = {},
): Promise<{ status: number; body: string }> {
  const url = assertSafeUrl(rawUrl);
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof doFetch !== "function") {
    throw new SafeFetchError("network", "no fetch implementation available");
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // ONE AbortController + timer guards the WHOLE call — connect, header read AND
  // body read. We deliberately keep the timer running until after `res.text()`
  // resolves: a server can send headers fast then dribble the body forever, so
  // clearing the timeout once headers arrive (a classic bug) would let the body
  // read hang indefinitely. The timer is cleared only in the outer finally.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await doFetch(url.toString(), {
        method: init.method ?? "GET",
        headers: init.headers,
        body: init.body,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new SafeFetchError("timeout", `request timed out after ${timeoutMs}ms`);
      }
      throw new SafeFetchError(
        "network",
        `network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // A 30x (manual redirect) appears as an opaque-ish response; surface it as
    // an error rather than chasing it to a possibly-internal Location.
    if (res.status >= 300 && res.status < 400) {
      throw new SafeFetchError(
        "redirect",
        `refusing to follow redirect (status ${res.status})`,
        res.status,
      );
    }
    if (!res.ok) {
      throw new SafeFetchError("http", `HTTP ${res.status} ${res.statusText}`, res.status);
    }

    // Cheap pre-check: reject a body the server DECLARES to be oversized before
    // we read a single byte of it (defends against a huge announced body).
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new SafeFetchError(
        "too-large",
        `declared body ${declared} bytes exceeds cap of ${maxBytes}`,
      );
    }

    // Read the body with the timeout STILL ACTIVE (see above). Prefer the
    // STREAMING path: read chunks incrementally and bail the instant the byte
    // count exceeds maxBytes, so a lying/absent Content-Length cannot force us to
    // buffer an unbounded body (memory-DoS guard). Fall back to text() only when
    // the seam exposes no stream (a minimal fetch / the test stub).
    const text = res.body
      ? await readStreamCapped(res.body, maxBytes, controller, timeoutMs)
      : await readTextCapped(res, maxBytes, controller, timeoutMs);
    return { status: res.status, body: text };
  } finally {
    clearTimeout(timer);
  }
}

/** Read a streamed body incrementally, throwing `too-large` once over `maxBytes`. */
async function readStreamCapped(
  body: AsyncIterable<BodyChunk>,
  maxBytes: number,
  controller: AbortController,
  timeoutMs: number,
): Promise<string> {
  const decoder = new TextDecoder("utf-8");
  const parts: string[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      const byteLen =
        typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.byteLength;
      total += byteLen;
      if (total > maxBytes) {
        // Stop reading immediately — do not buffer the rest of the body.
        controller.abort();
        throw new SafeFetchError("too-large", `response body exceeds cap of ${maxBytes} bytes`);
      }
      parts.push(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
    }
    parts.push(decoder.decode()); // flush any multi-byte remainder
    return parts.join("");
  } catch (err) {
    if (err instanceof SafeFetchError) {
      throw err;
    }
    if (controller.signal.aborted) {
      throw new SafeFetchError("timeout", `reading response body timed out after ${timeoutMs}ms`);
    }
    throw new SafeFetchError(
      "network",
      `error reading body: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Fallback: buffer via text() then enforce the byte cap (no stream available). */
async function readTextCapped(
  res: SafeFetchResponse,
  maxBytes: number,
  controller: AbortController,
  timeoutMs: number,
): Promise<string> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    if (controller.signal.aborted) {
      throw new SafeFetchError("timeout", `reading response body timed out after ${timeoutMs}ms`);
    }
    throw new SafeFetchError(
      "network",
      `error reading body: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new SafeFetchError("too-large", `response body exceeds cap of ${maxBytes} bytes`);
  }
  return text;
}

/** Parse a safe-fetched JSON body, throwing a typed error on malformed JSON. */
export async function safeFetchJson<T>(
  rawUrl: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  opts: SafeFetchOptions = {},
): Promise<T> {
  const { body } = await safeFetch(rawUrl, init, opts);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new SafeFetchError("network", "response was not valid JSON");
  }
}
