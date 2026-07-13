<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-openid-client

A server-side Solid-OIDC client built on `openid-client` v6 with PKCE, DPoP, refresh, and
authenticated pod fetches.

> Experimental and security-sensitive. It is intended for Node.js servers, CLIs, bots, and agents.

## Install

```sh
npm install github:jeswr/solid-openid-client#main openid-client
```

`openid-client` is a peer dependency and must resolve to version 6.
Requires Node.js 20 or newer.

## Minimal usage

```ts
import { createSolidOidcClient } from "@jeswr/solid-openid-client";

const client = await createSolidOidcClient({
  issuer: "https://solidcommunity.net/",
  clientId: "https://app.example/client-id.jsonld",
  redirectUri: "https://app.example/callback",
});

const { url, state } = await client.authorizationUrl();
// Store `state` in the user's server session, then redirect the browser to `url`.

declare const callbackRequest: Request; // The incoming request to `/callback`.
const session = await client.handleCallback({ url: callbackRequest.url }, state);
const response = await client.fetch(session.webId);
```

Persist `client.currentTokens()` and `client.dpopKeyPair` together if the session must survive a
restart. The refresh token is bound to that key pair.

## Key API

- `createSolidOidcClient(options)` creates the client and performs issuer discovery.
- `SolidOidcClient` exposes `authorizationUrl`, `handleCallback`, `refresh`, `fetch`,
  `currentTokens`, `currentWebId`, and `dpopKeyPair`.
- DPoP helpers: `generateDpopKeyPair`, `resourceDpopProof`, `toCryptoKeyPair`.
- Core types: `AuthorizationRequest`, `AuthorizationRequestState`, `SolidOidcSession`,
  `SolidOidcTokens`, and `CreateSolidOidcClientOptions`.

## Links

- [Source](https://github.com/jeswr/solid-openid-client)
- [Issues](https://github.com/jeswr/solid-openid-client/issues)
- [`openid-client`](https://github.com/panva/openid-client)
- [Solid-OIDC specification](https://solidproject.org/TR/oidc)

## License

[MIT](./LICENSE) © Jesse Wright
