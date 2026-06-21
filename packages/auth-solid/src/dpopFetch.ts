// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The DPoP HTTP seam — the security-critical core of `@jeswr/auth-solid`.
 *
 * Auth.js / `@auth/core` does NOT itself perform DPoP: it builds a plain OAuth token request via
 * `oauth4webapi`. Solid-OIDC requires sender-constrained (DPoP-bound) tokens (RFC 9449). So this
 * module supplies BOTH places DPoP is needed, routing all proof generation through the suite's
 * vetted `@jeswr/solid-dpop` (jose-only, ES256 asymmetric) — we hand-roll no crypto:
 *
 *   1. {@link buildDpopCustomFetch} — the `[customFetch]` Auth.js calls for ALL OAuth endpoint
 *      HTTP (discovery, JWKS, token, userinfo). It DISCRIMINATES: it attaches a DPoP proof ONLY to
 *      the token-endpoint leg (a POST carrying a form-urlencoded grant body — the robust signal,
 *      since the token URL is only known after discovery). The token-endpoint proof carries NO
 *      `ath` (RFC 9449 §4.2 — `ath` is for requests that PRESENT an access token; the token request
 *      does not). It handles the §8 `use_dpop_nonce` retry exactly once. Discovery / JWKS /
 *      userinfo legs pass straight through untouched.
 *
 *   2. {@link buildSolidDpopFetch} (exported as `solidDpopFetch`) — a DPoP-attaching authed `fetch`
 *      for POD (resource-server) requests, built from a persisted {@link SolidAuthState}. Each
 *      request mints a proof bound to the access token via `ath` (RFC 9449 §4.2 / §6.1), sets
 *      `Authorization: DPoP <token>` + `DPoP: <proof>`, and handles the resource-server §8
 *      `DPoP-Nonce` (401) retry once.
 *
 * Transport guard (both paths): never attach a DPoP proof / access token to a plaintext `http:`
 * URL unless `allowInsecure` is set for a loopback host — so a token is never sent over the wire in
 * the clear. We never log tokens, proofs, keys, or request bodies.
 */

import { createDpopProof, type DpopKeyPair, importDpopKeyPairJwk } from "@jeswr/solid-dpop";
import type { JWK } from "jose";
import type { FetchLike, SolidAuthState } from "./types.js";

/** Cap retries at exactly one extra attempt for the RFC 9449 §8 DPoP-nonce challenge. */
const NONCE_RETRY_LIMIT = 1;

/**
 * True iff `hostname` (as returned by `URL.hostname`) is a loopback host. Handles `localhost`, the
 * whole `127.0.0.0/8` IPv4 loopback range, and IPv6 `::1` — including Node's BRACKETED IPv6 form
 * (`URL.hostname` returns `[::1]`).
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost") {
    return true;
  }
  const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (unbracketed === "::1") {
    return true;
  }
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(unbracketed)) {
    const octets = unbracketed.split(".").map(Number);
    return octets.every((o) => o >= 0 && o <= 255);
  }
  return false;
}

/**
 * Assert a URL is https (or http-on-loopback only when `allowInsecure`). Throws via `makeError`.
 * This is the load-bearing guard that keeps the DPoP token/proof off a plaintext channel.
 */
export function assertSecureTransport(
  rawUrl: string,
  allowInsecure: boolean,
  makeError: (msg: string) => Error,
): void {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw makeError(`not a valid URL: ${rawUrl}`);
  }
  if (u.protocol === "https:") {
    return;
  }
  if (u.protocol === "http:") {
    if (allowInsecure && isLoopbackHost(u.hostname)) {
      return;
    }
    throw makeError(
      `refusing an insecure http: URL (${rawUrl}). https is required; http: is permitted only for a ` +
        "loopback host with `allowInsecure: true`.",
    );
  }
  throw makeError(`unsupported URL scheme in ${rawUrl} (expected https:).`);
}

/** Resolve a `customFetch`/`fetch` input + init to the effective request URL string. */
function effectiveUrl(input: URL | RequestInfo): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  // A Request always carries an absolute `.url`.
  return input.url;
}

/** Resolve the effective HTTP method from a `customFetch`/`fetch` input + init. */
function effectiveMethod(input: URL | RequestInfo, init: RequestInit | undefined): string {
  const fromInit = init?.method;
  if (typeof fromInit === "string" && fromInit.length > 0) {
    return fromInit.toUpperCase();
  }
  if (typeof input !== "string" && !(input instanceof URL)) {
    return (input.method || "GET").toUpperCase();
  }
  return "GET";
}

