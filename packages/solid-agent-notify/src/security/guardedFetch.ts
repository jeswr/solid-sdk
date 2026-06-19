// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * guardedFetch.ts — THE SINGLE EGRESS CHOKEPOINT for solid-agent-notify.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * This is the ONLY permitted path for fetching an attacker-influenced URL in this package. Every
 * cross-pod dereference — a recipient's WebID profile (GET), their inbox listing (GET), a single
 * notification (GET), and the LDN POST that delivers a notification — MUST go through `guardedFetch`.
 * Calling the global `fetch`, `undici.fetch`, or `undici.request` directly for an external URL is
 * FORBIDDEN; `scripts/check-no-raw-fetch.mjs` (`npm run check:fetch`) fails the build otherwise.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * THE SSRF MECHANISM IS DELEGATED to the shared `@jeswr/guarded-fetch` library (`./node` entry):
 * `createNodeGuardedFetch` does the URL classification, the cloud-internal hostname denylist, the
 * DNS-resolve-all-records-then-validate rebinding check, the connect-time DNS-PINNING that closes
 * the lookup→connect TOCTOU (undici `Agent({ connect: { lookup } })`), the per-hop redirect
 * re-validation (scheme downgrade + loop rejection, cross-origin credential + body strip), the
 * scheme/userinfo/port gates, and the overall timeout. That mechanism is consolidated, single-
 * reviewed code shared with federation-client / community-feeds / the prod-solid-server reference —
 * NO bespoke SSRF logic lives in this package any more. This wrapper keeps ONLY agent-notify's own
 * POSTURE on top of the shared mechanism:
 *
 *   - The stricter cloud-internal denylist (`FETCH_HOSTNAME_DENYLIST` — adds `localhost` /
 *     `*.localhost` / `*.local`, refused unconditionally), threaded in via `hostnameDenylist`.
 *   - POST refuses to follow ANY 3xx (confused-deputy fail-closed): we force `maxRedirects: 0` for
 *     a POST AND throw if the final response is a 3xx with a Location (guarded-fetch would otherwise
 *     follow a same-host POST redirect with a body/credential strip — we want a hard refusal).
 *   - The RDF content-type allowlist on the FINAL GET response, with `skipContentTypeAllowlist` for
 *     the LDN POST receipt.
 *   - The bespoke `GuardedFetchResult` shape ({ response, finalUrl, contentType, text, bytes,
 *     status }) consumers destructure, the explicit `BodyTooLargeError` type via the bounded
 *     reader, and the body-irrelevant-status (304/204/205/≥400) empty-body short-circuit.
 *   - The conditional-request headers, the descriptive User-Agent, and the RDF Accept.
 *
 * Defence-in-depth, every step fails closed. The DNS-pinning + per-hop re-classification +
 * rebinding refusal are guarded-fetch's; the POST-no-redirect, content-type allowlist, and bounded
 * `BodyTooLargeError` body read are this wrapper's.
 */
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import {
  FETCH_HOSTNAME_DENYLIST,
  FETCH_TIMEOUT_MS,
  FETCH_USER_AGENT,
  MAX_BYTES_PROFILE,
  MAX_REDIRECTS,
  RDF_ACCEPT,
  RDF_CONTENT_TYPES,
} from "../config.js";
import { BodyTooLargeError, readBoundedBytes } from "./body.js";
import type { LookupAddress } from "./ssrf.js";
import { SsrfError } from "./ssrf.js";

export { SsrfError };
export { BodyTooLargeError };

/** Raised by guardedFetch for non-SSRF failures (bad scheme/port, disallowed content-type, redirect
 * cap, redirect loop, scheme downgrade, a refused POST redirect, network error). SSRF failures
 * throw {@link SsrfError}. */
export class GuardedFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GuardedFetchError";
  }
}

