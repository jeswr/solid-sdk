# Solid Browser Extension — Implementation Plan

## Current baseline

The `feat/phase-2-class-grants` implementation provides browser-level Solid sign-in,
`window.solid`, popup and side-panel account surfaces, a gated shared replica, and
per-data-class consent. This document records the implemented baseline; the broader
[shared-replica architecture](docs/design/shared-replica-architecture.md) remains a design
record with follow-up work. The [README](README.md#windowsolid) gives the public API types.

## Architecture and project structure

```text
Page (MAIN world) <-> Content script (ISOLATED) <-> Service worker
    inject.ts          content-script.ts            service-worker.ts
                 postMessage                 chrome.runtime
```

The worker owns authentication, credentials, grants, and replica access. Page code receives
only token-free responses. The ISOLATED bridge stamps the real page origin; the worker
cross-checks it against Chrome's sender before authorizing a request.

| Path | Implemented responsibility |
|------|----------------------------|
| `src/background/auth-flow.ts` | Solid-OIDC authorization code + PKCE + DPoP through `chrome.identity.launchWebAuthFlow` |
| `src/background/session-store.ts` | Session tokens, profile, recent accounts, client IDs, and grants in `chrome.storage.local` |
| `src/background/core/dpop-key-db.ts` / `dpop-key-store.ts` | Non-extractable private `CryptoKey` persistence in worker-owned IndexedDB |
| `src/background/core/authenticated-fetch.ts` / `origin-policy.ts` | Target-origin credential boundary, header stripping, and DPoP nonce retry |
| `src/background/core/requesting-origin.ts` | Default-deny app-origin verification and same-origin-only foreign fetch policy |
| `src/background/core/class-request.ts` / `request-access-throttle.ts` | Request validation, bounded expiry, user-gesture requirement, and prompt rate limit |
| `src/background/core/class-resolve.ts` | Solid Type Index class-to-target resolution confined to pod origins |
| `src/background/core/class-grant.ts` / `consent.ts` | Pinned-target grant model, mode/expiry checks, and per-class consent decisions |
| `src/background/core/replica*.ts` | Gated CacheStorage bytes, IndexedDB metadata/nonces, conditional revalidation, and write-through |
| `src/background/global-fetch-register.ts` / `src/inject/inject.ts` | Best-effort MAIN-world injection and global fetch routing |
| `src/shared/messages.ts` | Token-free page/bridge/worker message protocol and grant summaries |
| `src/consent/` | Extension-chrome consent window |
| `src/popup/` / `src/sidepanel/` | Shared account surface built with `@jeswr/solid-elements` |
| `e2e/` / `test-site/` | Headed Chromium tests against local Community Solid Server and app sites |

The MV3 manifest declares `storage`, `identity`, `sidePanel`, `contextMenus`, and `scripting`
permissions and `<all_urls>` host access. Both content worlds are declared in the manifest;
the worker also attempts programmatic MAIN-world registration. Injection has an idempotency
guard. The broad matches enable discovery, while the worker's access checks enforce the
boundary. See [permission rationale](docs/manifest-permissions.md).

## Implemented `window.solid` API

The installed object is frozen and its window property is non-configurable. It exposes:

| Member | Behavior |
|--------|----------|
| `webId` | Current WebID or `null`; the worker withholds identity from ungranted origins |
| `fetch(input, init?)` | Proxied request, gated before replica access or pod egress |
| `setClientId(clientId)` | Store a valid Client Identifier Document URL for the verified origin and grant it legacy whole-pod access |
| `login(webId)` | Start interactive Solid-OIDC login; successful verified page login grants its origin |
| `logout()` | Clear the local session and class grants, and purge replica data |
| `requestAccess({ classes, modes, purpose?, duration? })` | Open per-class consent and return `{ ok, grants }` |
| `listGrants()` | List this origin's live class-grant summaries for the active WebID |
| `revokeGrant(grantId)` | Remove this origin's class grant, purge its replica slice, and return whether removed |
| `resolveClass(classIRI)` | Return `{ shape, targets }` for an allowed class; currently `shape: null` |

Presence is announced through `solid-extension:ready` and the sticky
`data-solid-extension="1"` marker on `<html>`. Neither carries identity. The global fetch
patch is best-effort transparency: same-origin requests stay native, and cross-origin
HTTP(S) requests consult the worker. If it declines, a passthrough sentinel makes the page
use its captured native fetch with the original arguments. Explicit `solid.fetch` keeps
the worker's denial response.

### Class-grant flow and enforcement

1. Sign in through the extension. A click/keypress in an app calls `requestAccess` with
   class IRIs, modes, an optional purpose, and a positive ISO-8601 duration. Although the
   TypeScript argument permits omitting `duration`, runtime validation requires it and
   caps the lifetime at 365 days (year/month components approximate 365/30 days).
2. Before discovery or consent, the worker verifies the origin and requires transient
   activation stamped by the ISOLATED bridge. It admits at most three requests per origin
   per minute with a best-effort in-memory throttle that resets on worker restart.
3. Resolve the WebID's public/private Type Index registrations (`solid:forClass` with
   `solid:instance` / `solid:instanceContainer`) to concrete pod targets. The consent window
   shows the origin, classes, modes, purpose, expiry, and targets. Only the extension's own
   context may approve; each approved class mints one immutable grant. Deny-all returns
   `{ ok: false, grants: [] }`; validation/session/throttle failures reject the promise.
