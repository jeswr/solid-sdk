/**
 * @jeswr/solid-api-auth — the public, framework-free core surface.
 *
 * Server-side DPoP-bound Solid-OIDC access-token verification + owner authorization for an
 * app's own `/api/**` write routes. See `./core` for the full pipeline documentation, and the
 * `@jeswr/solid-api-auth/next` subexport for a Next.js route-handler helper.
 */
export type { ApiCredentials, AuthLogger, BidirectionalMode, DpopApiVerifierOptions, HeadersInput, IssuerKeys, RateLimiter, ReplayStore, RequestLike, ResolveIssuer, VerifyRequestOptions, } from "./core.js";
export { __resetRateLimiterForTests, __resetVerifierForTests, ApiAuthError, assertSameOrigin, DpopApiVerifier, getScanRateLimiter, getVerifier, InProcessReplayStore, isLoopbackHttp, optionsFromEnv, parseAuthorization, parseTrustedIssuers, reconstructRequestUrl, TokenBucketRateLimiter, verifyRequest, } from "./core.js";
//# sourceMappingURL=index.d.ts.map