export interface GuardedFetchOptions {
  /** HTTP method. Default `GET`. A `POST` sends `body` and refuses to follow ANY redirect. */
  readonly method?: "GET" | "POST";
  /** Request body (POST only). */
  readonly body?: string;
  /** Accept header to send. Default: the RDF accept set. */
  readonly accept?: string;
  /** Additional request headers (the guard always sets User-Agent + Accept; these merge over them). */
  readonly headers?: Record<string, string>;
  /** Max response body bytes. Default `MAX_BYTES_PROFILE` from config. */
  readonly maxBytes?: number;
  /** Total timeout (ms) spanning fetch + redirects + body. Default `FETCH_TIMEOUT_MS` from config. */
  readonly timeoutMs?: number;
  /** Max redirects followed (GET only; a POST never follows a redirect). Default `MAX_REDIRECTS`. */
  readonly maxRedirects?: number;
  /** Allowed final-response content-types (bare media type). Default: the RDF set. */
  readonly allowedContentTypes?: readonly string[];
  /**
   * Skip the content-type allowlist on the final response (used for an LDN POST whose receipt is
   * not RDF we parse). The body is still bounded; we just do not refuse a non-RDF content-type.
   */
  readonly skipContentTypeAllowlist?: boolean;
  /**
   * TEST/DEV ONLY: permit loopback (127.0.0.1, ::1) targets and `http:` to a loopback host. NEVER
   * set in production — this is the documented test hook so a fixture server on 127.0.0.1 is
   * reachable. Production code MUST leave this false (the default).
   */
  readonly allowLoopback?: boolean;
  /** Inject a DNS lookup (tests — e.g. the rebinding stub). Defaults to `node:dns/promises`. */
  readonly dnsLookup?: (host: string) => Promise<LookupAddress[]>;
  /** Conditional request validators (forwarded as If-None-Match / If-Modified-Since). */
  readonly conditional?: {
    readonly etag?: string;
    readonly lastModified?: string;
  };
}

export interface GuardedFetchResult {
  /** The final (post-redirect) response. Body has NOT been read off it; use `text`/`bytes`. */
  readonly response: Response;
  /** The final resolved URL (after redirects). */
  readonly finalUrl: string;
  /** The bare media type of the final response (lower-cased, no parameters). */
  readonly contentType: string;
  /** The bounded response body as UTF-8 text. */
  readonly text: string;
  /** The bounded response body as raw bytes. */
  readonly bytes: Uint8Array;
  /** HTTP status of the final response. */
  readonly status: number;
}

/**
 * The marker substring in `@jeswr/guarded-fetch`'s body-cap refusal message (it reports both the
 * declared-Content-Length and the streamed-overflow cap as `Response body for <url> exceeds cap
 * (...)`, thrown as an SsrfError). The wrapper maps that to the public {@link BodyTooLargeError}
 * type — see {@link classifyGuardError} — so the over-cap error class consumers/tests rely on is
 * preserved across the rewire. (The dep is PINNED to an exact commit, so the string cannot drift.)
 */
const BODY_CAP_MARKER = "exceeds cap";

/**
 * Fetch an attacker-influenced URL with full SSRF defence-in-depth. Returns the final response, the
 * resolved URL, the content-type, and the bounded body. Throws {@link SsrfError} for an SSRF refusal
 * (private/loopback/denied target, rebinding), {@link GuardedFetchError} for any other guard failure
 * (bad scheme/port, redirect cap/loop/downgrade, refused POST redirect, disallowed content-type,
 * network/timeout), or {@link BodyTooLargeError} for an over-cap body.
 */
