# @jeswr/solid-api-auth

Server-side **DPoP-bound Solid-OIDC access-token verification + owner authorization** for an
app's own `/api/**` write routes. Framework-free core + a thin Next.js route-handler subexport.

> Experimental, AI-agent-generated. Extracted from the AccessRadar reference implementation
> (bead `xh5.11`) so the five revenue products (AccessRadar + Keystone / CapNote / Provena /
> Furlong) consume **one audited package** instead of five copies. The verifier mirrors
> `prod-solid-server/src/auth` semantics — it verifies a DPoP-bound token EXACTLY as a Solid pod
> resource server does — then authorizes a single owner WebID.

## What it does

When an app's client mints DPoP-bound access tokens for pod requests and then calls its OWN
backend with the same token + a fresh proof, this package verifies that token and authorizes the
single owner. The pipeline (issuer-agnostic; **no** hard-pinned `aud`):

1. `Authorization` MUST be `DPoP <token>` — a bare `Bearer` is refused (proof-of-possession, not
   bearer).
2. The **unverified** `iss` is checked against a trusted-issuer allowlist BEFORE any discovery,
   so an untrusted issuer never triggers a discovery-document dereference.
3. The access-token JWS is verified with [`jose`](https://github.com/panva/jose) against the
   issuer's JWKS (discovered issuer-agnostically via
   [`oauth4webapi`](https://github.com/panva/oauth4webapi)). **Asymmetric algorithms only**
   (`HS*` / `none` excluded). `typ=at+jwt`, `iss`, and the temporal claims are checked; `exp`,
   `iat`, `cnf`, and the WebID claim are **required** (fail-closed — a token omitting them is
   rejected). `aud` is deliberately not pinned (the DPoP proof re-binds the token to this exact
   request).
4. The DPoP proof (RFC 9449) is verified: `typ=dpop+jwt`, an asymmetric `alg`, an embedded PUBLIC
   JWK that verifies the proof's signature, `htm` == method, `htu` == the reconstructed
   (proxy-aware) request URL, `iat` fresh, `jti` unique (bounded in-process replay store behind
   an injectable seam), `ath` == the access-token hash, and `cnf.jkt` == the base64url SHA-256
   thumbprint of the proof's JWK (the proof-of-possession binding).
5. The `webid` claim is extracted — must be an `https:` URL without userinfo.
6. A **SSRF-guarded bidirectional WebID↔issuer check** (defence-in-depth): the WebID profile is
   dereferenced through [`@jeswr/guarded-fetch`](https://github.com/jeswr/guarded-fetch)
   (DNS-pinned) and must list the token's issuer via `solid:oidcIssuer`.
7. Authorization: `webid === ownerWebId`. **Fail-closed** when `ownerWebId` is unset (503 — refuse
   all writes; never open). Wrong WebID → 403.

Any failure throws an `ApiAuthError` carrying the HTTP status + `WWW-Authenticate` challenge.

## Install

```sh
npm install github:jeswr/solid-api-auth#main jose oauth4webapi @jeswr/fetch-rdf undici
```

The package commits a **self-contained `dist/`** (esbuild-inlines the off-npm
`@jeswr/guarded-fetch`; `jose`, `oauth4webapi`, `@jeswr/fetch-rdf`, and `undici` stay external),
so it installs directly from GitHub under `ignore-scripts=true` with no build step.
`@jeswr/fetch-rdf` + `@jeswr/guarded-fetch/node` are loaded **lazily** — only the default
bidirectional WebID check touches them; a caller that injects `webidFetch` or sets
`bidirectionalMode: "off"` never does.

**Server-only.** Imports `node:crypto` (+ lazily `undici` / RDF). Import it from route handlers /
server code, never a client component.

## Usage

### Framework-free core

```ts
import { DpopApiVerifier, verifyRequest } from "@jeswr/solid-api-auth";

// Construct ONCE (per process) — issuer discovery + JWKS + the replay store are cached on it.
const verifier = new DpopApiVerifier({
  trustedIssuers: ["https://idp.example"],
  ownerWebId: "https://me.example/profile/card#me",
});

// Verify any request expressed as (headers, method, url):
const credentials = await verifyRequest(request.headers, request.method, request.url, {
  verifier,
});
// → { webId, issuer, clientId? }  (throws ApiAuthError on failure)
```

`verifyRequest` options: `requireOwner` (default `true` — set `false` to only authenticate),
`assertSameOrigin` (default `false` — a same-origin CSRF gate run before crypto), and a
`rateLimiter` seam (a token is consumed after successful auth, keyed by the verified WebID, → 429
when the bucket is empty).

### Next.js (App Router)

```ts
import { getVerifier } from "@jeswr/solid-api-auth";
import { withOwnerAuth } from "@jeswr/solid-api-auth/next";

export const POST = withOwnerAuth(
  async (request, credentials) => Response.json({ ok: true, webId: credentials.webId }),
  { verifier: getVerifier() },
);
```

`withOwnerAuth` runs the handler only after the owner gate passes; on any failure it
short-circuits to the `WWW-Authenticate` challenge `Response`. Lower-level helpers
`verifyNextRequest(request, opts)` and `apiAuthErrorToResponse(error)` are also exported.

### Env-driven wiring (the shared fan-out convention)

`getVerifier()` builds a process-wide verifier from the environment (preserved verbatim from the
AccessRadar reference):

| Env var | Meaning |
|---|---|
| `PSS_TRUSTED_ISSUERS` | **required** — comma/space/newline-separated trusted-issuer allowlist |
| `OWNER_WEBID` | the single authorized writer (**fail-closed** — 503 if unset) |
| `PSS_WEBID_CLAIM` | the WebID claim name (default `webid`) |
| `PSS_BIDIRECTIONAL_WEBID_MODE` | `strict` \| `warn` \| `off` |
| `PSS_AUTH_ALLOW_INSECURE_LOOPBACK` | `1`/`true` to allow loopback-HTTP (dev/CI) |
| `PSS_CLOCK_TOLERANCE_SEC` | clock skew seconds (default 5) |
| `PSS_SCAN_RATE_PER_MIN` | `getScanRateLimiter()` per-minute capacity (default 10) |

## Injectable seams

- **`ReplayStore`** — the `jti` replay store. Default `InProcessReplayStore` (single-instance).
  For a multi-instance deployment inject a shared store (Redis `SET jti 1 EX ttl NX`).
- **`RateLimiter`** — the abuse cap. Default `TokenBucketRateLimiter` (in-process). Inject a
  shared (Redis) limiter for a strict cluster-wide limit.
- **`resolveIssuer`** — issuer→keys. Default OIDC discovery + remote JWKS.
- **`webidFetch`** — the SSRF-guarded WebID-profile fetch. Default a DNS-pinning
  `@jeswr/guarded-fetch/node` fetch.

## Security notes

- **Proof-of-possession, not bearer.** A bare `Bearer` token is always refused.
- **Fail-closed everywhere.** Missing `exp`/`iat`/`cnf`/WebID → reject; unset `ownerWebId` → 503;
  `strict` bidirectional-check fetch failure → 401 (with a constant, non-oracle message).
- **SSRF-guarded WebID dereference.** The user-influenced WebID is only ever fetched through the
  DNS-pinning guard.
- **Single-instance replay + rate-limit caveat.** The default in-process stores are exact for one
  instance; inject shared stores behind a load balancer (see the seams above).

## Development

```sh
npm run gate   # lint + typecheck + test + build + check:dist + check:api + publint + attw
```

The committed `dist/` must match a fresh build of `src/` (`npm run check:dist`), and the public
API is snapshotted by api-extractor (`etc/solid-api-auth.api.md`, `etc/solid-api-auth-next.api.md`;
`ae-forgotten-export` is an error).

## Divergence from the AccessRadar reference

Behaviour parity is the acceptance bar. The one deliberate change: the request surface is a
framework-free `RequestLike` (`{ headers, method, url }`) and the top-level entry is
`verifyRequest(headers, method, url, opts)` instead of a hard-wired web `Request` — a web
`Request` still satisfies `RequestLike`, so existing call sites are unaffected. The rate limiter
now sits behind a `RateLimiter` interface (was a concrete class); `TokenBucketRateLimiter`
implements it unchanged. The entire 53-case adversarial test suite was ported verbatim.

## License

MIT © Jesse Wright
