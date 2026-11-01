// AUTHORED-BY Claude Opus 4.8
/**
 * The authenticated resource fetch — DPoP-bound, origin-gated, fail-closed, with the
 * RFC 9449 §8 nonce-challenge retry. This is the one place the user's access token is
 * ever attached to an outbound request, so every guard lives here.
 *
 * Security invariants (all enforced unconditionally):
 *   1. ORIGIN GATE. The token is attached ONLY when the request URL's origin is in the
 *      session's allowed set ({@link isOriginAllowed}). A request to any other origin is
 *      sent UNAUTHENTICATED (a plain fetch) — never with the token. This stops a
 *      malicious page exfiltrating the token via `solid.fetch("https://evil/")`.
 *   2. TOKEN-ENDPOINT GUARD. The resource token is never attached to the issuer's /token
 *      endpoint ({@link isTokenEndpoint}) even if that origin is allowed.
 *   3. NONCE RETRY (RFC 9449 §8). On a pure `use_dpop_nonce` 401, the proof is re-minted
 *      with the server `DPoP-Nonce` and the request retried ONCE.
 *   4. SINGLE RETRY. Exactly one retry, so a misbehaving server cannot loop us.
 *   5. GATED REDIRECTS. GET/HEAD discover opaque redirect targets with credential-free
 *      HEAD probes. Every direct re-send passes credential policy and the full live gate.
 *      Other methods fail closed on redirects without any probe or re-send.
 *
 * The re-entrancy guard (a fetch the SW itself issues for discovery/token/refresh must
 * never recurse into THIS path) is the caller's responsibility: discovery/token use the
 * raw `fetch`, never this function. This function only ever sends the access token to a
 * vetted resource origin.
 */

import { createDpopProof } from './dpop';
import { fetchWithRedirects } from './manual-redirect';
import { isOriginAllowed, isTokenEndpoint } from './origin-policy';
import { isUseDpopNonceChallenge } from './www-authenticate';

/** The minimum session shape the authenticated fetch needs. */
export interface FetchSession {
  readonly accessToken: string;
  readonly dpopKeyPair: CryptoKeyPair;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly tokenEndpoint: string | null;
}

export interface AuthenticatedFetchOptions {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  /**
   * The request body. Restricted to a REPLAYABLE `string | null` because the §8 nonce
   * retry must re-send the body: a one-shot `ReadableStream`/`Blob` stream cannot be sent
   * twice. The page->worker message protocol already serialises bodies to strings, so this
   * is the only shape that ever reaches here; a non-string body is rejected at the inject
   * boundary (see inject.ts).
   */
  readonly body?: string | null;
  /** A cached server DPoP nonce to use on the first attempt, if known. */
  readonly nonce?: string;
  /** Injected fetch (test seam). Defaults to the global. */
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  /** Full live access gate, run before EVERY send, including nonce retries. */
  readonly authorize?: (url: string, method: string) => Promise<void>;
}

export interface AuthenticatedFetchResult {
  readonly response: Response;
  /** The freshest server DPoP nonce observed (cache it for the next request). */
  readonly nonce?: string;
  /** Whether the token was actually attached (false => sent as a plain, public fetch). */
  readonly authenticated: boolean;
  /** Final authorized request URL/method (Response.url is lost when the worker buffers it). */
  readonly url: string;
  readonly method: string;
}

const HOP_BY_HOP = new Set(['authorization', 'dpop', 'host', 'content-length', 'connection']);

/** Strip caller-supplied auth/transport headers so a page can't inject its own DPoP/Authorization. */
function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/**
 * Perform an authenticated resource fetch under all the invariants above. If the request
 * is not to an allowed origin (or targets the token endpoint), it is performed as a plain
 * fetch with NO token — fail-open for reads to public/foreign resources, fail-CLOSED for
 * the credential (the credential is simply never attached).
 */
export async function authenticatedFetch(
  session: FetchSession,
  options: AuthenticatedFetchOptions,
): Promise<AuthenticatedFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nonces = new Map<string, string>();
  if (options.nonce) nonces.set(new URL(options.url).origin, options.nonce);
  return fetchWithRedirects(
    { ...options, headers: sanitizeHeaders(options.headers) },
    async ({ url, method, headers, body }, redirected) => {
      const mayAttach =
        isOriginAllowed(session.allowedOrigins, url) &&
        !isTokenEndpoint(url, session.tokenEndpoint);
      // Preserve the initial public-fetch API, but NEVER follow it into an unchecked target.
      if (redirected && !mayAttach) throw new TypeError('Redirect target denied');
      const origin = new URL(url).origin;
      const send = async (nonce?: string): Promise<Response> => {
        const hopHeaders = { ...headers };
        if (mayAttach) {
          hopHeaders.Authorization = `DPoP ${session.accessToken}`;
          hopHeaders.DPoP = await createDpopProof({
            keyPair: session.dpopKeyPair,
            htm: method,
            htu: url,
            accessToken: session.accessToken,
            nonce,
          });
        }
        // Re-read live authority AFTER signing; no await separates this gate from fetch.
        await options.authorize?.(url, method);
        return fetchImpl(url, {
          method,
          headers: hopHeaders,
          body,
          redirect: 'manual',
          signal: options.signal,
        });
      };
      let response = await send(nonces.get(origin));
      let serverNonce = response.headers.get('dpop-nonce') ?? undefined;
      // One RFC 9449 §8 retry PER HOP, with a fresh proof for this URL and method.
      if (
        mayAttach &&
        response.status === 401 &&
        isUseDpopNonceChallenge(response) &&
        serverNonce
      ) {
        response = await send(serverNonce);
        serverNonce = response.headers.get('dpop-nonce') ?? serverNonce;
      }
      if (serverNonce) nonces.set(origin, serverNonce);
      return { response, nonce: serverNonce, authenticated: mayAttach };
    },
    fetchImpl,
    options.signal,
  );
}