export async function guardedFetch(
  rawUrl: string,
  opts: GuardedFetchOptions = {}
): Promise<GuardedFetchResult> {
  const method = opts.method ?? "GET";
  const allowLoopback = opts.allowLoopback ?? false;
  const maxBytes = opts.maxBytes ?? MAX_BYTES_PROFILE;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  // A POST refuses ALL redirects (confused-deputy fail-closed) → force 0 hops at the library too.
  const maxRedirects =
    method === "POST" ? 0 : (opts.maxRedirects ?? MAX_REDIRECTS);
  const accept = opts.accept ?? RDF_ACCEPT;
  const skipContentTypeAllowlist = opts.skipContentTypeAllowlist ?? false;
  const allowedContentTypes = (
    opts.allowedContentTypes ?? RDF_CONTENT_TYPES
  ).map((t) => t.toLowerCase());

  const headers: Record<string, string> = {
    accept,
    "user-agent": FETCH_USER_AGENT,
    ...(opts.conditional?.etag
      ? { "if-none-match": opts.conditional.etag }
      : {}),
    ...(opts.conditional?.lastModified
      ? { "if-modified-since": opts.conditional.lastModified }
      : {}),
    ...(opts.headers ?? {}),
  };

  // Up-front gate on the FIRST URL (scheme / userinfo / port / malformed), throwing
  // GuardedFetchError — this preserves the historical agent-notify error TAXONOMY: a malformed
  // URL, a non-http(s)/http-without-loopback scheme, userinfo, or a non-443 production port have
  // always surfaced from `guardedFetch()` as GuardedFetchError (the policy error), distinct from
  // the SsrfError SECURITY-boundary refusal (private/loopback/denied/rebinding target). The shared
  // guarded-fetch library collapses these into SsrfError; we keep the taxonomy stable for callers
  // that distinguish the two public error types. The library STILL re-applies every one of these
  // checks (plus per-hop redirect re-validation) — this is a belt-and-braces front gate, not the
  // sole enforcement.
  assertSchemeAndPort(parseUrl(rawUrl), allowLoopback);

  // Build the shared SSRF-pinning fetch with THIS package's stricter posture. The injected
  // `dnsLookup` (tests' rebinding stub) is mapped to BOTH the guard's URL-level classification
  // (`dnsLookup`) AND the connect-time pinning resolver (`resolveAll`) so the URL check and the pin
  // see the SAME resolver — a rebinding stub still drives the connect-time pin in tests. The
  // library does the SSRF refusal (SsrfError), the redirect re-validation, the DNS-pinning, the
  // scheme/userinfo/port gates, the timeout, AND the body cap. We do NOT pass `allowedContentTypes`
  // (the RDF allowlist + its bespoke GuardedFetchError live here).
  //
  // BODY CAP: pass THIS call's exact `maxBytes` so the library is the single body reader, capping at
  // the per-call limit (no second buffering pass). The library reads/buffers the body BEFORE we see
  // the response, so the most we ever buffer is `maxBytes` — minimising exposure (vs an
  // over-generous outer cap that would buffer megabytes of a hostile error page before we discard
  // it). An over-cap body throws the library's body-cap SsrfError, which classifyGuardError maps to
  // the public BodyTooLargeError. NOTE the one consumer-invisible refinement this introduces: a
  // body-irrelevant status (>=400/204/205/304) or a disallowed content-type whose BODY exceeds
  // `maxBytes` now fails with BodyTooLargeError instead of the old short-circuit
  // (return-empty / content-type GuardedFetchError) — because the library caps the body before this
  // wrapper inspects status/content-type. This is strictly SAFER (the body is still bounded and the
  // over-cap body is refused, not returned) and consumer-invisible: read.ts/discover.ts/send.ts all
  // treat any thrown guard error and any non-2xx status identically (empty list / NotificationSendError).
  const nodeFetch = createNodeGuardedFetch({
    allowLoopback,
    hostnameDenylist: FETCH_HOSTNAME_DENYLIST,
    maxRedirects,
    timeoutMs,
    maxBytes,
    ...(opts.dnsLookup !== undefined
      ? { dnsLookup: opts.dnsLookup, resolveAll: opts.dnsLookup }
      : {}),
  });

  let res: Response;
  try {
    res = await nodeFetch(rawUrl, {
      method,
      headers,
      ...(method === "POST" && opts.body !== undefined
        ? { body: opts.body }
        : {}),
      redirect: "manual",
    });
  } catch (error: unknown) {
    throw classifyGuardError(error, rawUrl, method);
  }

  const finalUrl = res.url || rawUrl;
  const status = res.status;

  // POST confused-deputy fail-closed: a POST must never follow ANY 3xx. With maxRedirects forced to
  // 0 the library returns the 3xx as-is; if it carries a Location we refuse it explicitly (so an
  // authenticated POST + body can never be bounced to a blocked origin).
  if (method === "POST" && status >= 300 && status < 400) {
    const location = res.headers.get("location");
    if (location) {
      void res.body?.cancel().catch(() => {});
      throw new GuardedFetchError(
        `Refusing to follow a ${status} redirect on a POST: ${finalUrl} → ${location}.`
      );
    }
  }

  const contentType =
    (res.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";

  // Body-irrelevant statuses bypass the content-type allowlist and return an empty bounded body,
  // letting the caller act on `status` (304/204/205 carry no body; >=400 is an error page, never
  // RDF we parse; a 2xx POST receipt is bounded but not allowlisted). The body is cancelled, not
  // read, so this does NOT widen the SSRF surface.
  if (status === 304 || status === 204 || status === 205 || status >= 400) {
    void res.body?.cancel().catch(() => {});
    return {
      response: res,
      finalUrl,
      contentType,
      text: "",
      bytes: new Uint8Array(0),
      status,
    };
  }

  if (!skipContentTypeAllowlist && !allowedContentTypes.includes(contentType)) {
    void res.body?.cancel().catch(() => {});
    throw new GuardedFetchError(
      `Disallowed content-type "${contentType || "(none)"}" for ${finalUrl}; expected one of ${allowedContentTypes.join(", ")}.`
    );
  }

  // The library already capped + buffered the body at `maxBytes`, so this read of the buffered body
  // cannot exceed the cap; readBoundedBytes is kept as defence-in-depth (and to produce the bytes),
  // and an over-cap body was already refused inside nodeFetch above (mapped to BodyTooLargeError by
  // classifyGuardError). A BodyTooLargeError here would only fire if the buffered body somehow still
  // exceeded the cap — preserved as the public type either way.
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBytes(res, { maxBytes });
  } catch (error: unknown) {
    if (error instanceof BodyTooLargeError) throw error;
    throw new GuardedFetchError(
      `Failed reading body for ${finalUrl}: ${reason(error)}`,
      { cause: error }
    );
  }
  const text = new TextDecoder("utf-8").decode(bytes);

  return { response: res, finalUrl, contentType, text, bytes, status };
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new GuardedFetchError(`URL is malformed: ${raw}.`);
  }
}

