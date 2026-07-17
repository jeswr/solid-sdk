// AUTHORED-BY Claude Fable 5
/**
 * The authenticated-caller pod-route boundary (SECURITY-CRITICAL).
 *
 * Extracted verbatim from the reviewed reference implementation (the pipeline
 * scaffolding; the reference app's route handlers stayed behind as injected
 * handlers) plus its thin verification bridge. Config renamed only.
 *
 * Every guarded handler:
 *
 *   1. requires a DPoP-bound Solid-OIDC caller (`@jeswr/solid-api-auth`;
 *      anonymous ⇒ 401 + `WWW-Authenticate`) — NO simulated bypass exists in
 *      server code, in any runtime mode;
 *   2. REJECTS caller-supplied `pod`/`webid` (query or body) with 400 — the
 *      identity and the pod are never request inputs;
 *   3. derives the authorized pod from the TOKEN WebID via the bidirectional
 *      `pim:storage` binding (`resolveAuthorizedPod`, L2);
 *   4. hands `{ webid, podBase }` to the app handler, which additionally
 *      enforces `credentialSubject == webid` on every consumed credential
 *      (L3 — a CONSUMER obligation, see SKILL.md).
 *
 * Fail-closed invariants (do NOT weaken): unconfigured issuer allowlist ⇒
 * 503; any binding failure ⇒ 403; malformed payloads ⇒ 400 before any pod IO;
 * unexpected errors ⇒ 500, never a pass. Handler order is strict and NOT
 * configurable: authenticate (anonymous ⇒ 401, even with malformed params) →
 * reject overrides → validate the body → ONLY THEN the pod binding + IO.
 */
import {
  apiAuthErrorToResponse,
  DpopApiVerifier,
  type DpopApiVerifierOptions,
  type RateLimiter,
  type RequestLike,
  TokenBucketRateLimiter,
  verifyRequest,
} from "@jeswr/solid-api-auth/next";
import { notConfigured, type PodGuardConfig } from "./config.js";
import { type OwnerBindingSeams, resolveAuthorizedPod } from "./owner.js";
import { PodAccessError } from "./pod.js";

/** The verified caller of a pod route: token WebID + the ONE pod it binds to. */
export interface AuthenticatedPodCaller {
  readonly webid: string;
  readonly podBase: string;
}

/** The guarded application handler: runs ONLY behind the full pipeline. */
export type PodRouteHandler = (
  caller: AuthenticatedPodCaller,
  body: Record<string, unknown>,
) => Promise<Response>;

export interface PodGuardOptions {
  readonly config: PodGuardConfig;
  /** Injected in tests; defaults to a config-derived process-wide verifier. */
  readonly verifier?: DpopApiVerifier;
  /** Per-WebID rate limiter shared by the guarded routes. */
  readonly rateLimiter?: RateLimiter;
  /** Owner-binding seams (profile fetch) for tests. */
  readonly ownerSeams?: OwnerBindingSeams;
  /**
   * Public-URL reconstruction for the DPoP `htu` binding. A framework may hand
   * the handler a request whose URL differs from the PUBLIC URL the caller
   * minted its proof against (e.g. Next.js strips the app's `basePath`) — remap
   * it here. Defaults to the request URL as-is. The HOST portion is still
   * governed by the verifier's own `trustForwardedHeaders` reconstruction.
   */
  readonly publicRequestUrl?: (request: Request) => string;
}

/**
 * One guard instance = one process-wide verifier + rate limiter. Construct at
 * module scope and reuse across requests: issuer discovery, JWKS, and the jti
 * replay store live on the verifier (a per-request verifier would let every
 * captured DPoP proof replay cleanly).
 */
export interface PodRouteGuard {
  /** Run `handler` behind the full fail-closed pipeline (order fixed, see module header). */
  handle(request: Request, handler: PodRouteHandler): Promise<Response>;
}

const OVERRIDE_PARAMS = ["pod", "webid"] as const;

/** Loud 400 for any attempt to name the pod/identity in the request. */
function overrideRejection(where: "query" | "body"): Response {
  return Response.json(
    {
      simulated: true,
      error: "param_rejected",
      detail:
        `the ${where} must not name a pod or webid — both are derived from the ` +
        "authenticated caller",
    },
    { status: 400 },
  );
}

function podErrorResponse(error: unknown): Response {
  if (error instanceof PodAccessError) {
    return Response.json(
      { simulated: true, error: "pod_access", detail: error.message },
      { status: error.status },
    );
  }
  return Response.json({ simulated: true, error: "internal_error" }, { status: 500 });
}

