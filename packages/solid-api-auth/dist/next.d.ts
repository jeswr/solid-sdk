/**
 * @jeswr/solid-api-auth/next — a thin Next.js (App Router) route-handler helper over the
 * framework-free core.
 *
 * Next route handlers receive a web `Request` and return a web `Response`, so this adapter is a
 * few lines: map the request's `(headers, method, url)` into {@link verifyRequest}, and map an
 * {@link ApiAuthError} back to a `Response` carrying the status + `WWW-Authenticate` challenge.
 * It has NO dependency on the `next` package (a `NextRequest` extends `Request`, so the web
 * `Request` type covers it) — it is server-only (the core imports `node:crypto`).
 *
 * `./index.js` is imported (and kept external in the bundled `dist/`) so this shares ONE runtime
 * with the core: an {@link ApiAuthError} thrown by {@link verifyRequest} still satisfies
 * `instanceof ApiAuthError` inside {@link apiAuthErrorToResponse}.
 */
import { type ApiCredentials, type VerifyRequestOptions } from "./index.js";
export * from "./index.js";
/**
 * Map a verification error to a web `Response` for a Next route handler. An {@link ApiAuthError}
 * becomes its `statusCode` + (when present) the `WWW-Authenticate` challenge header; ANY other
 * error becomes a generic 500 (its detail is never leaked to the client). The body is a small
 * JSON `{ error }` object.
 */
export declare function apiAuthErrorToResponse(error: unknown): Response;
/**
 * Verify a Next route-handler `Request` against a pre-built verifier (in `opts.verifier`).
 * Returns the verified {@link ApiCredentials}; throws {@link ApiAuthError} on any failure (pass
 * it to {@link apiAuthErrorToResponse}, or use {@link withOwnerAuth} to do both). Thin wrapper
 * over {@link verifyRequest}.
 */
export declare function verifyNextRequest(request: Request, opts: VerifyRequestOptions): Promise<ApiCredentials>;
/**
 * Wrap a Next App-Router route handler so it runs ONLY after the (owner) gate passes; on any
 * verification failure it short-circuits to the challenge `Response` via
 * {@link apiAuthErrorToResponse}. The wrapped handler receives the original `Request`, the
 * verified {@link ApiCredentials}, and any Next route context (e.g. `{ params }`).
 *
 * @example
 * export const POST = withOwnerAuth(
 *   async (request, credentials) => Response.json({ ok: true, webId: credentials.webId }),
 *   { verifier: getVerifier() },
 * );
 */
export declare function withOwnerAuth<Args extends unknown[]>(handler: (request: Request, credentials: ApiCredentials, ...args: Args) => Response | Promise<Response>, opts: VerifyRequestOptions): (request: Request, ...args: Args) => Promise<Response>;
//# sourceMappingURL=next.d.ts.map