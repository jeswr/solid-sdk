# @jeswr/solid-dpop

> ⚠️ **Experimental — AI-agent-generated.** This package was created by an AI coding agent (Claude Opus 4.8, @jeswr's PSS agent) and is under active development. It is not yet production-hardened — review before relying on it.

Canonical Solid-OIDC client-credentials session + RFC 9449 DPoP proof primitives, plus the
user-delegated **authorization-code + PKCE + DPoP** flow. `jose`-only crypto (nothing
hand-rolled); ships dual ESM + CJS builds.

## What it provides

- `createDpopProof` / `canonicalHtu` / `accessTokenHash` / `toDpopKeyPair` /
  `generateDpopKeyPair` / `DPOP_ALG` — RFC 9449 §4.2 DPoP proof generation (header
  `typ`/`alg`/`jwk`, payload `htm`/`htu`/`jti`/`iat`/`ath`/`nonce`).
- `createSession` / `acquireToken` / `authedFetch` / `generateSessionKeyPair` — the
  client-credentials grant against a CSS `.account` IdP, DPoP-bound resource requests with the
  §8 nonce-challenge retry and token refresh.
- `rdfFetchFor` — adapts a session to the DOM `fetch` signature that `@jeswr/fetch-rdf` expects.
- **`cliLogin` / `discoverProvider` / `registerClient` / `staticClient` / `buildAuthorizationUrl`
  / `startLoopbackListener` / `exchangeCode` / `refreshSession` / `generatePkce` /
  `assertIssuerTransport`** — the user-delegated **authorization-code + PKCE + DPoP** flow (see
  below).
- **`saveSession` / `loadSession` / `serializeSession` / `deserializeSession`** (`src/sessionStore.ts`)
  — persist an `AuthCodeSession` to disk (chmod 600) so a CLI logs in once and later runs reuse it
  via the refresh grant. The DPoP private key is stored (`exportDpopKeyPairJwk` / `importDpopKeyPairJwk`)
  because CSS binds the refresh token to the original `jkt` — a regenerated keypair fails refresh
  (`invalid_grant`, verified live).
- **`@jeswr/solid-dpop/testing`** subpath (`src/testing.ts`) — `driveHeadlessOidc` / `headlessLogin`:
  the headless CSS-v8 OIDC drive helper (login → pick-WebID → consent) the live specs use. Test-only;
  never imported from the package root.
- Types: `DpopKeyPair`, `DpopProofParams`, `ClientCredentials`, `SolidSessionState`, `FetchLike`,
  `AuthCodeSession`, `OidcProviderMetadata`, `ClientRegistration`, `PkcePair`, `AuthUrlParams`,
  `LoopbackListener`, `CliLoginOptions`, `StoredSession`.

## User-delegated login: authorization-code + PKCE + DPoP (`src/authCode.ts`)

The client-credentials grant above logs in *as a service account*. The authorization-code flow logs
in *as a user*.

It produces the **same `authedFetch` / `rdfFetchFor` surface** as the client-credentials session
(`AuthCodeSession extends SolidSessionState`); only token *acquisition* differs. The DPoP proof
discipline is the existing `dpop.ts` — reused, not duplicated.

One call, for CLIs / native apps:

```ts
import { cliLogin, authedFetch, refreshSession } from "@jeswr/solid-dpop";

const session = await cliLogin({ issuer: "https://solidcommunity.net/", clientName: "my-cli" });
// → discovery → anonymous DCR (or staticClient for a Client Identifier Document)
//   → loopback listener on 127.0.0.1:<ephemeral> → PKCE-S256 auth URL → await redirect
//   → DPoP-bound code exchange. session.refreshToken is set (offline_access).

const res = await authedFetch(session, undefined, "GET", "https://pod/me/notes.ttl"); // ath-bound proof
await refreshSession(session); // refresh-token rotation, same DPoP keypair → same jkt
```

### Persisting a session across processes (`src/sessionStore.ts`)

A CLI logs in once and reuses the session on later runs:

```ts
import { cliLogin, loadSession, saveSession, refreshSession, authedFetch } from "@jeswr/solid-dpop";

const stored = await loadSession(".myapp/auth.json");
const session = stored ?? (await cliLogin({ issuer, prompt: "consent" }));
if (!stored) await saveSession(".myapp/auth.json", session); // chmod 600
await refreshSession(session); // renew without a second browser round-trip
```

**The DPoP private key is persisted** (as a JWK, inside the 0600 file). This is required, not
optional: CSS / node-oidc-provider binds the refresh token to the DPoP `jkt`, so a refresh signed by
a *regenerated* keypair is rejected with `invalid_grant` — verified live (a fresh keypair fails, the
original succeeds). Treat the file like an SSH private key.

`authedFetch(session, creds, …)`'s `creds` is **optional**: a user-delegated session passes
`undefined` (it refreshes via `refreshSession`, not the client-credentials path). Client-credentials
callers pass their credentials.

Pieces, if you need to drive the flow yourself (e.g. a web app supplying its own redirect handling):
`discoverProvider` → `registerClient` | `staticClient` → `startLoopbackListener` →
`buildAuthorizationUrl` (`response_type=code`, `scope=openid webid offline_access`, S256 challenge,
`state`, `nonce`) → `exchangeCode`. **Static client id / Client Identifier Documents** are supported
via `staticClient(clientId, redirectUri)`; a deployed app should prefer that over DCR so the consent
screen shows a stable name.

### The http/loopback issuer guard

`assertIssuerTransport` implements the RFC 8252 §8.3 + OAuth security BCP rule: `https:` always
allowed, `http:` allowed **only** for loopback hosts (`127.0.0.1`, `[::1]`, `localhost`), rejected
for real domains. This lets local dev against an in-memory CSS at `http://localhost:3000/` work
while keeping `http:` off for real issuers. A regression test in `test/authCode.test.ts` pins the
behaviour.

`discoverProvider` extends that guard to the **discovered metadata**: it requires the returned
`issuer` to equal the requested issuer exactly (OIDC Discovery 1.0 §4.3) and applies the SAME
https-or-loopback rule (via `assertEndpointTransport`) to every endpoint it will contact —
`authorization_endpoint`, `token_endpoint`, and `registration_endpoint` — so a malicious or
misconfigured document cannot redirect authorization codes, refresh tokens, or client secrets to an
insecure off-origin URL.

### Crypto policy

`jose` for all JOSE ops (sign / thumbprint / JWK export), `node:crypto` only for keygen
(`generateKeyPair` via jose) and the SHA-256 `ath` digest. Nothing hand-rolled.

`generateSessionKeyPair` and `generateDpopKeyPair` are the same function under two names; both are
exported.

## Build & test

```sh
npm install
npm run build      # emits dist/esm (ESM) + dist/cjs (CommonJS)
npm run typecheck  # tsc --noEmit, clean
npm run lint       # biome check
npm test           # vitest unit tests (DPoP proof shape + session wiring + session-store round-trip)
```

The dual `exports` map (`import` → `dist/esm`, `require` → `dist/cjs`) lets both type-stripping ESM
consumers and `tsc`-compiled CJS consumers resolve the package cleanly.

### Running the live test

`npm run test:live` boots an in-memory CSS v8 on **port 3086** and drives the OIDC interaction
headlessly via the `.account` API (`controls.oidc.{prompt, webId, consent}`), then asserts the token
is DPoP-bound, `authedFetch` reads a protected resource, refresh works, and a second `prompt=consent`
flow completes. `npm test` stays offline (the live spec is excluded).

## License

MIT © Jesse Wright
