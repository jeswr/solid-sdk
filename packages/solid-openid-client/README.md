<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-openid-client

A server-side Solid-OIDC client built on `openid-client` v6 with PKCE, DPoP, refresh, and
authenticated pod fetches.

> Experimental and security-sensitive. It is intended for Node.js servers, CLIs, bots, and agents.
> Deprecated for new integrations in favour of `@jeswr/pod-auth`; retained for existing consumers.

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

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Fetch transport and limits

Authenticated resource requests always use `redirect: "manual"`. A resource redirect is returned
unfollowed even when the caller selects `redirect: "follow"`; `redirect: "error"` rejects it.
Token requests also use manual redirects and reject redirect responses. Custom fetch implementations
must honour manual redirects. Nonce retries start best-effort response cancellation without waiting
for the cancellation hook.

An explicit `init.headers` replaces the entire Request header set, following native fetch semantics.
The client then attaches its Authorization and DPoP headers. A Request upload consumes the Request's
body once and buffers it for nonce replay, subject to `maxReplayBodyBytes` (default 10 MiB).
Oversized uploads and aborted buffering reject promptly even when stream cancellation stalls.

Discovery, token, and JWKS HTTP responses are streamed under a 1 MiB cap and a 30-second deadline
before upstream parsing. Set `maxResponseBytes` and `requestTimeoutMs` in client options to change
these limits. Issuers and endpoints require HTTPS; `allowInsecure: true` permits HTTP loopback for
development. DNS resolution and SSRF pinning remain the injected transport's responsibility.

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