4. Pin the resolved targets in each grant. Class-only origins must satisfy URL membership,
   mode, active WebID, and expiry on every request, including a cache hit. Unknown classes
   with no targets authorize nothing. Later resolution does not widen an existing grant.
5. `listGrants` filters by verified origin, active WebID, and expiry. `resolveClass` requires
   an active session and granted origin; a class-only origin can inspect only a class it
   currently holds. Full-grant origins can inspect any class. These APIs expose no tokens.
6. `revokeGrant` removes the grant before best-effort replica-slice purging, so purge failure
   cannot preserve authorization. Bytes still covered by another live read grant for the
   same origin are retained. Expired grants are pruned and their slices purged on access.

Implemented modes are `read`, `append`, and `write` (case-insensitive). GET/HEAD require
read, POST requires append, and PUT/PATCH/DELETE require write. Write also covers append,
but does not imply read. Instances match exact resource paths; containers include
descendants. Purpose is an audit/display anchor, not an enforced restriction.

Legacy whole-pod origin grants retain their broader access and take precedence over class
grants. Revoking a class grant does not remove that separate legacy origin authorization.
This is the existing compatibility behavior, not a migration to the later origin-grant model.

## Authentication, storage, and replica

Authentication uses Web Crypto + `jose`, with RDF issuer/profile discovery through N3.js.
The redirect is `chrome.identity.getRedirectURL('callback')`; no extension redirect page is
used. A page-declared Client ID Document is carried into login; otherwise the extension
tries its configured document and falls back to dynamic registration. The shipped hosted
URL and extension ID remain placeholders pending a separate hosting/pinning task.

Access/refresh tokens stay in `chrome.storage.local`. The private DPoP key is non-extractable
and persists as a structured-cloned `CryptoKey` in IndexedDB across worker suspension.
Refresh reuses that key and persists rotated tokens before use. The audited
`@jeswr/solid-session-restore` decision supports silent restore.

Replica bytes live in CacheStorage; metadata and DPoP nonces live in IndexedDB. Cache keys
include the active WebID and grant scope. Reads revalidate and never treat cached bytes as
authoritative. Writes are synchronous write-through with conditional headers. Logout
purges before further serving. Page-provided Authorization/DPoP headers are stripped;
credentials attach only to allowed target origins, never the token endpoint or remote
cleartext targets. A foreign target must be the requesting app's own origin to be proxied
without a Solid token.

## Build and verification

Use npm with the committed lockfile and Node.js 24:

```bash
npm ci --ignore-scripts
npm run gate           # Biome + tsc + Vitest + webpack
npm run test:e2e       # build + headed Chromium against local CSS only
```

Webpack compiles six entries: service worker, popup, side panel, content bridge, inject,
and consent. CopyWebpackPlugin ships the manifest, HTML/CSS, icons, and Client ID Document.
TypeScript is strict. Runtime dependencies remain those declared in `package.json`;
this documentation/CI refresh adds none.

The unit suite uses fixtures and mocked fetch/browser/storage ports. Adversarial coverage
includes forged/opaque origins, ungranted cache hits, cross-WebID isolation, class scope and
expiry, consent sender checks, revocation/purge failures, resolver SSRF, and prompt throttling.
E2E uses local CSS on port 3000 and app sites on ports 8080/8081, never production services.

CI uses `actions/checkout@v5`, `actions/setup-node@v5`, and `node-version: '24'`, runs the full
`npm run gate`, then installs Chromium and runs `xvfb-run npm run test:e2e`.

## Remaining design work

The existing resolver implements only the Type Index rung. SAI DataRegistration discovery
and SHACL validation remain unimplemented; `shape` is always `null`. Central WebSocket
invalidation and offline write queues also remain follow-ups in the shared-replica design.

The separate extension roadmap covers a stable extension ID and hosted Client ID Document,
multiple profiles, a new per-origin grant model with scoped injection, grant-management UI,
and form-fill. These are outside this Node 24 / documentation landing task.
