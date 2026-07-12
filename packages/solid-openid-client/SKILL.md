---
name: solid-openid-client
description: Use when building server-side Node, CLI, bot, or agent Solid-OIDC flows with @jeswr/solid-openid-client, including issuer discovery, Client Identifier Documents, authorization-code plus PKCE callbacks, DPoP-bound refresh, and authenticated pod fetches.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Work with `@jeswr/solid-openid-client`

Use this package for Node/server applications whose OAuth flow is owned by `openid-client` v6. Browser suite applications should normally use `@jeswr/solid-auth-core`; Auth.js applications should use `@jeswr/auth-solid`.

```ts
import { createSolidOidcClient } from "@jeswr/solid-openid-client";

const client = await createSolidOidcClient({ issuer, clientId, redirectUri });
const { url, state } = await client.authorizationUrl();
// Persist state server-side, redirect the user, then:
const session = await client.handleCallback({ url: callbackUrl }, state);
const response = await client.fetch(resourceUrl);
```

## Rules

- Install and deduplicate the `openid-client` v6 peer dependency.
- Prefer a stable HTTPS Client Identifier Document for public clients. Supply a pre-registered `client` only when dynamic or confidential registration is required.
- Persist the authorization request state in a user-agent-bound server session until callback handling completes.
- Trust the WebID only from the verified ID token. Fail closed when neither a valid `webid` claim nor a WebID-shaped `sub` is available.
- Keep PKCE S256, state, nonce, and DPoP enabled on every flow.
- Persist both the refresh token and `dpopKeyPair`; the refresh token is bound to that key's thumbprint.
- Use `client.fetch` for protected resources so proofs carry `ath` and nonce challenges use the bounded retry path.
- Reject cleartext issuer, discovered endpoint, and protected-resource URLs except explicit loopback development. A loopback redirect URI remains valid for native/CLI flows.
- Inject a guarded fetch for server-side attacker-influenced URLs. The `fetch` option is a security seam, not only a test seam.
- Never log authorization codes, tokens, state, nonce, or DPoP keys.

Run the package tests and full workspace gate after auth-flow changes. Keep the mock-OP tests non-vacuous: they must verify real signatures, PKCE, state, nonce, WebID extraction, proof binding, and refresh rotation.
