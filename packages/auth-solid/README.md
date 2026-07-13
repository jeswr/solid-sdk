<!-- AUTHORED-BY Codex GPT-5 -->

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

```ts
import NextAuth from "next-auth";
import {
  extractSolidAuthState,
  persistSolidTokensIntoJwt,
  Solid,
  SOLID_JWT_KEY,
} from "@jeswr/auth-solid";

const solid = await Solid({
  issuer: process.env.SOLID_ISSUER!,
  clientId: process.env.SOLID_CLIENT_ID!,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [solid],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, user }) {
      if (account) {
        token[SOLID_JWT_KEY] = persistSolidTokensIntoJwt({
          account,
          dpopKeyJwk: await solid.dpopKeyJwkForPersistence(),
          webid: (user as { webid?: string }).webid,
          issuer: process.env.SOLID_ISSUER,
        });
      }
      return token;
    },
  },
});
```

For server-side pod requests, decode the Auth.js JWT, call `extractSolidAuthState(token)`, and pass
the result to `solidDpopFetch(state)`. Keep JWT sessions encrypted with a strong `AUTH_SECRET`.
Never return the private JWK or token fields to the client.

## Key API

- `Solid(config)`: asynchronous Auth.js provider factory.
- `persistSolidTokensIntoJwt`, `extractSolidAuthState`, `SOLID_JWT_KEY`: server-side persistence.
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