/**
 * Per-hop scheme + port + userinfo + downgrade gate, throwing {@link GuardedFetchError} (the policy
 * error, not the SSRF security boundary). Mirrors the historical agent-notify gate (same 3-arg
 * signature) so the public error TAXONOMY is unchanged: https-only (http: only under
 * `allowLoopback`); a scheme-downgrade redirect (https → http) rejected when `prevWasHttps`; no
 * userinfo; 443 always, any port under loopback (a fixture binds an ephemeral port).
 *
 * `guardedFetch` calls this ONLY on the FIRST URL (so `prevWasHttps` is false there); the per-hop
 * redirect re-validation — including the downgrade refusal — is owned end-to-end by
 * `@jeswr/guarded-fetch` (this is belt-and-braces, not the sole enforcement). The `prevWasHttps`
 * parameter + the downgrade branch are retained so the helper stays a faithful, exhaustively
 * unit-testable front gate (it is exported for that purpose; it is NOT part of the package's public
 * `.` entry — the only declared `exports` subpath).
 */
export function assertSchemeAndPort(
  url: URL,
  allowLoopback: boolean,
  prevWasHttps = false
): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new GuardedFetchError(
      `URL must be http/https (got ${url.protocol}).`
    );
  }
  if (url.protocol === "http:" && !allowLoopback) {
    throw new GuardedFetchError(
      `URL must be https: (got http: ${url.host}). http: is permitted only under allowLoopback (dev/tests).`
    );
  }
  if (prevWasHttps && url.protocol === "http:") {
    throw new GuardedFetchError(
      `Refusing redirect scheme downgrade (https → http): ${url.host}.`
    );
  }
  if (url.username || url.password) {
    throw new GuardedFetchError("URL must not carry userinfo.");
  }
  // Port gate. In PRODUCTION (allowLoopback=false) an explicit port must be 443 (https). Under
  // allowLoopback any port is permitted: a fixture server binds an ephemeral loopback port, and the
  // SSRF guard constrains the resolved address to loopback. `url.port` is "" for the scheme default.
  if (!allowLoopback && url.port !== "") {
    const port = Number(url.port);
    if (!(url.protocol === "https:" && port === 443)) {
      throw new GuardedFetchError(
        `URL port not allowed (${url.port}); only 443 (https) is permitted in production.`
      );
    }
  }
}

