---
name: auth-solid
description: Use when integrating Solid-OIDC with Auth.js or next-auth v5 through @jeswr/auth-solid, persisting or refreshing the DPoP-bound Auth.js JWT state, or making authenticated pod requests with solidDpopFetch.
---
<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Work with `@jeswr/auth-solid`

Use this package only when Auth.js owns the OAuth/OIDC orchestration. It injects Solid's required DPoP behavior through Auth.js's `customFetch` seam.

## Integration outline

1. Install an `@auth/core` version in the declared peer range; `customFetch` requires `>=0.37.0`.
2. Build `await Solid({ issuer, clientId, ... })` once at module load.
3. Keep Auth.js checks for PKCE S256, state, and nonce enabled.
4. In the JWT callback, persist `persistSolidTokensIntoJwt({ account, dpopKeyJwk, webid, issuer })` under `SOLID_JWT_KEY`.
5. Expose only the verified WebID to the client session.
6. On the server, call `extractSolidAuthState()` and construct `solidDpopFetch(state)` for pod requests.

## Refresh in the Auth.js JWT callback

Capture a pristine fetch before any global patch. After the first-sign-in persistence branch,
refresh the stored `SolidJwtState` when expiry is unknown or within 60 seconds, only on an
explicit browser session-update POST that persists the returned cookie:

```ts
import {
  refreshSolidSession,
  SOLID_JWT_KEY,
  type SolidJwtState,
} from "@jeswr/auth-solid";

const pristineFetch = globalThis.fetch.bind(globalThis); // before global patching

// Inside NextAuth({ callbacks: { ... } }), alongside your first-sign-in branch:
async function jwt({ token, account, trigger }) {
  if (account) {
    // Persist with persistSolidTokensIntoJwt as described above and in the README.
    return token;
  }
  // Only the browser's cookie-writing session-update POST may refresh.
  // Ignore the client-supplied update payload; use only the encrypted JWT state.
  if (trigger !== "update") return token;
  const state = token[SOLID_JWT_KEY] as SolidJwtState | undefined;
  if (
    state &&
    (state.expiresAt === undefined || Date.now() >= (state.expiresAt - 60) * 1000)
  ) {
    token[SOLID_JWT_KEY] = await refreshSolidSession(state, {
      clientId: process.env.SOLID_CLIENT_ID!,
      fetch: pristineFetch,
    });
  }
  return token;
}
```

Mount the NextAuth `handlers.GET` and `handlers.POST` at `app/api/auth/[...nextauth]/route.ts`.
From an authenticated Client Component under `SessionProvider`, call `await update({})` using
the `update` returned by `useSession()` in an event handler. Wait for a successful session
response and its browser-applied `Set-Cookie` before starting the next server-side pod request.
Passing `{}` is required for the CSRF-protected `/api/auth/session` POST and JWT
`trigger: "update"`; plain `update()` and `getSession()` use GET and skip refresh here.
An internal server fetch that discards the cookie does not satisfy this persistence requirement.
See the [Auth.js client update implementation](https://github.com/nextauthjs/next-auth/blob/next-auth%405.0.0-beta.30/packages/next-auth/src/react.tsx#L478-L488).

Zero-argument `auth()` in a React Server Component invokes the callback but
[discards its updated cookie](https://github.com/nextauthjs/next-auth/blob/next-auth%405.0.0-beta.30/packages/next-auth/src/lib/index.ts#L172-L177).
The trigger guard skips refresh for these read-only calls, preserving single-use refresh
tokens. A successful read does not imply fresh Solid tokens: when refresh is needed, complete
the browser update flow before starting a new server-side pod request. If read-only calls must
refresh, store the entire current Solid state in shared server-side storage and atomically read,
refresh, and persist it there on every call, rather than using the cookie's token snapshot.
Concurrent-refresh coordination alone does not fix a discarded rotated-token cookie.

Pass the original provider's `clientSecret` too for confidential clients (Basic auth).
`refreshSolidSession` needs the persisted issuer, refresh token and private JWK; never use the
current provider instance's possibly regenerated key. It returns new state, preserves verified
identity/ID-token fields, and retains an omitted rotated refresh token. `expiresAt` is epoch
seconds. Persist the entire returned state: its `authorizationServerNonce` carries the latest
token-response DPoP nonce into the next refresh and is never used for pod requests. Missing or
empty nonce headers retain the previous nonce. If `expires_in` is omitted, the helper clears the
old `expiresAt` because the new lifetime is unknown; the callback refreshes on every explicit
session update while it remains unknown.
Coordinate concurrent refreshes when the AS rotates single-use refresh tokens.

Handle `SolidSessionRefreshError.code` without logging state or raw tokens. Fail the callback
on refresh failure; `invalid_grant` requires signing in again. The helper validates DPoP token
type, nonempty access/rotated refresh tokens, and a safe nonnegative integer `expires_in` when supplied.
Unknown OAuth errors become `oauth_error`; fetch/redirect failures become `network`.

## Security rules

- Read identity only from the verified ID-token claims passed to `profile()`. Never trust a WebID from the access token.
- Attach token-endpoint DPoP through the package custom fetch. Token-endpoint proofs omit `ath`; resource proofs include it.
- Keep nonce retries capped at one. Preserve the request-body replay limit for retryable streamed requests.
- Token retries require a 4xx `use_dpop_nonce` error and the server nonce; a nonce header on
  `invalid_grant` never replays the refresh credential.
- Refresh discovery and token HTTP must use the explicit pristine `options.fetch`, never a patched global.
- Match the discovered issuer exactly against the persisted identifier, without URL normalization.
- Reject cleartext transport except explicitly allowed loopback development.
- Treat the persisted access token, refresh token, ID token, and private DPoP JWK as secrets.
- With JWT sessions, set a strong `AUTH_SECRET` and keep the encrypted JWT strategy. If using database sessions, persist the same state server-side.
- Never expose the private JWK or token fields through the browser-visible session and never log them.
- Keep public and confidential client behavior distinct. A missing secret for a confidential method must fail closed.

Do not compose `@jeswr/solid-openid-client` into this package: it owns a competing OAuth flow. Continue composing `@jeswr/solid-dpop` only for proof primitives.

Run adversarial tests and the full workspace gate for every change; this package is an authentication boundary.
