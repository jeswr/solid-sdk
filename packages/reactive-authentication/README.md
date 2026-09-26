# Reactive authentication

> **Independent implementation, not released.** This repository,
> [jeswr/reactive-authentication-ai](https://github.com/jeswr/reactive-authentication-ai), is a separate
> implementation built on [solid-contrib/reactive-authentication](https://github.com/solid-contrib/reactive-authentication)
> at `82b677f`. It has not been merged upstream or published to npm: `@solid/reactive-authentication` on npm
> (0.1.x) does **not** contain the API described here. Build and install it from source (see [Install](#install)).

Authenticate `fetch` reactively: send requests as they are, and when a server inside an explicitly trusted
boundary answers `401`, let a composable provider upgrade the request with credentials and retry it.

Supports [Solid-OIDC](https://solidproject.org/TR/oidc) (DPoP-bound tokens, refresh rotation, WebID
identity, UMA authorization servers), OAuth client credentials, and the active [W3C Linked Web Storage](https://github.com/w3c/lws-protocol)
authentication suites — OpenID Connect, SAML 2.0 and self-signed controlled identifiers — through RFC 8693
token exchange, plus the discontinued `did:key` draft retained for compatibility (the controlled-identifier
suite supersedes it). Any other protocol plugs in through the `TokenProvider` interface. See the
[protocol support matrix](docs/protocols.md) for sources, test evidence and draft limitations.

## Install

Requires Node.js 24.5 or later to build and test (Web Locks).

```batch
git clone https://github.com/jeswr/reactive-authentication-ai.git
cd reactive-authentication-ai
npm install
npm run build                 # compiles to dist/
npm pack                      # produces solid-reactive-authentication-<version>.tgz in this directory
```

Then, in your application, install the tarball (or the checkout directory) by its local path:

```batch
npm install /path/to/reactive-authentication-ai/solid-reactive-authentication-<version>.tgz
```

The package name is still `@solid/reactive-authentication`, so imports below work once the tarball built from this repository is
installed; do not expect them to work against the npm release.

## Quick start (Solid-OIDC in a page)

```js
import "@solid/reactive-authentication/registerElements"
import {
    CachingAuthorizationServerProvider, CachingClientProvider, CredentialBoundary, DPoPTokenProvider,
    DynamicRegistrationClientProvider, ReactiveFetchManager, XASProvider,
} from "@solid/reactive-authentication"

const provider = new DPoPTokenProvider(
    "https://app.example/callback.html",                    // posts its URL to the opener (see callback.html)
    document.querySelector("authorization-code-flow"),      // popup UI
    new CachingAuthorizationServerProvider(new XASProvider(document.querySelector("idp-picker"))),
    new CachingClientProvider(new DynamicRegistrationClientProvider()),
)

const manager = new ReactiveFetchManager({
    providers: [provider],
    boundary: new CredentialBoundary(["https://alice.solidcommunity.net/"]), // who may receive credentials
})

const response = await manager.fetch("https://alice.solidcommunity.net/private/notes.ttl")
```

```html
<authorization-code-flow></authorization-code-flow>
<idp-picker><option value="https://solidcommunity.net"></option></idp-picker>
```

`manager.registerGlobally()` replaces `globalThis.fetch` (reversible with `unregisterGlobally()`); providers
keep using the replaced function for their own requests, so login cannot deadlock on itself.

A complete page with persistence, issuer hints, identity and logout is in [`examples/solid-oidc.html`](examples/solid-oidc.html).
More examples: [LWS suites, service worker, client credentials, custom protocols](examples/README.md).

## Concepts

- **Credential boundary.** `new CredentialBoundary([...])` lists containers (trailing `/`, matched by origin and
  path segment) and exact resources that may receive credentials. Anything else — third-party URLs found in
  data, look-alike hosts, `/alice-evil/`, encoded traversal such as `/alice/%2e%2e%2f` — is fetched without
  credentials and never upgraded. Widen it at runtime with `boundary.add()`; storage discovery never widens a
  static boundary. Alternatively opt into an [automatic boundary](#automatic-credential-boundary) that
  admits verified storage roots.
- **Providers** decide whether they can answer a challenge (`matches(request, challenge)`) and attach
  credentials (`upgrade`). Optional `invalidate` renews rejected credentials; `forget` logs out.
- **Reactive algorithm.** Bodies are buffered (bounded, abortable) for replay; one retry for DPoP nonces and
  one renewal after a rejected token; credentialed redirects are followed hop by hop with credentials
  re-evaluated per URL; an authenticated write answered by a browser-hidden redirect is returned, not repeated.
- **Composable Solid-OIDC.** `IssuerProvider` (picker, `WebIdIssuerProvider`, `HintIssuerProvider`,
  `PatternIssuerProvider`) → `XASProvider` (discovery) → `ClientProvider` (dynamic registration or a Client
  Identifier Document) → `CodeProvider` (popup element, service-worker bridge, or your own) →
  `DPoPTokenProvider`. Caching wrappers accept [Key Value Kit](https://github.com/jeswr/KeyValueKit) stores.
- **Storage context.** Sessions and caches are grouped per verified Solid/LWS storage, falling back to the
  exact URL; see [protocols](docs/protocols.md#discovery-and-trust).
- **Identity.** `provider.identity(request)` reports validated ID token claims (issuer, subject, `webid`,
  `azp`), optionally checked against the WebID profile (`verifyWebId: true`). Tokens are never exposed.

## Automatic credential boundary

Applications that cannot list storages in advance can opt into `AutomaticCredentialBoundary`. No roots are
configured; when an eligible URL answers `401`, the boundary tries to establish its storage root **before**
any login or credential use, and only then lets providers authenticate:

```js
import { AutomaticCredentialBoundary, DPoPTokenProvider, ReactiveFetchManager } from "@solid/reactive-authentication"

const boundary = new AutomaticCredentialBoundary({
    eligible: url => url.hostname.endsWith(".solidcommunity.net"), // optional: which URLs may be discovered
    // traversal: "headers-only",                                  // never walk up the path
    // shouldTraverse: ({method, url}) => method === "GET",        // decide per 401
    // maxProbes: 4,                                               // HEAD budget per discovery (default 8)
})
const provider = new DPoPTokenProvider(callback, codeUi, asProvider, clientProvider, undefined, {context: boundary.contextKey})
const manager = new ReactiveFetchManager({providers: [provider], boundary})
await manager.fetch("https://alice.solidcommunity.net/private/notes.ttl") // discovers https://alice.solidcommunity.net/
```

1. **Link headers of that first 401** (no second request for the target): LWS `rel="https://www.w3.org/ns/lws#storage"`
   → storage description (`id`, type `Storage`) → its `StorageRoot` endpoint; Solid `storageDescription` →
   `pim:Storage` root; or the URL itself typed `Link: <http://www.w3.org/ns/pim/space#Storage>; rel="type"`.
   Roots must confirm the binding, be on the same origin and contain the URL.
2. In the default `"ancestors"` mode (and when `shouldTraverse` agrees), a write whose 401 has no Link headers
   gets one unauthenticated `HEAD` of the target. `traversal: "headers-only"` disables this fallback target
   probe and ancestor traversal; it still fetches a storage description the 401 advertises and `HEAD`-confirms
   that description's root.
3. **Solid ancestor traversal** (default; disable with `traversal: "headers-only"`): unauthenticated `HEAD`s
   of each parent container, nearest first, up to the origin root and `maxProbes`, stopping at the first
   container typed `pim:Storage`.

Discovery requests send no cookies, caller headers or credentials, never follow redirects, and require HTTPS
(`allowInsecureHttp` for local development). Without a verified root the `401` is returned and nothing is
disclosed. Roots are kept in memory for `lifetimeMs` (default one hour, at most `maxRoots`), and can be
inspected (`roots`) or dropped (`delete`, `clear`); in-flight discoveries are discarded after `clear` or
logout. Responses that are not `401` pass through without discovery. `boundary.contextKey` gives providers
the same roots for session grouping. A discovered root bounds *where* credentials may go; it is not user
consent to sign in there — use `eligible` or `approve(root, url)` to add such a policy. Servers that hide
Link headers from CORS or refuse unauthenticated `HEAD` cannot be discovered (fail closed). `eligible` is
checked on every request, so a discovered root never authorizes URLs the predicate excludes.

Limitations: storage descriptions must be on the resource's origin, so separately hosted LWS storage
descriptions are not accepted automatically (use a static `CredentialBoundary` for them). A remembered root
covers all its descendants until `lifetimeMs` elapses or it is removed with `delete(root)`/`clear()`; a more
specific storage advertised under it later is not re-discovered in the meantime.

## Solid-OIDC with UMA authorization servers

Servers answering `WWW-Authenticate: UMA as_uri="…", ticket="…"` (Solid-OIDC §9.1–9.3, UMA 2.0 grant) need
`SolidUmaTokenProvider`: it pushes the DPoP-bound ID token to the (trusted — default: same origin as the
resource) UMA authorization server with the permission ticket and presents the RPT with fresh DPoP proofs.
`DPoPTokenProvider` does not answer UMA challenges. UMA claims gathering (`need_info` with `redirect_user`)
is not automated: it fails with `UmaAuthorizationError` carrying the hint, without retrying.

## Issuer hints from other applications

`readIssuerHint` / `HintIssuerProvider` handle OpenID third-party-initiated login (`?iss=…&login_hint=…`);
`readWebIdHint` / `WebIdHintIssuerProvider` handle `#autologin/<WebID>` links. Both are used once and only
after application approval (the WebID before its profile is fetched, then exactly one of its issuers);
otherwise the fallback (e.g. `<idp-picker>`) is asked.

## LWS

```js
import { CredentialBoundary, DidKeySource, LwsTokenProvider, ReactiveFetchManager } from "@solid/reactive-authentication"

const manager = new ReactiveFetchManager({
    // Active suites: OidcIdTokenSource, SamlAssertionSource, SelfIssuedJwtSource (controlled identifiers).
    // DidKeySource implements the discontinued did:key draft (did:key subjects also work with the CID suite).
    providers: [new LwsTokenProvider(await DidKeySource.generate())],
    boundary: new CredentialBoundary(["https://storage.example/root/"]),
})
```

On `401` with `WWW-Authenticate: Bearer as_uri="…", realm="…"`, the provider checks the binding against its
trust policy (default: authorization server and realm on the requested resource's origin; use
`trustAuthorizationServers` or `trustBindings` otherwise), verifies the resource is in the realm, discovers
`/.well-known/lws-configuration`, exchanges the credential (`resource` = realm) and presents the Bearer token.

## Logout, persistence and multiple tabs

```js
const caches = createBrowserCaches("my-app/v1/account-1", {persistSessions: true})
const provider = new DPoPTokenProvider(callback, codeUi, asProvider, clientProvider, caches.token, {
    namespace: "my-app/v1/account-1", sessionStore: caches.sessions, fence: caches.fence,
})
const manager = new ReactiveFetchManager({providers: [provider], boundary, fence: caches.fence})
await manager.logout() // aborts in-flight upgrades and fences writes in every tab sharing the namespace
```

- `createBrowserCaches` keeps issuer/metadata/storage mappings in IndexedDB with a TTL (default one hour), client
  registrations and tokens in memory, and optionally **refresh-only** sessions in IndexedDB: refresh token,
  non-extractable DPoP key and client — never access or ID tokens. Reloads restore sessions with a refresh
  grant and no window (`provider.restore(request)` reports the identity without starting a flow).
- A rotating refresh token is consumed at most once across requests, tabs and workers (Web Locks); the
  durable record is authoritative and written before memory; a failed write leaves nothing usable.
- Logout increments a generation kept in IndexedDB, aborts in-flight work locally and (via BroadcastChannel) in
  other tabs, and clears stores; credentials from an older generation are never used. Refresh tokens known
  to the instance are revoked (RFC 7009) when the server supports it. Logout does not end the session at the
  identity provider.
- Namespaces isolate applications, client configurations and accounts; they are a convention, not a security
  boundary against same-origin scripts. Non-extractable keys prevent export, not use, by malicious same-origin
  JavaScript ([OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017.html)).
- Storage failures reject; there is no silent fallback to memory.

## Service workers

`installReactiveAuthentication(self, {boundary, providers})` (from `@solid/reactive-authentication/service-worker`)
authenticates fetches of controlled pages inside the boundary. `providers` may be a per-tab factory so that
popups open in the tab whose request needs them (`bridge.forClient(clientId)`); the page runs
`ReactiveFetchWorkerManager` to answer validated interaction requests. See [`examples/service-worker/sw.js`](examples/service-worker/sw.js) and [`page.html`](examples/service-worker/page.html).

## Local development

Plain-HTTP servers (e.g. Community Solid Server on `http://localhost:3000`) need explicit opt-ins, which also log
a warning: `{allowInsecureRequests: true}` for components making OAuth/discovery requests, and
`new CredentialBoundary([...], {allowInsecureHttp: true})`. Never enable them in production.

## Migrating from 0.1.x

- `new ReactiveFetchManager(providers)` → `new ReactiveFetchManager({providers, boundary})`.
  `CredentialBoundary.unrestricted()` reproduces the old "upgrade any 401" behaviour and is deprecated.
- Custom element classes moved to `@solid/reactive-authentication/elements`; `registerElements` is unchanged.
- `BearerTokenProvider` and `dist/reactive-fetch-worker.js` were removed (hard-coded issuers, insecure HTTP,
  non-functional worker); use `DPoPTokenProvider` and `installReactiveAuthentication`.
- `ClientCredentialsTokenProvider(asProvider, clientId, clientSecret, options)`.
- Supplied (shared or persisted) credential caches and session stores need a `namespace` and a shared `SessionFence`. Credential cache keys changed,
  so previously persisted credential records are not reused (reauthorization).
- Full list and rationale: [upstream resolution](docs/upstream-resolution.md#deliberate-migration-changes).

## Documentation

- [Protocol support, sources and draft limitations](docs/protocols.md)
- [Architecture and review guide](docs/architecture.md)
- [Upstream issue and PR resolution](docs/upstream-resolution.md)
- API reference: `npm run docs` (TypeDoc)

## Development

```batch
npm install
npm test               # build + Node tests against local mock servers
npm run test:browser   # Chromium smoke tests (npx playwright install chromium)
npm run docs
```

The demo (`index.html`) runs from any static server on the repository root after `npm run build`, e.g.
`npx http-server`, then [localhost:8080](http://localhost:8080).

Requires Node.js 24.5 or later (Web Locks). TypeScript stays on 6.x until typedoc supports TypeScript 7
(see [#34](docs/upstream-resolution.md)).

## History and license

The paradigm originates in [@langsamu](https://github.com/langsamu)'s research project
[Solid Explorer](https://github.com/langsamu/solid-explorer/) and was expanded by
[@hellikopter](https://github.com/hellikopter) and [@langsamu](https://github.com/langsamu) in
[.NET ReactiveAuthentication](https://github.com/ReactiveAuthentication/ReactiveAuthentication). This version
builds on [solid-contrib/reactive-authentication](https://github.com/solid-contrib/reactive-authentication).
MIT licensed; see [LICENSE](LICENSE).
