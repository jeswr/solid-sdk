---
title: Upstream issue and PR resolution
---

# Upstream issue and PR resolution

Snapshot: [solid-contrib/reactive-authentication](https://github.com/solid-contrib/reactive-authentication)
`main` at `8467dd8` (2026-09-24), open issues and PRs as exported on 2026-09-26, PR heads and review comments
read with `gh` on 2026-09-26. This implementation starts from `82b677f` (Key Value Kit caches, the replacement
for #47) and is an independent implementation, kept in the personal repository
[jeswr/reactive-authentication-ai](https://github.com/jeswr/reactive-authentication-ai). No changes were made
upstream: no upstream issue or PR was commented on, closed or merged, and nothing was published to npm. "Remaining" lists what only maintainers or external services can do.

## Issues

| # | Title (short) | Behaviour here | Implementation | Test evidence | Remaining (external) |
| --- | --- | --- | --- | --- | --- |
| [46](https://github.com/solid-contrib/reactive-authentication/issues/46) | Storage context for cache keys and refresh locks | Sessions, issuer and metadata caches keyed by a verified storage context (LWS `lws#storage` + description + `StorageRoot`; Solid `storageDescription` + `pim:Storage`), each root confirming the binding; exact-URL fallback; same keys for Web Locks; discovery never widens the boundary; proofs per request | `StorageContext.ts`, `ContextKey.ts`, `OidcSession.ts` (keys), `DPoPTokenProvider.ts` (`context`) | `components.test.js` "storage context …" (nested storages, broad/external/anchored/redirected claims); `solid-oidc.test.js` "storages are separate contexts", concurrency and cross-tab rotation tests | Solid-OIDC tokens remain audience `solid` by protocol design (documented) |
| [45](https://github.com/solid-contrib/reactive-authentication/issues/45) | Injectable caches with browser adapters | Every cache is a Key Value Kit store with memory default: issuer, metadata, client, storage mappings, OIDC credentials, refresh-only sessions, LWS tokens/metadata, client-credentials tokens; `createBrowserCaches` preset; storage errors reject, no silent fallback | `Caching*Provider.ts`, `createBrowserCaches.ts`, `FencedCache.ts`, `lws/LwsTokenProvider.ts` | `cache.test.js`, `providers.test.js`, `persistence.test.js`, `lws.test.js` "review-3 #5", browser `cache` | Key Value Kit is `0.1.0-alpha.0` (pinned) |
| [32](https://github.com/solid-contrib/reactive-authentication/issues/32) | Re-introduce Dependabot automerge | New workflow merges only after the CI workflow succeeded, only the tested head commit, only Dependabot, never semver-major; CI `summary` gates audit, tests (3 OSes), browser, docs | `.github/workflows/dependabot-merge.yml`, `.github/workflows/ci.yml`, `.github/dependabot.yml` | Reviewable config (not executable locally) | Maintainer must allow Actions to merge PRs; required status checks on `main` recommended |
| [29](https://github.com/solid-contrib/reactive-authentication/issues/29) | Per-callback caching instead of `#session` | Caching stays per component (issuer, discovery, client); credentials in `OidcSession` keyed per context, not a monolithic session object | `Caching*Provider.ts`, `OidcSession.ts` | `providers.test.js`, `solid-oidc.test.js` | — |
| [28](https://github.com/solid-contrib/reactive-authentication/issues/28) | Improve reactive algorithm (incl. #12 leftovers) | Challenge-driven provider selection, bounded DPoP-nonce retry (RS and token endpoint), bounded renewal, `prompt=consent` for interactive `offline_access`, missing `expires_in` = until rejected | `ReactiveAuthenticationClient.ts`, `dpopNonce.ts`, `authorizationCodeGrant.ts` | `core.test.js` "bounded retries"; `solid-oidc.test.js` nonce and consent tests | — |
| [27](https://github.com/solid-contrib/reactive-authentication/issues/27) | Intercept requests in service workers | `installReactiveAuthentication` answers fetch events inside the boundary; UI through a validated, bounded MessageChannel bridge routed to the requesting tab | `worker/serviceWorker.ts`, `worker/messages.ts`, `ReactiveFetchWorkerManager.ts` | `components.test.js` bridge/routing tests; browser `sw` (two tabs, per-tab interaction) | — |
| [15](https://github.com/solid-contrib/reactive-authentication/issues/15) | Refresh-only SessionStore | `sessionStore` persists refresh token + non-extractable DPoP key + client, never access/ID tokens; restore via refresh grant without a window, folded into `upgrade` plus `restore(request)`; `invalid_grant` clears | `OidcSession.ts`, `DPoPTokenProvider.restore` | `persistence.test.js`, `solid-oidc.test.js` "refresh-only persistence …", browser `cache` | — |
| [5](https://github.com/solid-contrib/reactive-authentication/issues/5) | Issuer hints in the application URL | Both forms: the requested `#autologin/<WebID>` (raw or percent-encoded, WebID fragments kept, HTTPS only) and OIDC third-party-initiated login (`iss`, `login_hint`, `target_link_uri`). Used once; the WebID must be approved **before** its profile is fetched, then exactly one of its `solid:oidcIssuer`s; rejected, unreachable or ambiguous hints fall back to the picker (`IdpPicker.suggest` pre-fills) | `IssuerHint.ts` (`readWebIdHint`, `WebIdHintIssuerProvider`, `readIssuerHint`, `HintIssuerProvider`), `WebIdIssuerProvider.ts` | `components.test.js` "issue #5 …" (encoded/raw/fragment/malformed/rejected/ambiguous/once-only) and "issuer hints …" | —
| [3](https://github.com/solid-contrib/reactive-authentication/issues/3) | Set up Context7 | `context7.json` with docs/examples folders and usage rules | `context7.json` | — | Registering/indexing on context7.com is external |
| [2](https://github.com/solid-contrib/reactive-authentication/issues/2) | Create tests | 91 Node tests with real local servers + 6 Chromium smoke checks, in CI | `test/` | `npm test`, `npm run test:browser` | — |

## Pull requests

| # | Title (short) | Resolution | Evidence | Remaining |
| --- | --- | --- | --- | --- |
| [47](https://github.com/solid-contrib/reactive-authentication/pull/47) | Configurable provider caches | Superseded by the Key Value Kit design already at `82b677f` (maintainer-requested); extended to all new caches | see #45 | Close in favour of this work (maintainer action) |
| [34](https://github.com/solid-contrib/reactive-authentication/pull/34) | Bump TypeScript 6.0.3 → 7.0.2 | **Not applied.** `typescript@7.0.2` exports only `./lib/version.cjs` and `./unstable/*` (no stable compiler API); `typedoc@0.28.20` (latest) requires `typescript` 5.0–6.0.x (TypeStrong/typedoc#3098), CI on the PR fails. Peer errors were not bypassed; Dependabot now ignores TypeScript majors until typedoc supports 7 | `package.json` (`typescript ^6`), `.github/dependabot.yml` | Close PR; revisit when typedoc supports TS 7 |
| [26](https://github.com/solid-contrib/reactive-authentication/pull/26) | Report token response for WebID | Implemented differently: providers report a validated `Identity` (issuer, subject, `webid`, `azp`, audience, `webIdVerified`) instead of the secret token response; optional WebID profile check | `Identity.ts`, `OidcSession.ts`, `DPoPTokenProvider.identity/restore` | `solid-oidc.test.js` identity and refresh-identity tests | — |
| [23](https://github.com/solid-contrib/reactive-authentication/pull/23) | Session teardown with supersession fence | `forget()` on every provider and `manager.logout()`; durable generation fence with Web Locks and BroadcastChannel (not only an in-process counter); revocation (RFC 7009) with failures reported after local clearing | `SessionFence.ts`, `FencedCache.ts`, `OidcSession.forget`, `ReactiveFetchManager.logout` | `solid-oidc.test.js` "review #2/#4", `lws.test.js` "review-3 #2", `components.test.js` client-credentials forget, `core.test.js` logout timing | Cross-device logout needs IdP logout (out of scope) |
| [22](https://github.com/solid-contrib/reactive-authentication/pull/22) | Allowed-origins credential boundary | Mandatory `CredentialBoundary` of container prefixes (origin + path segment), encoded traversal rejected, redirects re-evaluated per hop; `unrestricted()` only as deprecated opt-in | `CredentialBoundary.ts`, `url.ts`, `ReactiveAuthenticationClient.ts` | `core.test.js` boundary/redirect tests, `solid-oidc.test.js` look-alikes | Breaking change (documented in README) |
| [21](https://github.com/solid-contrib/reactive-authentication/pull/21) | Custom fetch for provider requests | `HttpOptions.fetch` on all components via `oauth.customFetch` (as the reviewer suggested); default `nonReactiveFetch()` bypasses a registered reactive fetch | `transport.ts` | `solid-oidc.test.js` "#21" with `registerGlobally` | — |
| [18](https://github.com/solid-contrib/reactive-authentication/pull/18) | Opt-in insecure OAuth requests | Explicit per-component `allowInsecureRequests` (reaches service workers because it is configuration, unlike a page-global static) plus `allowInsecureHttp` on boundaries; one console warning; old unconditional insecure default removed with `BearerTokenProvider` | `transport.ts`, `CredentialBoundary.ts` | `solid-oidc.test.js` "#18" | Maintainer preferred a global switch in review; per-instance chosen for workers (open decision) |
| [14](https://github.com/solid-contrib/reactive-authentication/pull/14) | Renew once on rejected token | `invalidate` hook; one renewal per request (refresh grant, else authorization); stale invalidation ignored; discarded bodies cancelled (review comment) | `TokenProvider.ts`, `ReactiveAuthenticationClient.ts`, `OidcSession.invalidate`, `FencedCache.removeIf` | `solid-oidc.test.js` "rejected token …", `core.test.js` "bounded retries", `lws.test.js` / `components.test.js` "final-check #2" (stale invalidation keeps the replacement) | — |

## Beyond the backlog

- **Solid-OIDC §9 UMA** (`SolidUmaTokenProvider`): previously `DPoPTokenProvider` claimed UMA challenges and
  sent the OP's access token; it now leaves them to the UMA provider (ticket exchange with the DPoP-bound ID
  token). Evidence: `test/uma.test.js`.
- **Retained server compatibility exceptions** are limited to exact issuer origins and can be disabled with
  `serverQuirks: false` (see [protocols](protocols.md#retained-compatibility-exceptions)); `test/quirks.test.js`.

## Deliberate migration changes

- `ReactiveFetchManager` / `ReactiveAuthenticationClient` take an options object with a required `boundary`.
- Custom elements moved to `@solid/reactive-authentication/elements` (main entry point is DOM-free).
- `BearerTokenProvider` (hard-coded issuers, callback, always-insecure HTTP) and the non-functional
  `reactive-fetch-worker` script were removed; use `DPoPTokenProvider` and `installReactiveAuthentication`.
- `ClientCredentialsTokenProvider(asProvider, clientId, secret, options)` replaces hard-coded issuer mapping.
- Supplied (shared or persisted) credential stores require a namespace and a shared `SessionFence`.
- `DPoPTokenProvider.identity(request)` replaces issuer-keyed lookups; sessions are storage-scoped.
- `DPoPTokenProvider` no longer answers UMA challenges; add `SolidUmaTokenProvider` for UMA servers.
- `TokenProvider.matches/upgrade` receive an optional challenge context; existing providers keep working.
