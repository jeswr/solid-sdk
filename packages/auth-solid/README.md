<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/auth-solid

An Auth.js provider for Solid-OIDC with PKCE, state, nonce, DPoP-bound tokens, and authenticated pod fetches.

Auth.js owns the OAuth flow; this package supplies the Solid-specific provider, token persistence,
and RFC 9449 proof handling.

> Security-critical. Persist token state only in an encrypted server-side session or Auth.js JWT,
> set a strong `AUTH_SECRET`, and expose only the verified WebID to the browser.

## Install

```sh
npm install github:jeswr/auth-solid#main "next-auth@beta"
```

Auth.js v5 is currently published under the `beta` tag. `@auth/core` is a peer dependency and must
be at least 0.37.0 for `customFetch`; install `"@auth/core@^0.37"` directly when using Auth.js
without `next-auth`. Requires Node.js 20 or newer.

## Minimal usage

This JWT example refreshes only during an explicit browser session-update POST, so the
browser persists the returned cookie before the next request. Read-only session calls skip refresh.

```ts
import NextAuth from "next-auth";
import {
  extractSolidAuthState,
  persistSolidTokensIntoJwt,
  refreshSolidSession,
  Solid,
  SOLID_JWT_KEY,
  type SolidJwtState,
} from "@jeswr/auth-solid";

// Capture before installing any global fetch patch. All refresh HTTP uses this reference.
const pristineFetch = globalThis.fetch.bind(globalThis);
const clientId = process.env.SOLID_CLIENT_ID!;
const solid = await Solid({
  issuer: process.env.SOLID_ISSUER!,
  clientId,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [solid],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, user, trigger }) {
      if (account) {
        token[SOLID_JWT_KEY] = persistSolidTokensIntoJwt({
          account,
          dpopKeyJwk: await solid.dpopKeyJwkForPersistence(),
          webid: (user as { webid?: string }).webid,
          issuer: process.env.SOLID_ISSUER,
        });
      } else if (trigger === "update") {
        // Only refresh through the browser's cookie-writing session-update POST.
        // Ignore the client-supplied update payload; use only the encrypted JWT state.
        const state = token[SOLID_JWT_KEY] as SolidJwtState | undefined;
        // expiresAt is epoch seconds. Refresh when expiry is unknown or within 60 seconds.
        if (
          state &&
          (state.expiresAt === undefined || Date.now() >= (state.expiresAt - 60) * 1000)
        ) {
          token[SOLID_JWT_KEY] = await refreshSolidSession(state, {
            clientId,
            fetch: pristineFetch,
          });
        }
      }
      return token;
    },
  },
});
```

Mount `handlers.GET` and `handlers.POST` at `app/api/auth/[...nextauth]/route.ts`.
In an authenticated Client Component under `SessionProvider`, obtain `update` from
`useSession()` and call `await update({})` in an event handler before starting the next
server-side pod request. Passing `{}` makes this a CSRF-protected POST to `/api/auth/session`
with `trigger: "update"`; plain `update()` and `getSession()` use GET and do not refresh in
this example. Require a successful session response before continuing. The browser must receive
and apply its `Set-Cookie`; an internal server fetch whose cookie is discarded is insufficient.
See the [Auth.js client update implementation](https://github.com/nextauthjs/next-auth/blob/next-auth%405.0.0-beta.30/packages/next-auth/src/react.tsx#L478-L488).

Calling zero-argument `auth()` in a React Server Component runs the JWT callback but
[discards the updated cookie](https://github.com/nextauthjs/next-auth/blob/next-auth%405.0.0-beta.30/packages/next-auth/src/lib/index.ts#L172-L177).
The guard above prevents such reads from consuming a single-use refresh token. A successful
read does not imply fresh Solid tokens: when refresh is needed, complete the browser update
flow before starting a new server-side pod request. If read-only session calls must
refresh, keep the entire current Solid state in shared server-side storage and atomically read,
refresh, and persist it there on every call. Do not refresh from an old cookie snapshot in that
flow. Serializing concurrent refreshes alone cannot fix a discarded rotated-token cookie.

For server-side pod requests, decode the Auth.js JWT, call `extractSolidAuthState(token)`, and pass
the result to `solidDpopFetch(state)`. Keep JWT sessions encrypted with a strong `AUTH_SECRET`.
Never return the private JWK or token fields to the client.

`refreshSolidSession(state, options)` requires the persisted issuer, refresh token and private
DPoP key, plus the original `clientId` and an explicit pristine `fetch`. For a confidential
client, pass the same `clientSecret` used by `Solid()`; it authenticates with Basic. HTTPS is
required; `allowInsecure: true` permits only loopback HTTP for development.

The helper discovers the issuer's token endpoint, requires an exact match with the persisted
issuer identifier, uses the persisted key with no `ath` on the token proof, and retries a
`use_dpop_nonce` challenge once. It returns new state with updated
tokens and expiry in epoch seconds, retaining the old refresh token if rotation is omitted.
It also persists the latest authorization-server `DPoP-Nonce` in `authorizationServerNonce`
and reuses it on the next refresh, including after session restoration. This nonce is never
used for pod requests. Missing or empty nonce headers retain the previous value.
When `expires_in` is omitted, it clears the previous `expiresAt`; the new lifetime is unknown.
The callback above refreshes on every explicit session update while expiry remains unknown.
When supplied, `expires_in` must be a safe nonnegative integer in seconds.
It preserves the verified WebID and ID token; it does not adopt an unverified refresh ID token.
Coordinate concurrent refreshes in your session store when refresh tokens are single-use.

Failures throw `SolidSessionRefreshError` with a machine-readable `code`, including
`invalid_grant`, `use_dpop_nonce`, `invalid_response`, and `network` (also covers refused token
redirects). Invalid persisted state/options yield `invalid_session`/`invalid_options`; standard
OAuth error codes are preserved and unknown server errors become `oauth_error`. Errors contain
no response bodies or upstream causes. Let the callback fail closed on refresh failure, as in
the example; an `invalid_grant` requires a new sign-in. Never log the state or expose it through
the browser-visible session.

## Key API

- `Solid(config)`: asynchronous Auth.js provider factory.
- `persistSolidTokensIntoJwt`, `extractSolidAuthState`, `SOLID_JWT_KEY`: server-side persistence.
- `refreshSolidSession`, `SolidSessionRefreshError`: server-side refresh from persisted state.
- `solidDpopFetch`: DPoP-authenticated resource fetch with one nonce retry.
- Advanced seams: `buildDpopCustomFetch`, `SOLID_CHECKS`, `DEFAULT_SCOPE`.

## Links

- [Source](https://github.com/jeswr/auth-solid)
- [Issues](https://github.com/jeswr/auth-solid/issues)
- [Auth.js](https://authjs.dev/)
- [Solid-OIDC](https://solidproject.org/TR/oidc)
- [RFC 9449: OAuth DPoP](https://www.rfc-editor.org/rfc/rfc9449)

## License

[MIT](./LICENSE) © Jesse Wright
