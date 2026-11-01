<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-dpop

Solid-OIDC login and session helpers for Node.js, plus RFC 9449 DPoP proof primitives.

> Experimental and security-sensitive. Review the authentication flow before production use.
> Deprecated for new integrations in favour of `@jeswr/pod-auth`; retained for existing consumers.

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

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Transport and response limits

Discovery requires an exact issuer match, including trailing slashes. The issuer and all advertised
token, authorization, registration, and JWKS URLs must use HTTPS. Local development can explicitly
set `allowInsecureLoopback: true` for HTTP on `localhost`, `127.0.0.1`, or `[::1]`.
This is a URL transport check; DNS resolution and SSRF pinning remain the consumer's responsibility.

Discovery and token responses have a streamed 1 MiB cap and a 30-second deadline covering transport
and response consumption (and the token nonce retry). Configure `maxResponseBytes` and
`requestTimeoutMs` on client credentials, `cliLogin`/`exchangeCode` options, or the optional third
options argument to `discoverProvider`/`refreshSession`. Refresh inherits options from an in-memory
auth-code session; after loading a persisted session, supply development opt-in and custom budgets
again through `refreshSession`'s third argument. Token responses must declare `token_type: "DPoP"`
(case-insensitive). Token HTTP errors expose only status and an allowlisted RFC 6749 error code.

Credential-bearing requests always use `redirect: "manual"`. Token redirects are errors.
`authedFetch` and `rdfFetchFor` return resource redirects unfollowed, including when the caller asks
for `redirect: "follow"`; `redirect: "error"` rejects a resource redirect. Injected transports must
honour manual redirects. Discarded nonce responses are cancelled on a best-effort basis without
waiting for cancellation to finish.

For a composed CLI flow, call `startLoopbackListener(path, expectedState)` with the state used in
the authorization URL, or use the generated `listener.state`. Missing, mismatched, or duplicate
callback state cannot complete the login. Callback errors use a constant plain-text response.

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