/**
 * Guarded-fetch's REDIRECT-MANAGEMENT refusal messages. These are the non-SSRF-boundary policy
 * failures the shared library reports as `SsrfError` but which agent-notify has always surfaced as
 * {@link GuardedFetchError}: the redirect cap, a redirect loop, a malformed `Location`, and a
 * scheme-downgrade (https → http) redirect — the pre-rewire wrapper threw GuardedFetchError for the
 * downgrade hop (via assertSchemeAndPort), so it is mapped here to keep the public taxonomy stable.
 * (The TRUE SSRF-boundary refusals — a private/loopback/denied/rebinding TARGET — arrive as
 * `SsrfError` and are re-thrown UNCHANGED so callers still see `instanceof SsrfError`.) Keyed on
 * stable message prefixes the library emits; the guarded-fetch dep is PINNED to an exact commit, so
 * these strings cannot drift under us.
 */
const REDIRECT_MANAGEMENT_PREFIXES = [
  "Too many redirects",
  "Redirect loop detected",
  "Redirect to a malformed Location",
  "Refusing redirect scheme downgrade",
] as const;

/**
 * Map a thrown guarded-fetch error to agent-notify's public error taxonomy:
 *  - a BODY-CAP `SsrfError` → {@link BodyTooLargeError} (the public over-cap type, FIRST so it wins
 *    regardless of method/status);
 *  - a TIMEOUT or redirect-management `SsrfError` → {@link GuardedFetchError} (policy/non-SSRF);
 *  - for a POST, a redirect-management `SsrfError` → the confused-deputy {@link GuardedFetchError}
 *    (a POST refuses to follow ANY 3xx, so the `maxRedirects:0` cap firing IS the refusal);
 *  - any other `SsrfError` (private/loopback/denied/rebinding TARGET) → re-thrown UNCHANGED so
 *    `instanceof SsrfError` still holds at the call site;
 *  - anything else (a genuine network error) → {@link GuardedFetchError}.
 *
 * Exported for exhaustive unit testing of the error-taxonomy mapping (it is NOT part of the
 * package's public `.` entry — the only declared `exports` subpath).
 */
export function classifyGuardError(
  error: unknown,
  rawUrl: string,
  method: "GET" | "POST"
): Error {
  if (error instanceof SsrfError) {
    const msg = error.message;
    // Body cap FIRST: the library reads/caps the body before returning, so an over-cap body (any
    // status / content-type) surfaces here as its body-cap SsrfError — map it to the public
    // BodyTooLargeError so the over-cap error TYPE is unchanged across the rewire.
    if (msg.includes(BODY_CAP_MARKER)) {
      return new BodyTooLargeError(msg);
    }
    const isTimeout = msg.startsWith("Fetch timed out");
    const isRedirectMgmt = REDIRECT_MANAGEMENT_PREFIXES.some((p) =>
      msg.startsWith(p)
    );
    if (method === "POST" && isRedirectMgmt) {
      return new GuardedFetchError(
        `Refusing to follow a redirect on a POST: ${rawUrl} (${msg}).`,
        { cause: error }
      );
    }
    if (isTimeout) {
      return new GuardedFetchError(`Fetch timed out for ${rawUrl}: ${msg}.`, {
        cause: error,
      });
    }
    if (isRedirectMgmt) {
      return new GuardedFetchError(msg, { cause: error });
    }
    // A true SSRF-boundary refusal — preserve the public SsrfError type.
    return error;
  }
  return new GuardedFetchError(`Fetch failed for ${rawUrl}: ${reason(error)}`, {
    cause: error,
  });
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