/** Lower-cased value of a header from a `HeadersInit` (handles Headers / array / record). */
function headerValue(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  const target = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(target) ?? undefined;
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      if (k.toLowerCase() === target) {
        return v;
      }
    }
    return undefined;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return v;
    }
  }
  return undefined;
}

/**
 * Read the effective content-type from BOTH the init headers and (if `input` is a `Request`) the
 * Request's headers. Used to identify the token-endpoint leg (form-urlencoded body).
 */
function effectiveContentType(
  input: URL | RequestInfo,
  init: RequestInit | undefined,
): string | undefined {
  const fromInit = headerValue(init?.headers, "content-type");
  if (fromInit !== undefined) {
    return fromInit;
  }
  if (typeof input !== "string" && !(input instanceof URL)) {
    return input.headers.get("content-type") ?? undefined;
  }
  return undefined;
}

/**
 * Identify the OAuth TOKEN-endpoint leg. Auth.js routes discovery, JWKS, token and userinfo all
 * through the same `customFetch`, so we must DISCRIMINATE and only ever attach a token-request DPoP
 * proof to the token leg. The robust signal (the token URL is only known after discovery, and a
 * proxy could rewrite paths) is: a POST whose body is form-urlencoded — exactly how oauth4webapi
 * sends the `authorization_code` / `refresh_token` grant. Discovery + JWKS are GETs; userinfo
 * (when used) is a GET / a Bearer-/DPoP-less call here. A POST with a non-form body is not a token
 * request either. We therefore require POST AND a `application/x-www-form-urlencoded` content-type.
 */
function isTokenEndpointLeg(input: URL | RequestInfo, init: RequestInit | undefined): boolean {
  if (effectiveMethod(input, init) !== "POST") {
    return false;
  }
  const ct = effectiveContentType(input, init);
  return ct?.toLowerCase().includes("application/x-www-form-urlencoded") === true;
}

/** True iff a 4xx response is the RFC 9449 §8 `use_dpop_nonce` challenge (header or body error). */
async function isUseDpopNonceChallenge(res: Response): Promise<boolean> {
  if (res.status < 400 || res.status >= 500) {
    return false;
  }
  // The canonical signal is a `DPoP-Nonce` header. RFC 9449 §8 also defines an
  // `error":"use_dpop_nonce"` body for the token endpoint; treat either as the challenge.
  if (res.headers.get("dpop-nonce")) {
    return true;
  }
  try {
    const cloned = res.clone();
    const text = await cloned.text();
    if (text.length === 0) {
      return false;
    }
    const parsed = JSON.parse(text) as { error?: unknown };
    return parsed.error === "use_dpop_nonce";
  } catch {
    return false;
  }
}

/**
 * Build the Auth.js `[customFetch]` that injects a DPoP proof on the token-endpoint leg only.
 *
 * @param keyPair       the DPoP keypair the tokens are (will be) bound to.
 * @param underlying    the base fetch Auth.js passes its requests to (the global `fetch`, or an
 *                      injected SSRF-guarded / test fetch).
 * @param allowInsecure permit http: on loopback (dev OP). Default false (https-only).
 */
