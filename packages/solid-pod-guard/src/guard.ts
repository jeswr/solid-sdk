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
 *   2. REJECTS caller-supplied `pod`/`webid` (query, or body at ANY depth)
 *      with 400 — the identity and the pod are never request inputs;
 *   3. derives the authorized pod from the TOKEN WebID via the bidirectional
 *      `pim:storage` binding (`resolveAuthorizedPod`, L2);
 *   4. hands `{ webid, podBase }` to the app handler, which additionally
 *      enforces `credentialSubject == webid` on every consumed credential
 *      (L3 — a CONSUMER obligation, see SKILL.md).
 *
 * Fail-closed invariants (do NOT weaken): unconfigured issuer allowlist ⇒
 * 503; any binding failure ⇒ 403; malformed payloads ⇒ 400 before any pod IO;
 * oversized bodies ⇒ 413 and a stalled body ⇒ 408, both enforced while the
 * stream is consumed (DoS containment); unexpected errors ⇒ 500, never a
 * pass. Handler order is strict and NOT configurable: authenticate
 * (anonymous ⇒ 401, even with malformed params) → reject overrides →
 * validate the body → ONLY THEN the pod binding + IO.
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

/**
 * DoS containment for the OPTIONAL JSON body (which is consumed BEFORE the
 * rate limiter's post-verification accounting can help): a hard byte cap
 * enforced while the stream is consumed, plus a read deadline. Guarded routes
 * carry small JSON control payloads only — these are deliberately fixed, not
 * options (a configurable cap on a security boundary is a knob to weaken it).
 */
const MAX_BODY_BYTES = 64 * 1024;
const BODY_READ_DEADLINE_MS = 10_000;
/**
 * Structural budgets for the override scan. A legitimate route body is a
 * small, flat-ish JSON control payload; anything deeper/bigger is rejected
 * 400 rather than traversed. The 64 KiB size cap bounds representable
 * nesting at ~32k levels, so a 64-level budget is generous for real payloads
 * while keeping the scan's work trivially small.
 */
const MAX_BODY_DEPTH = 64;
const MAX_BODY_NODES = 25_000;

/**
 * Scan the parsed JSON body for an override key (`pod`/`webid`) ANYWHERE —
 * nested objects and arrays included, so `{"options":{"pod":…}}` is rejected
 * exactly like a top-level override. ITERATIVE by design (explicit
 * work-stack): a pathologically nested body must exhaust the budget and be
 * rejected in a controlled way, never blow the call stack into a 500.
 */
function scanForOverrideKeys(root: unknown): "clean" | "override" | "over-budget" {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let nodes = 0;
  for (;;) {
    const entry = stack.pop();
    if (entry === undefined) return "clean";
    nodes += 1;
    if (entry.depth > MAX_BODY_DEPTH || nodes > MAX_BODY_NODES) return "over-budget";
    const { value, depth } = entry;
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, nested] of Object.entries(value)) {
        if (OVERRIDE_PARAMS.some((name) => name === key)) return "override";
        stack.push({ value: nested, depth: depth + 1 });
      }
    }
  }
}

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

  /**
   * Consume the raw body under the size cap + deadline. The `Content-Length`
   * precheck is an optimization only — a chunked body may omit or lie about
   * it, so the cap is ALSO enforced while the stream is consumed.
   */
  async function readBoundedBody(request: Request): Promise<string | Response> {
    const oversize = () =>
      Response.json(
        {
          simulated: true,
          error: "body_too_large",
          detail: `body must not exceed ${MAX_BODY_BYTES} bytes`,
        },
        { status: 413 },
      );
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return oversize();
    if (request.body === null) return "";
    const reader = request.body.getReader();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      // Cancelling resolves the pending read as done — the loop exits and the
      // timeout is surfaced below instead of a silently truncated body.
      void reader.cancel().catch(() => {});
    }, BODY_READ_DEADLINE_MS);
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          // Fire-and-forget: the reject must NOT wait on the source's
          // cancellation algorithm — a malicious source whose cancel never
          // settles would otherwise hold the 413 hostage.
          reader.cancel().catch(() => {});
          return oversize();
        }
        chunks.push(value);
      }
    } catch {
      return Response.json(
        { simulated: true, error: "malformed_request", detail: "body could not be read" },
        { status: 400 },
      );
    } finally {
      clearTimeout(deadline);
    }
    if (timedOut) {
      return Response.json(
        {
          simulated: true,
          error: "body_timeout",
          detail: "body was not received before the read deadline",
        },
        { status: 408 },
      );
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  }

  /** Step 3 — parse an OPTIONAL JSON body, rejecting pod/webid keys at ANY depth. */
  async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
    const raw = await readBoundedBody(request);
    if (raw instanceof Response) return raw;
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
    const scan = scanForOverrideKeys(body);
    if (scan === "override") return overrideRejection("body");
    if (scan === "over-budget") {
      return Response.json(
        {
          simulated: true,
          error: "param_rejected",
          detail:
            "the body exceeds the nesting/node budget — not a legitimate route body " +
            "(both are fixed, see SKILL.md)",
        },
        { status: 400 },
      );
    }
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
