<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

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
- Shared resource authentication: `createIssuerKeyResolver`, `createResourceTokenVerifier`.
- Seams: `ReplayStore`, `RateLimiter`, issuer resolution, and guarded WebID fetch.
- Defaults: `InProcessReplayStore`, `TokenBucketRateLimiter` suit one process; clustered
  deployments should inject shared stores.

## Shared discovery and key rotation

`createIssuerKeyResolver({ outboundFetch, now?, maxEntries?, timeoutMs?,
allowInsecureLoopback? })` returns a `ResolveIssuer` and shares discovery/JWKS loads per URL.
Supply an anonymous, SSRF-guarded `outboundFetch` that pins DNS, validates redirects and
bounds response sizes. The helper forces `credentials: "omit"` and never forwards inbound
headers. Issuer and JWKS URLs require credential-free HTTPS; HTTP is restricted to explicit
loopback development fixtures. Discovery must name the exact requested issuer.

```ts
import { createIssuerKeyResolver } from "@jeswr/solid-api-auth";
import { jwtVerify } from "jose";

const resolveIssuer = createIssuerKeyResolver({ outboundFetch: guardedFetch });
// Check your issuer trust policy before resolution; this helper only selects keys.
const { jwks } = await resolveIssuer(trustedIssuer);
const verified = await jwtVerify(token, jwks, {
  issuer: trustedIssuer,
  audience: "solid",
  algorithms: ["ES256", "RS256"],
});
```

Construct the resolver once. Each discovery/JWKS cache lasts ten minutes, holds at most
1,000 entries and permits at most 1,000 distinct in-flight loads (`maxEntries` overrides
these limits). Additional loads fail closed at capacity; existing callers can still join
their URL's load. Loads and body reads have a five-second deadline (`timeoutMs` overrides
it); timeout aborts the transport and releases the slot even if the transport ignores abort.
Late completion cannot replace a newer cached value. Expired cache entries go before the
oldest live entry.

Only `ERR_JWKS_NO_MATCHING_KEY` permits a forced refresh. The resolver retries the latest
cached snapshot first, joins any pending load, then applies a one-minute cooldown per JWKS
URL, including failed attempts. A freshly loaded JWKS also starts that minute. Every waiter
verifies its own token. Failed or timed-out refreshes keep the previous value and its original
expiry. Ordinary requests can use a valid cached key during a refresh; cache misses/expiry
and forced refreshes for the same URL share one pending load.

Cooldown bookkeeping has the same capacity. Expired entries go first, then the oldest.
One conservative overflow deadline preserves evicted live cooldowns without retaining URLs;
under saturation, new forced refreshes may be refused until that deadline. Cached metadata,
keys and cooldowns are process-local.

`DpopApiVerifier` uses this resolver by default, including guarded discovery/JWKS reads,
the ten-minute metadata/key TTL and the one-minute refresh cooldown. Its `webidFetch` seam
also supplies that default resolver's transport. An injected `resolveIssuer` retains its own
key policy; its results are coalesced and cached for ten minutes with bounded load deadlines.

## Solid-audience resource verification

`createResourceTokenVerifier` supplies the generic verifier extracted from notification-relay:

```ts
import { createResourceTokenVerifier } from "@jeswr/solid-api-auth";

const verifyResourceToken = createResourceTokenVerifier({
  publicUrl: "https://resource.example",
  outboundFetch: guardedFetch,
  store: sharedReplayStore, // atomic insertIfAbsent(key, ttlMs): Promise<boolean>
});
const identity = await verifyResourceToken(request);
// Apply your route policy to identity.webid / identity.clientId here.
```

It requires `Authorization: DPoP <access-token>`, audience `solid`, `iss`, `aud`, `exp`,
`webid` and `cnf`, asymmetric signatures, and a valid RFC 9449 proof. Proof checks include
the public-origin URL plus pathname (ignoring query/fragment and forwarded headers), method,
`iat` within ±60 seconds, nonempty `jti`, access-token hash and `cnf.jkt` binding. The public
URL must be an origin. Access-token `typ`, `sub` and `iat` are not required by this profile;
`DpopApiVerifier` keeps its existing stricter claim requirements and owner authorization.

The claimed WebID must endorse the exact issuer through a NamedNode `solid:oidcIssuer`
assertion on that WebID subject. The shared RDF parser uses `@jeswr/fetch-rdf`, limits profiles
to 256 KiB and refuses remote JSON-LD contexts. Profile reads have the same bounded,
ten-minute cache and five-second deadline as discovery. `DpopApiVerifier` also accepts
endorsements on the profile-document subject, preserving its existing profile policy.

`ResourceIdentity` contains `{ webid, clientId, issuer, expiresAt }` (expiry in milliseconds).
Callers apply client-ID, sender or owner authorization. Verification failures reject; callers
should return their constant auth error. Replay reservations use a hashed key binding proof
thumbprint and `jti`, with a 300,000 ms TTL. Inject one atomic shared `ResourceReplayStore`
across instances; duplicates and store outages fail closed. `now` accepts a millisecond clock;
`allowLoopbackForTests` is a fixture-only option that must never come from production
configuration.

## Links

- [Source](https://github.com/jeswr/solid-api-auth)
- [Issues](https://github.com/jeswr/solid-api-auth/issues)
- [RFC 9449: OAuth DPoP](https://www.rfc-editor.org/rfc/rfc9449)
- [RFC 9068: JWT Access Tokens](https://www.rfc-editor.org/rfc/rfc9068)

## License

MIT © Jesse Wright