export function buildDpopCustomFetch(
  keyPair: DpopKeyPair,
  underlying: FetchLike,
  allowInsecure: boolean,
): typeof fetch {
  const dpopFetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    // Non-token legs (discovery / JWKS / userinfo): pass straight through, no DPoP.
    if (!isTokenEndpointLeg(input, init)) {
      return underlying(input as string | URL | Request, init);
    }

    const url = effectiveUrl(input);
    // SECURITY: never send a DPoP-bound token request over plaintext (it carries the client
    // credential / code). Enforce transport BEFORE minting any proof.
    assertSecureTransport(
      url,
      allowInsecure,
      (msg) =>
        new Error(`auth-solid customFetch: ${msg} — refusing the token request over plaintext.`),
    );

    const method = "POST";

    // The token-endpoint proof carries NO `ath` (RFC 9449 §4.2 — there is no access token being
    // presented yet). A fresh `jti` per proof (solid-dpop) makes it single-use.
    const send = async (nonce?: string): Promise<Response> => {
      const proof = await createDpopProof(
        nonce === undefined
          ? { keyPair, htm: method, htu: url }
          : { keyPair, htm: method, htu: url, nonce },
      );
      const headers = new Headers(init?.headers ?? undefined);
      // If `input` is a Request, carry its headers too (init overrides).
      if (typeof input !== "string" && !(input instanceof URL)) {
        input.headers.forEach((v, k) => {
          if (!headers.has(k)) {
            headers.set(k, v);
          }
        });
      }
      headers.set("dpop", proof);
      // oauth4webapi sends the body in `init.body` (a URLSearchParams string) — a small, replayable
      // value, so the §8 retry can resend it as-is. We forward `init` unchanged but with our headers.
      return underlying(url, { ...(init ?? {}), method, headers });
    };

    const res = await send();
    if (await isUseDpopNonceChallenge(res)) {
      const serverNonce = res.headers.get("dpop-nonce");
      if (serverNonce) {
        // Drain the challenge body before retrying (release resources; we discard it). Best-effort.
        await res.body?.cancel().catch(() => {});
        // Retry exactly once with the supplied nonce (NONCE_RETRY_LIMIT === 1) — no loop.
        return send(serverNonce);
      }
    }
    return res;
  };
  return dpopFetch as typeof fetch;
}

/**
 * Resolve a string/URL/Request input to an absolute URL string for the pod-fetch path. A `Request`
 * carries an absolute `.url`; a string/URL is resolved against a document base when present
 * (browser/worker), else must be absolute (server-side).
 */
function resolveResourceUrl(input: string | URL | Request): string {
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof input !== "string") {
    return input.url;
  }
  const g = globalThis as { document?: { baseURI?: string }; location?: { href?: string } };
  const base = g.document?.baseURI ?? g.location?.href;
  try {
    return base !== undefined ? new URL(input, base).toString() : new URL(input).toString();
  } catch {
    throw new Error(
      `solidDpopFetch: \`${input}\` is not an absolute URL and there is no document base to resolve ` +
        "it against (server-side). Pass an absolute https URL.",
    );
  }
}

/**
 * Default cap (bytes) on a STREAM request body buffered for replay across the §8 nonce retry. A
 * stream body larger than this is REJECTED rather than buffered, so an upload (or a proxied untrusted
 * body) cannot exhaust memory. 10 MiB — generous for typical Solid resource writes; raise via
 * `maxReplayBodyBytes`.
 */
export const DEFAULT_MAX_REPLAY_BODY_BYTES = 10 * 1024 * 1024;

/** The abort reason if the signal supplies one, else a standard `AbortError`. */
function abortReason(signal: AbortSignal): unknown {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason !== undefined) {
    return reason;
  }
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Drain a `ReadableStream<Uint8Array>` to an `ArrayBuffer` so a body can be REPLAYED across the
 * original + §8 nonce-retry attempts (a stream is single-use and would otherwise be consumed by the
 * first attempt). Used only for stream bodies; already-replayable bodies pass through unbuffered.
 *
 * BOUNDED + CANCELLABLE (a roborev finding): the read is capped at `maxBytes` — a larger body is
 * rejected (cancelling the reader) rather than buffered, so a large/unbounded upload or a proxied
 * untrusted stream cannot exhaust memory. We read MANUALLY via `getReader()` (not
 * `new Response(stream).arrayBuffer()`, which locks the stream so `cancel()` cannot stop an in-flight
 * read), racing each `read()` against the optional `AbortSignal` so an abort mid-drain rejects
 * promptly and stops the source.
 */
