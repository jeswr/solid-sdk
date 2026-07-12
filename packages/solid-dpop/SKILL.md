---
name: solid-dpop
description: Use when generating RFC 9449 DPoP proofs with @jeswr/solid-dpop, creating client-credentials sessions, driving authorization-code plus PKCE login, making ath-bound resource requests, refreshing tokens, or persisting CLI sessions and their bound keypair.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Work with `@jeswr/solid-dpop`

Use this package's JOSE-backed primitives; do not reimplement proof signing, thumbprints, PKCE, nonce handling, or token binding.

## Choose the right layer

- Proof primitives: `createDpopProof`, `canonicalHtu`, `accessTokenHash`, `generateDpopKeyPair`, and `toDpopKeyPair`.
- Service-account flow: `createSession`, `acquireToken`, `authedFetch`, and `rdfFetchFor`.
- User-delegated flow: `cliLogin`, or compose `discoverProvider`, `registerClient`/`staticClient`, `buildAuthorizationUrl`, `exchangeCode`, and `refreshSession`.
- CLI persistence: `saveSession`/`loadSession` or `serializeSession`/`deserializeSession`.
- Test-only OIDC driving: import `driveHeadlessOidc` or `headlessLogin` from `@jeswr/solid-dpop/testing`, never from the root.

```ts
import { authedFetch, cliLogin, refreshSession } from "@jeswr/solid-dpop";

const session = await cliLogin({ issuer, clientName: "my-cli" });
const response = await authedFetch(session, undefined, "GET", resourceUrl);
await refreshSession(session);
```

## Preserve DPoP invariants

- Generate a fresh `jti` per proof and use seconds, not milliseconds, for `iat`.
- Include `ath` on protected-resource proofs. Do not include `ath` on token-endpoint proofs.
- Bind `htu` and `htm` to the actual request as RFC 9449 requires; never sign a fragment.
- Handle a server DPoP nonce challenge with the package's bounded retry path. Do not add open-ended retry loops.
- Persist the original DPoP private key with a refresh token. Refresh tokens are bound to that key's `jkt`; a new key cannot redeem them.
- Treat serialized sessions like private keys. Keep file permissions restrictive and never log tokens or JWKs.
- Require HTTPS except for explicit loopback development. Validate discovered issuer equality and every contacted endpoint through the existing transport guards.
- Keep PKCE S256, OAuth state, and OIDC nonce mandatory on authorization-code flows.

Use the root exports for production and the testing subpath only in tests. Run unit tests and the full workspace gate; use the package's live test when changing interoperability with a real Community Solid Server.
