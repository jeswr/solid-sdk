<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-api-auth

Verify DPoP-bound Solid-OIDC access tokens and authorize one owner WebID on server-side API routes.

The framework-free verifier checks trusted issuers, JWT signatures and claims, RFC 9449 proofs,
replay, WebID-to-issuer binding, owner identity, optional CSRF, and rate limits.

> Experimental and security-critical. This package is server-only; never import it into a browser
> bundle.

## Install

```sh
npm install github:jeswr/solid-api-auth#main jose oauth4webapi @jeswr/fetch-rdf undici
```

Requires Node.js 22.12 or newer.

## Minimal usage

```ts
import { DpopApiVerifier, verifyRequest } from "@jeswr/solid-api-auth";

const verifier = new DpopApiVerifier({
  trustedIssuers: ["https://idp.example"],
  ownerWebId: "https://alice.example/profile/card#me",
});

const credentials = await verifyRequest(
  request.headers,
  request.method,
  request.url,
  { verifier },
);
```

Construct one verifier per process so discovery, JWKS, and replay state are reused. Failures throw
`ApiAuthError` with an HTTP status and `WWW-Authenticate` challenge.

For Next.js App Router, wrap handlers with `withOwnerAuth` from
`@jeswr/solid-api-auth/next`.

## Key API

- Core: `DpopApiVerifier`, `verifyRequest`, `ApiAuthError`.
- Next.js: `withOwnerAuth`, `verifyNextRequest`, `apiAuthErrorToResponse`.
- Environment: `getVerifier`, `optionsFromEnv`, `getScanRateLimiter`.
- Seams: `ReplayStore`, `RateLimiter`, issuer resolution, and guarded WebID fetch.
- Defaults: `InProcessReplayStore`, `TokenBucketRateLimiter` suit one process; clustered
  deployments should inject shared stores.

## Links

- [Source](https://github.com/jeswr/solid-api-auth)
- [Issues](https://github.com/jeswr/solid-api-auth/issues)
- [RFC 9449: OAuth DPoP](https://www.rfc-editor.org/rfc/rfc9449)
- [RFC 9068: JWT Access Tokens](https://www.rfc-editor.org/rfc/rfc9068)

## License

MIT © Jesse Wright