async function bufferStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<ArrayBuffer> {
  const reader = stream.getReader();

  // ONE abort listener for the whole read (not one per chunk), removed in `finally`.
  let removeAbortListener: (() => void) | undefined;
  const abortRace: Promise<never> | undefined =
    signal === undefined
      ? undefined
      : new Promise<never>((_resolve, reject) => {
          const onAbort = () => reject(abortReason(signal));
          signal.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener("abort", onAbort);
        });
  // Swallow the abortRace rejection if it never wins (avoids an unhandled rejection).
  abortRace?.catch(() => {});

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (signal?.aborted) {
      throw abortReason(signal);
    }
    for (;;) {
      const result = abortRace
        ? await Promise.race([reader.read(), abortRace])
        : await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > maxBytes) {
        throw new Error(
          `solidDpopFetch: request stream body exceeds the ${maxBytes}-byte replay buffer cap. ` +
            "Raise `maxReplayBodyBytes` to upload a larger body (it is buffered so the §8 DPoP-nonce " +
            "retry can replay it), or pass an already-replayable body (string / Uint8Array / Blob).",
        );
      }
      chunks.push(result.value);
    }
  } catch (err) {
    // Cancel the reader BEST-EFFORT (fire-and-forget): do NOT await it, because a stream whose
    // `cancel()` never resolves would otherwise hang `solidDpopFetch` instead of propagating the
    // abort/oversize error promptly (a roborev finding). Swallow any cancel rejection.
    void reader.cancel(err).catch(() => {});
    throw err;
  } finally {
    removeAbortListener?.();
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer.slice(0, total);
}

/**
 * Extract the transport-relevant fields of a `Request` into a `RequestInit`, so replacing the
 * Request with `underlying(url, init)` does not silently drop fetch semantics (credentials, mode,
 * cache, redirect, integrity, keepalive, referrer, referrerPolicy, signal). `body`/`method`/
 * `headers` are handled separately by the buffering + header-merge logic.
 */
function requestTransportFields(req: Request): RequestInit {
  return {
    redirect: req.redirect,
    cache: req.cache,
    credentials: req.credentials,
    integrity: req.integrity,
    keepalive: req.keepalive,
    mode: req.mode,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
    ...(req.signal ? { signal: req.signal } : {}),
  };
}

/** Options for {@link buildSolidDpopFetch}. */
export interface SolidDpopFetchOptions {
  /** The base fetch for the actual network call (global `fetch`, or an SSRF-guarded / test fetch). */
  readonly fetch?: FetchLike;
  /** Permit http: on loopback (dev pod). Default false (https-only). */
  readonly allowInsecure?: boolean;
  /**
   * Cap (bytes) on a STREAM request body buffered for the §8 DPoP-nonce retry. A stream body larger
   * than this is REJECTED rather than buffered (memory-safety). Default {@link DEFAULT_MAX_REPLAY_BODY_BYTES}
   * (10 MiB). Non-stream bodies (string / Uint8Array / Blob / …) are already replayable and not
   * buffered, so the cap does not apply to them.
   */
  readonly maxReplayBodyBytes?: number;
}

/**
 * Build a DPoP-attaching authed `fetch` for POD (resource-server) requests, from a persisted
 * {@link SolidAuthState}. The returned `fetch`:
 *   - rebuilds the DPoP keypair from `state.dpopKeyJwk` (via `importDpopKeyPairJwk`),
 *   - mints a per-request proof bound to the access token via `ath` (RFC 9449 §4.2 / §6.1),
 *   - sets `Authorization: DPoP <accessToken>` + `DPoP: <proof>`,
 *   - retries ONCE on a resource-server §8 `DPoP-Nonce` (401) challenge.
 *
 * The keypair is rebuilt ONCE per returned fetch (an async import is awaited lazily on first use),
 * not per request. Transport-guarded: an `http:` resource URL is rejected unless `allowInsecure`
 * permits loopback — so the DPoP token is never sent over plaintext. Never logs the token/proof/key.
 */
