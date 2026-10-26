---
title: Architecture and review guide
---

# Architecture and review guide

The library keeps upstream's philosophy: a request is sent as-is, and only a 401 inside an explicitly trusted
boundary makes a composable provider upgrade it. Protocol knowledge lives in providers; the reactive
algorithm is shared by pages, workers and Node.js.

## Layers

| Layer | Modules | Responsibility |
| --- | --- | --- |
| Reactive core | `ReactiveAuthenticationClient`, `ReactiveFetchManager`, `challenge`, `CredentialBoundary`, `url`, `transport` | Replay, boundary, redirects, bounded retries, provider selection, global registration |
| Session safety | `SessionFence`, `FencedCache`, `locks` | Logout generations, shared/exclusive Web Locks, BroadcastChannel, secret-free lock/cache keys |
| Credential acquisition | `authorizationCodeGrant`, `OidcSession`, `credentials/*`, `oauth/*Source` (generic OAuth, Google GIS, MSAL) | Obtaining ID/access tokens or subject credentials |
| Exchange / presentation | `DPoPTokenProvider`, `SolidUmaTokenProvider`, `ClientCredentialsTokenProvider`, `lws/*`, `oauth/OAuthBearerTokenProvider` | Turning credentials into request headers |
| Discovery and caching | `IssuerProvider`s, `XASProvider`, `ClientProvider`s, `Caching*Provider`, `StorageContext`, `createBrowserCaches` | Issuer, metadata, client registration, storage grouping; Key Value Kit stores |
| Browser integration | `elements` (`AuthorizationCodeFlow`, `IdpPicker`, `WebIdPicker`), `ReactiveFetchWorkerManager`, `service-worker` | Popup UI, pickers, service worker interception and page bridge |

The main entry point (`mod.ts`) has no DOM dependency and imports in Node.js, SSR and workers; custom elements
are in `@jeswr/reactive-authentication/elements`.

## The reactive algorithm (`ReactiveAuthenticationClient`)

1. Requests outside the boundary that are not discovery candidates pass through natively (no buffering, never upgraded).
2. Capture the fence generation and signal, then buffer the body (bounded, abortable) so it can be replayed.
3. Send unauthenticated. A 401 at the end of a native redirect chain is re-targeted only for GET/HEAD.
4. If the URL is in the boundary — or a discovering boundary verifies its root from this 401 — the first
   provider whose `matches(request, challenge)` is true upgrades it.
5. Credentialed attempts use `redirect: "manual"`: a readable redirect restarts the algorithm for the next hop
   (caller credentials stripped across origins, body headers dropped on POST→GET); an `opaqueredirect`
   (browsers) is returned as-is — a write is never repeated to discover a hidden target.
6. On another 401: one retry for `use_dpop_nonce`, one `invalidate` + renewal; then the 401 is returned.
7. Before every send and after every provider await, the captured signal and generation are checked.

## Invariants to review

- **Boundary before disclosure.** Nothing is attached outside `CredentialBoundary` (origin + path segment,
  encoded separators/dots rejected). A static boundary is never widened by discovery; the opt-in
  `AutomaticCredentialBoundary` admits a root only after verified evidence, before any provider runs, and
  never after the fetch's session was superseded (`Boundary.discover`).
- **One consumption per rotating refresh token.** Session reads, refresh and writes happen under a Web Lock per
  credential context; with a session store, only the durable record is refreshed; records are removed before
  their token is consumed and replacements are written durable-first.
- **Logout wins.** Values are stamped with the fence generation and only used for the same generation;
  commits hold the fence's shared lock and re-check; `supersede` takes it exclusively, aborts in-flight work and
  broadcasts. Cross-tab fencing requires a fence with a persistent store (`createBrowserCaches().fence`).
  Upgraded requests retain the provider's cancellation signal through transport. Providers expose their
  credential fence through the optional `TokenProvider.fence`; the client captures its generation before
  upgrading and validates it after challenge cleanup, immediately before sending, then rechecks cancellation.
  Provider and client must share the same fence to order this validation and transport initiation against
  cross-realm logout under one shared lock. Third-party providers without a fence remain supported.
- **Per-request proofs.** DPoP proofs are generated for every request (never cached); keys are non-extractable.
- **Key isolation.** Session keys include namespace, account, issuer, redirect URI, scopes and storage context;
  LWS keys include AS, realm and credential identity; supplied stores require an explicit namespace.
- **No reactive recursion.** Provider traffic uses `nonReactiveFetch()` (the function a registered manager
  replaced) or an injected transport.
- **Insecure HTTP is opt-in** per component (`allowInsecureRequests`, `allowInsecureHttp`).
- **Shared stores need shared fences.** Any supplied credential store (OIDC cache or session store, LWS, UMA or
  client-credentials tokens) requires a namespace and a `SessionFence` shared by every instance using it.
- **Invalidation is compare-and-remove** under the key's lock, so a late 401 never deletes a replacement.
- **Standard OAuth tokens stay on their API.** `OAuthBearerTokenProvider` checks its own `resources` in
  `matches` and `upgrade`, ignores challenge parameters, answers only Bearer/unspecified challenges, and drops
  stale `DPoP` headers. Generic sessions reuse `OidcSession` with DPoP, `offline_access`, `prompt=none` and
  Solid quirks off, S256 required, Bearer-only tokens and the exact redirect URI checked. The Bearer provider
  supersedes its fence before letting the source clean up, so a provider and source may share one fence.
  SDK adapters (GIS, MSAL) cannot cancel SDK promises; abort/logout settle callers at once and discard late
  results, and at most one interactive popup runs per SDK client/source.
- **Compatibility exceptions** are limited to exact issuer origins and can be disabled (see protocols).

## Review order

1. `src/ReactiveAuthenticationClient.ts`, `src/CredentialBoundary.ts`, `src/url.ts`, `src/challenge.ts` with `test/core.test.js`.
2. `src/SessionFence.ts`, `src/FencedCache.ts`, `src/OidcSession.ts` with `test/solid-oidc.test.js` and `test/persistence.test.js`.
3. `src/StorageContext.ts` and `src/DPoPTokenProvider.ts` with the storage tests in `test/components.test.js`.
4. `src/lws/*`, `src/credentials/*` with `test/lws.test.js` and `test/helpers/lws.js` (the independent verifier).
5. `src/worker/*`, `src/ReactiveFetchWorkerManager.ts`, `src/AuthorizationCodeFlow.ts` with `test/browser/*`.

## Tests

`npm test` builds and runs `node:test` suites against `dist/` with real HTTP servers on 127.0.0.1: a mock
OpenID provider (PKCE, state, nonce, DPoP proof verification with `jti` replay detection, nonces, rotating
refresh tokens with reuse detection, revocation), Solid storages, and an LWS authorization server/storage
that verifies every suite's credential. `npm run test:browser` bundles the library with esbuild and runs
Chromium (Playwright) against the same servers: popup flow, service worker with two tabs, popup lifecycle,
opaque redirects, IndexedDB persistence across reloads.
