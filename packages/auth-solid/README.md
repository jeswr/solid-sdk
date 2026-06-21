# @jeswr/auth-solid

A **Solid-OIDC provider for [Auth.js](https://authjs.dev) (next-auth v5 / `@auth/core`)**.

`Solid(config)` returns an Auth.js `OIDCConfig` that performs the Solid-OIDC authorization-code
flow with **PKCE (S256) + state + nonce + DPoP-bound (sender-constrained) tokens** — injecting the
[RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) DPoP proof on the token endpoint through the
Auth.js [`customFetch`](https://authjs.dev/reference/core#customfetch) seam (Auth.js does not do
DPoP itself). It reads the user's **WebID** from the verified ID token (fail-closed). It composes
[`@jeswr/solid-dpop`](https://github.com/jeswr/solid-dpop) for the proof primitives (ES256,
asymmetric-only) — no hand-rolled crypto.

It also exports `solidDpopFetch` — a DPoP-attaching authed `fetch` for **pod (resource-server)
requests** from a persisted session.

> Status: under active development (alpha).

## Why this design

- **Composes `@jeswr/solid-dpop` directly, NOT `@jeswr/solid-openid-client`.** `solid-openid-client`
  orchestrates its *own* auth-code/callback flow (authorization URL + callback handling), which
  would fight Auth.js's own (oauth4webapi-driven) OAuth flow. Auth.js **owns the OAuth
  orchestration**; all we need is to inject DPoP proofs at the HTTP layer — exactly what
  `@jeswr/solid-dpop`'s proof primitives provide.
- **DPoP via `customFetch`, because `@auth/core` does not do DPoP.** Auth.js routes *all* OAuth
  endpoint HTTP (discovery, JWKS, token, userinfo) through one `customFetch`. Ours **discriminates**
  and attaches a DPoP proof **only to the token-endpoint leg** (a POST with a form-urlencoded grant
  body). The token-endpoint proof carries **no `ath`** (RFC 9449 §4.2 — there is no access token
  being *presented* yet). It handles the RFC 9449 §8 `use_dpop_nonce` retry **exactly once**.
- **Verified-WebID-only, fail-closed.** The WebID is read **only** from the verified ID-token claims
  Auth.js passes to `profile()` (oauth4webapi validates the ID token signature + `iss`/`aud`/`nonce`
  first). A login with no resolvable `webid` **throws** — never a session without a verified WebID,
  and never trusting a `webid` from the unverified access token.
- **DPoP key in the JWT — a documented tradeoff** (see [Security](#security)).

## Install

```sh
# GitHub install (committed self-contained dist/ — works under ignore-scripts, no build step):
npm install github:jeswr/auth-solid#main @auth/core
# @auth/core is a PEER dependency. next-auth v5 also works (it re-exports @auth/core's customFetch).
```

`@jeswr/solid-dpop` is bundled into the committed `dist/`; `jose` and `@auth/core` are resolved by
you (peer/dep). Node `>=20`, ESM only (matching the Auth.js v5 ecosystem).

## Usage (Next.js App Router, next-auth v5)

```ts
// auth.ts
import NextAuth from "next-auth";
import {
  Solid,
  persistSolidTokensIntoJwt,
  extractSolidAuthState,
  SOLID_JWT_KEY,
} from "@jeswr/auth-solid";

// The provider is async (it prepares the DPoP keypair). Build it once at module load.
const solid = await Solid({
  issuer: process.env.SOLID_ISSUER!, // e.g. https://login.example  (the Solid OP)
  clientId: process.env.SOLID_CLIENT_ID!, // a Client Identifier Document URL (public client)
  // clientSecret: process.env.SOLID_CLIENT_SECRET, // ONLY for a confidential client
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [solid],
  session: { strategy: "jwt" }, // encrypted JWT (Auth.js encrypts with AUTH_SECRET) — see Security
  callbacks: {
    // 1. On first sign-in, persist the DPoP-bound tokens + the DPoP PRIVATE key into the JWT.
    async jwt({ token, account, user }) {
      if (account) {
        token[SOLID_JWT_KEY] = persistSolidTokensIntoJwt({
          account,
          dpopKeyJwk: await solid.dpopKeyJwkForPersistence(),
          webid: (user as { webid?: string })?.webid,
          issuer: process.env.SOLID_ISSUER,
        });
      }
      return token;
    },
    // 2. Surface the WebID on the session for the client.
    async session({ session, token }) {
      const state = extractSolidAuthState(token);
      if (state?.webid) {
        (session as { webid?: string }).webid = state.webid;
      }
      return session;
    },
  },
});
```

```ts
// app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

### Making authenticated pod requests

```ts
// Anywhere you have the session/JWT (e.g. a server action / route handler):
import { auth } from "@/auth";
import { solidDpopFetch, extractSolidAuthState } from "@jeswr/auth-solid";
import { getToken } from "next-auth/jwt"; // to read the raw JWT token with the persisted state

// `extractSolidAuthState` accepts the decoded JWT token (or the SolidJwtState directly).
const token = await getToken({ req, secret: process.env.AUTH_SECRET });
const state = extractSolidAuthState(token);
if (!state) {
  throw new Error("not authenticated for pod access");
}

const fetch = solidDpopFetch(state); // a DPoP-attaching authed fetch
const res = await fetch("https://alice.example/private/notes.ttl");
//  -> sets `Authorization: DPoP <token>` + a fresh DPoP proof (with `ath`) per request,
//     and retries once on a resource-server 401 `DPoP-Nonce` challenge (RFC 9449 §8).
```

## Public API

| Export | Description |
|---|---|
| `Solid(config): Promise<SolidProvider>` | The provider factory. Returns an `OIDCConfig<SolidProfile>` (+ `dpopKeyPair` / `dpopKeyJwkForPersistence()`). Async (prepares the DPoP keypair). |
| `solidDpopFetch(state, opts?)` | A DPoP-attaching authed `fetch` for pod requests, from a persisted `SolidAuthState`. |
| `persistSolidTokensIntoJwt(input)` | Build the persisted state (`SolidJwtState`) from the first-sign-in `account` + the DPoP private JWK. Fail-closed. |
| `extractSolidAuthState(source)` | Extract a `SolidAuthState` from a JWT token / session (or the `SolidJwtState` directly). `undefined` when absent. |
| `SOLID_JWT_KEY` | The key under which the state is stored on the JWT token (`"solid"`). |
| `buildDpopCustomFetch(keyPair, underlying, allowInsecure)` | (Advanced) the token-leg DPoP customFetch builder. |
| `SOLID_CHECKS` / `DEFAULT_SCOPE` | `["pkce","state","nonce"]` / `"openid webid offline_access"`. |
| `isLoopbackHost` / `DPOP_NONCE_RETRY_LIMIT` | Transport helper / the §8 retry cap (`1`). |
| types | `SolidProviderConfig`, `SolidProfile`, `SolidAuthState`, `SolidJwtState`, `SolidProvider`, `SolidDpopFetchOptions`, `AccountLike`, `PersistSolidTokensInput`, `FetchLike` |

### `Solid(config)` configuration

| Field | Required | Default | Notes |
|---|---|---|---|
| `issuer` | yes | — | The Solid OP URL (https; http only on loopback with `allowInsecure`). |
| `clientId` | yes | — | A Client Identifier Document URL (public client) or an opaque static client id. |
| `clientSecret` | no | — | Only for a **confidential** client. Omit for a public client. |
| `scope` | no | `openid webid offline_access` | `openid` is forced on; de-duplicated. |
| `dpopKeyJwk` | no | a fresh ES256 key | Restore a private JWK so the refresh `jkt` survives a restart (usually persisted via the `jwt` callback instead). |
| `allowInsecure` | no | `false` | Permit `http:` issuer/endpoints on **loopback** only (local-dev OP). |
| `id` / `name` | no | `"solid"` / `"Solid"` | Provider id / display name overrides. |

### Module augmentation (optional)

To type `session.webid` / the JWT state, add to your app:

```ts
// types/next-auth.d.ts
import type { SolidJwtState } from "@jeswr/auth-solid";
declare module "next-auth" {
  interface Session { webid?: string }
}
declare module "next-auth/jwt" {
  interface JWT { solid?: SolidJwtState }
}
```

## Security

This is an auth package; the security posture is non-negotiable:

- **PKCE (S256) + state + nonce are all mandatory** (`checks: ["pkce","state","nonce"]`). Auth.js
  generates and validates them; this package asserts they are set.
- **DPoP is mandatory and asymmetric-only (ES256)** via `@jeswr/solid-dpop` — a symmetric (`HS*`) /
  `none` alg is never reachable. Every proof is single-use (a fresh `jti`).
- **Verified-WebID-only, fail-closed.** The WebID is read from the verified ID token; a login with
  no resolvable WebID throws. The WebID is never trusted from the unverified access token.
- **Transport guards.** The DPoP `customFetch` and `solidDpopFetch` reject `http:` URLs (so the
  token/proof is never sent in the clear) unless `allowInsecure` permits a loopback host.
- **§8 nonce retry capped at exactly one** — no retry loop, for both the token endpoint and the
  resource server.
- **No token / proof / key / request body is ever logged**, and none appears in any thrown error.

### The DPoP-key-in-JWT tradeoff (read this)

To make pod requests *after* the OAuth flow, the DPoP **private key** must be available to sign
proofs — and the refresh-token `jkt` binding requires the **same** key after a restart. So
`persistSolidTokensIntoJwt` stores the DPoP **private JWK** (plus the access/refresh/id tokens) into
the Auth.js session. This is a real tradeoff:

- **JWT session (default, recommended):** Auth.js **encrypts the JWT** with `AUTH_SECRET` (A256GCM)
  by default, so the key + tokens are encrypted at rest in the cookie. **Set a strong `AUTH_SECRET`**
  and keep `session.strategy: "jwt"`. This is the default-supported path.
- **Database session:** store the same fields (`accessToken`, `refreshToken`, `idToken`,
  `expiresAt`, `dpopKeyJwk`) in the account/session row instead. Use this if you prefer not to keep
  the key in the cookie.

Either way, treat the persisted state as **secret material**. Do not log it, do not expose it to the
client (only surface the WebID on the `session`).

## How it works

```
sign-in:  browser → Auth.js (PKCE+state+nonce) → token endpoint
                                                   └─ customFetch attaches DPoP proof (no ath, §8 nonce retry)
          → verified ID token → profile() reads `webid` (fail-closed) → user { id: webid }
          → jwt callback persists { access/refresh/id tokens, expires_at, dpopKeyJwk } into the (encrypted) JWT

pod call: extractSolidAuthState(jwt) → solidDpopFetch(state)
          → per request: Authorization: DPoP <token> + fresh DPoP proof (ath bound to the token),
            401 DPoP-Nonce retry once
```

## Development

```sh
npm install        # ignore-scripts=true (the committed solid-dpop dist resolves without a build)
npm run gate       # lint (Biome + lockfile-transport) + typecheck (tsc) + test (vitest) + build (esbuild) + check:dist
```

The committed `dist/` is a **self-contained ESM bundle** (esbuild inlines `@jeswr/solid-dpop`; `jose`
and `@auth/core` stay external). `npm run check:dist` fails the gate if the committed `dist/` drifts
from a fresh build. Tests run against a faithful Map-backed mock OP — **no live IdP** — that verifies
the inbound DPoP proof for real (signature, `typ`, `htm`/`htu`, asymmetric `alg`, fresh `jti`) and
exercises the RFC 9449 §8 nonce flow.

## License

MIT © Jesse Wright