export function buildSolidDpopFetch(
  state: SolidAuthState,
  options: SolidDpopFetchOptions = {},
): FetchLike {
  const underlying: FetchLike = options.fetch ?? (globalThis.fetch as FetchLike);
  const allowInsecure = options.allowInsecure === true;
  // Validate the cap: a non-finite (NaN/Infinity) or negative value would silently remove the
  // memory bound (`total > NaN` is always false; `Infinity` is unbounded). Reject it (a roborev
  // finding) so the advertised bound always holds.
  const maxReplayBodyBytes = options.maxReplayBodyBytes ?? DEFAULT_MAX_REPLAY_BODY_BYTES;
  if (!Number.isFinite(maxReplayBodyBytes) || maxReplayBodyBytes < 0) {
    throw new Error(
      `solidDpopFetch: \`maxReplayBodyBytes\` must be a finite, non-negative number (got ${String(
        options.maxReplayBodyBytes,
      )}).`,
    );
  }
  const accessToken = state.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("solidDpopFetch: SolidAuthState.accessToken is missing/empty.");
  }
  const keyJwk: JWK = state.dpopKeyJwk;
  if (keyJwk === undefined || keyJwk === null || typeof keyJwk !== "object") {
    throw new Error("solidDpopFetch: SolidAuthState.dpopKeyJwk is missing/invalid.");
  }

  let keyPairPromise: Promise<DpopKeyPair> | undefined;
  const getKeyPair = (): Promise<DpopKeyPair> => {
    if (!keyPairPromise) {
      keyPairPromise = importDpopKeyPairJwk(keyJwk);
    }
    return keyPairPromise;
  };

  return async (input, init) => {
    const url = resolveResourceUrl(input);
    // SECURITY: never attach the DPoP access token + proof to a plaintext URL.
    assertSecureTransport(
      url,
      allowInsecure,
      (msg) =>
        new Error(`solidDpopFetch: ${msg} — refusing to send the DPoP token over plaintext.`),
    );

    const method = effectiveMethod(input, init);
    const keyPair = await getKeyPair();

    const reqInput = typeof input !== "string" && !(input instanceof URL) ? input : undefined;

    // The effective abort signal (explicit init wins, else the Request's) — honoured while BUFFERING
    // a stream body so an abort during the drain rejects promptly and stops the source.
    const effectiveSignal: AbortSignal | undefined =
      init && "signal" in init ? (init.signal ?? undefined) : (reqInput?.signal ?? undefined);

    // BODY: carry over the request body across the original + §8 retry attempts. Precedence matches
    // `fetch`: an explicit `init.body` wins over a `Request`'s own body. A non-replayable stream
    // (a `Request` body, or a `ReadableStream` in `init.body`) is BUFFERED once to an ArrayBuffer so
    // the nonce retry can resend it — otherwise a `Request`/stream body would be DROPPED on the
    // built request or consumed by the first attempt. The buffering is BOUNDED (maxReplayBodyBytes)
    // and ABORT-CANCELLABLE (a roborev finding). Already-replayable bodies (string / Uint8Array /
    // Blob / URLSearchParams / FormData / ArrayBuffer) pass through unbuffered.
    let bufferedBody: BodyInit | undefined;
    if (init && "body" in init) {
      const b = init.body ?? undefined;
      bufferedBody =
        b instanceof ReadableStream
          ? await bufferStream(b, effectiveSignal, maxReplayBodyBytes)
          : (b as BodyInit | undefined);
    } else if (reqInput && reqInput.body !== null) {
      // A Request body is a stream — buffer it (clone first so the original is untouched).
      bufferedBody = await bufferStream(
        reqInput.clone().body as ReadableStream<Uint8Array>,
        effectiveSignal,
        maxReplayBodyBytes,
      );
    }

    const send = async (nonce?: string): Promise<Response> => {
      const proof = await createDpopProof(
        nonce === undefined
          ? { keyPair, htm: method, htu: url, accessToken }
          : { keyPair, htm: method, htu: url, accessToken, nonce },
      );
      // Merge headers: the Request's first, then init overrides.
      const headers = new Headers(reqInput?.headers ?? undefined);
      if (init?.headers) {
        new Headers(init.headers).forEach((v, k) => {
          headers.set(k, v);
        });
      }
      headers.set("authorization", `DPoP ${accessToken}`);
      headers.set("dpop", proof);
      // Build the per-attempt init from the Request's transport fields first, then init overrides;
      // `body` is owned by the buffering above (never leak a consumed/original stream).
      const reqInit: RequestInit = {
        ...(reqInput ? requestTransportFields(reqInput) : {}),
        ...(init ?? {}),
        method,
        headers,
      };
      delete (reqInit as { body?: unknown }).body;
      if (bufferedBody !== undefined) {
        reqInit.body = bufferedBody;
      }
      return underlying(url, reqInit);
    };

    const res = await send();
    if (res.status === 401) {
      const serverNonce = res.headers.get("dpop-nonce");
      if (serverNonce) {
        await res.body?.cancel().catch(() => {});
        // Retry exactly once (NONCE_RETRY_LIMIT === 1) — no loop.
        return send(serverNonce);
      }
    }
    return res;
  };
}

/** The §8 nonce-retry limit (exported for documentation / test assertion). */
export const DPOP_NONCE_RETRY_LIMIT = NONCE_RETRY_LIMIT;