/** The verified caller identity (internal — the `verifyApiRequest` bridge). */
interface VerifiedApiRequest {
  webid: string;
}

/**
 * Verify a request's DPoP-bound Solid-OIDC credentials via `@jeswr/solid-api-auth`.
 * Returns the verified `{ webid }` on success, or the challenge `Response`
 * (401/403/429/503 with `WWW-Authenticate`) to return as-is. Never throws for
 * auth failures; a non-auth error still becomes a generic 500 `Response`
 * (detail is never leaked to the client).
 */
async function verifyApiRequest(
  request: RequestLike,
  options: { verifier: DpopApiVerifier; rateLimiter: RateLimiter },
): Promise<VerifiedApiRequest | Response> {
  try {
    const credentials = await verifyRequest(request.headers, request.method, request.url, {
      verifier: options.verifier,
      requireOwner: false,
      assertSameOrigin: false,
      rateLimiter: options.rateLimiter,
    });
    return { webid: credentials.webId };
  } catch (error) {
    return apiAuthErrorToResponse(error);
  }
}

/** Build the process-wide verifier (issuer discovery + JWKS + jti replay store). */
function createApiVerifier(options: DpopApiVerifierOptions): DpopApiVerifier {
  return new DpopApiVerifier(options);
}

export function createPodRouteGuard(options: PodGuardOptions): PodRouteGuard {
  const { config } = options;
  const publicRequestUrl = options.publicRequestUrl ?? ((request: Request) => request.url);
  const rateLimiter =
    options.rateLimiter ?? new TokenBucketRateLimiter({ capacity: 60, refillPerSec: 1 });
  // Constructed lazily so an unconfigured deployment never builds a verifier with an
  // empty issuer list; cached because the verifier owns the jti replay store and JWKS
  // cache (a per-request verifier would let captured proofs replay).
  let verifier: DpopApiVerifier | undefined = options.verifier;
  const getVerifier = (): DpopApiVerifier => {
    verifier ??= createApiVerifier({
      trustedIssuers: config.trustedOidcIssuers,
      allowInsecureLoopback: config.allowInsecureLoopback === true,
      trustForwardedHeaders: config.trustForwardedHeaders === true,
    });
    return verifier;
  };

  /**
   * Step 1 — authenticate. Anonymous is ALWAYS 401 (even with malformed
   * params: the caller's identity is established before anything else).
   */
  async function authenticate(request: Request): Promise<{ webid: string } | Response> {
    if (config.trustedOidcIssuers.length === 0) {
      return notConfigured("the trustedOidcIssuers issuer allowlist is unset");
    }
    return verifyApiRequest(
      { headers: request.headers, method: request.method, url: publicRequestUrl(request) },
      { verifier: getVerifier(), rateLimiter },
    );
  }

  /** Step 2 — refuse query overrides. `undefined` = clean. */
  function queryOverrides(request: Request): Response | undefined {
    const url = new URL(request.url);
    if (OVERRIDE_PARAMS.some((name) => url.searchParams.has(name))) {
      return overrideRejection("query");
    }
    return undefined;
  }

  /** Step 3 — parse an OPTIONAL JSON body, rejecting pod/webid keys. */
  async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
    const raw = await request.text();
    if (raw.trim() === "") return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json(
        { simulated: true, error: "malformed_request", detail: "body must be JSON" },
        { status: 400 },
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return Response.json(
        { simulated: true, error: "malformed_request", detail: "body must be a JSON object" },
        { status: 400 },
      );
    }
    const body = parsed as Record<string, unknown>;
    if (OVERRIDE_PARAMS.some((name) => name in body)) return overrideRejection("body");
    return body;
  }

  /**
   * Final step — derive the authorized pod (the first pod/network IO of the
   * pipeline; runs only after authentication + payload validation).
   */
  async function bindPod(webid: string): Promise<AuthenticatedPodCaller | Response> {
    try {
      const podBase = await resolveAuthorizedPod(webid, config, options.ownerSeams ?? {});
      return { webid, podBase };
    } catch (error) {
      return podErrorResponse(error);
    }
  }

  return {
    async handle(request: Request, handler: PodRouteHandler): Promise<Response> {
      const identity = await authenticate(request);
      if (identity instanceof Response) return identity;
      const rejected = queryOverrides(request);
      if (rejected !== undefined) return rejected;
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const caller = await bindPod(identity.webid);
      if (caller instanceof Response) return caller;
      try {
        return await handler(caller, body);
      } catch (error) {
        return podErrorResponse(error);
      }
    },
  };
}
