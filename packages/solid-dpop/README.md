<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-dpop

Solid-OIDC login and session helpers for Node.js, plus RFC 9449 DPoP proof primitives.

> Experimental and security-sensitive. Review the authentication flow before production use.

## Install

```sh
npm install github:jeswr/solid-dpop#main
```

Requires Node.js 20 or newer.

## Minimal usage

```ts
import { authedFetch, cliLogin, refreshSession } from "@jeswr/solid-dpop";

const session = await cliLogin({
  issuer: "https://solidcommunity.net/",
  clientName: "my-cli",
});

if (Date.now() >= session.expiresAt) await refreshSession(session);

// Authorization-code sessions have no client-credentials object, so pass `undefined`.
const response = await authedFetch(
  session,
  undefined,
  "GET",
  "https://alice.example/private/notes.ttl",
);
```

`cliLogin` starts a loopback callback listener and prints the authorization URL unless
`openBrowser` is supplied. Persist the refresh token together with the same DPoP key pair, and
re-persist after `refreshSession` rotates a token; a new key cannot redeem a token bound to the old
key.

## Key API

- Login: `cliLogin`, `discoverProvider`, `staticClient`, `registerClient`,
  `buildAuthorizationUrl`, `exchangeCode`, `refreshSession`.
- Authenticated requests: `authedFetch`, `rdfFetchFor`, `createSession`, `acquireToken`.
- DPoP: `createDpopProof`, `generateDpopKeyPair`, `canonicalHtu`, `accessTokenHash`,
  `toDpopKeyPair`.
- Persistence: `saveSession`, `loadSession`, `serializeSession`, `deserializeSession`.
- Tests only: `driveHeadlessOidc` and `headlessLogin` from `@jeswr/solid-dpop/testing`.

## Links

- [Source](https://github.com/jeswr/solid-dpop)
- [Issues](https://github.com/jeswr/solid-dpop/issues)
- [RFC 9449: OAuth DPoP](https://www.rfc-editor.org/rfc/rfc9449)
- [Solid-OIDC specification](https://solidproject.org/TR/oidc)

## License

[MIT](./LICENSE) © Jesse Wright
