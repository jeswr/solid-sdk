<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# `web/` — the Pod Docs static host shell

This directory turns the framework-agnostic `@jeswr/pod-docs/ui` React component
library (`../src/ui`) into a **deployable, statically-served single-page app**
with standalone Solid login. It is the canonical "host shell" pattern: the same
shape replicates across every `pod-*` app (see the recipe at the bottom).

The host is intentionally tiny. The whole app is: log in → derive the user's pod
from the session → mount the library component → let it read/write the pod. All
the data logic (LDP, RDF, optimistic create/save, Type-Index discovery) lives in
the library; the host only wires **auth + a pod root**.

## How it works

```
index.html → src/main.tsx
  └─ <SessionProvider>            (src/auth/SessionProvider.tsx — the ONE auth seam)
       └─ <App>                   (src/App.tsx)
            ├─ logged out → <LoginScreen>          (WebID-first login)
            └─ logged in  → <DocumentBrowser       (@jeswr/pod-docs/ui)
                              podRoot webId />
```

### Auth (standalone, no server)

`SessionProvider` is the only place auth is wired. On mount it:

1. snapshots the pristine `globalThis.fetch` (for the pre-popup public profile
   read, so it can never recurse on a 401);
2. **dynamically** imports `@solid/reactive-authentication` (so the browser-only
   custom element + oauth stack never evaluate at module-eval / SSR / prerender
   time — verified by the build: `customElements.define` is `0` in the main
   bundle and lives only in the lazily-imported chunk);
3. builds a `WebIdDPoPTokenProvider` (ported from `create-solid-app`) bound to
   this origin's **static Client Identifier Document** at
   `${origin}/clientid.jsonld`, so the consent screen shows "Pod Docs" instead
   of a throwaway dynamic registration;
4. calls `manager.registerGlobally()` — **this is what patches the global
   `fetch`** (the 0.1.3 constructor does NOT). Forgetting it is the #1
   reactive-auth bug.

Once patched, every plain `fetch()` — including the ones inside `@jeswr/fetch-rdf`
and the `@jeswr/pod-docs` data layer — transparently upgrades on a 401 with a
DPoP token. So `<DocumentBrowser>` is mounted with **no `fetch` prop**: its
`fetch?:` seam falls back to the now-authenticated ambient global.

Login is WebID-first: the user enters their WebID, the issuer is resolved from
the WebID profile (never a hard-coded IdP), the popup mints a DPoP token, and a
probe of the (private) storage root proves the session
(`assessLoginProbe` — per-attempt token-attach delta, not a sticky flag).
`allowInsecureLoopback` is enabled **only** for a `localhost` origin (dev against
a local CSS over HTTP); a deployed HTTPS origin stays strict.

> Tokens are in-memory only — closing the tab logs out. Durable session restore
> (DPoP refresh token in IndexedDB, proactive refresh) is the Pod-Manager
> enhancement and a documented follow-up for this shell; `scope` already
> requests `offline_access` so it's a provider-level add, not a redesign.

### How the documents container is derived from the session

`<DocumentBrowser podRoot webId />` needs only a **pod root** + the **WebID**.
The host derives them in `src/auth/session-derivation.ts`:

- **pod root** = the **first `pim:storage`** advertised on the WebID profile (the
  canonical Solid "where my storage lives" signal). Fallback when a profile omits
  `pim:storage`: the **WebID origin** (`scheme://host/`). A banner tells the user
  when the fallback is used.
- The **documents container itself is NOT derived here.** `@jeswr/pod-docs`'s
  `DocsStore` owns that: it registers / resolves the `pod-docs/` container via the
  user's **Type Index** (`ensureTypeRegistrations`) for cross-app discovery,
  falling back to the conventional `${podRoot}pod-docs/`. So the host's only job
  is a correct pod root; container discovery is the data layer's concern. Every
  write is scope-guarded in the data layer, so a wrong pod-root guess fails
  closed, not silently.

### The per-origin static auth artifacts

Solid-OIDC **dereferences** the `client_id` URL, so each deployment must serve
its OWN Client Identifier Document whose `client_id` / `redirect_uris` /
`client_uri` all point at its origin. `scripts/gen-clientid.mjs` generates both
files from a single `APP_ORIGIN` env, written into `public/` before every build:

- `public/clientid.jsonld` — `client_id: ${origin}/clientid.jsonld`,
  `redirect_uris: [${origin}/callback.html]`, `client_uri: ${origin}/`,
  `scope: "openid webid offline_access"`,
  `grant_types: [authorization_code, refresh_token]`,
  `response_types: [code]`, `token_endpoint_auth_method: "none"`.
- `public/callback.html` — the OAuth popup → opener post-back. It targets the
  message at **our origin only** (`postMessage(href, "${origin}")`), never `"*"`,
  because the URL carries the authorization code.

Both are git-ignored (a per-origin artifact; the script + `APP_ORIGIN` are the
source of truth) and copied by Vite into `dist/` at the root.

> `ignore-scripts=true` (supply-chain hardening) means **npm lifecycle hooks do
> NOT run** — so the generator is chained INLINE in the `build`/`dev` scripts
> (`node scripts/gen-clientid.mjs && vite …`), not as a `prebuild` hook (a `pre*`
> hook would be silently skipped).

## Build + run

```bash
# Dev (defaults APP_ORIGIN to http://localhost:5173):
npm install
npm run dev

# Production build for a specific origin:
APP_ORIGIN=https://docs.solid-test.jeswr.org npm run build
#   → emits a fully static dist/:
#       dist/index.html
#       dist/clientid.jsonld          (client_id = that origin)
#       dist/callback.html            (postMessage target = that origin)
#       dist/assets/*.js, *.css       (hashed; reactive-auth code-split into a
#                                      lazily-imported chunk)
```

`npm run build` output dir: **`dist/`** — serve it with any file server
(`caddy file_server`, etc.). The Vite config aliases `@jeswr/pod-docs/ui` →
`../src/ui/index.ts`, so Vite bundles the library's **TypeScript source
directly** — no pre-built `dist/ui` is required.

Gates: `npm run lint` (Biome), `npm run typecheck` (tsc — the library source is
NOT re-typechecked here; `src/pod-docs-ui.d.ts` declares the consumed surface),
`npm run build`.

## Env

| Var | Used by | Default | Notes |
|---|---|---|---|
| `APP_ORIGIN` | `gen-clientid.mjs` (build) | `http://localhost:5173` | The deployment origin. Set per-subdomain for prod. |
| `VITE_APP_ORIGIN` | UI label only | `http://localhost:5173` | Mirror of `APP_ORIGIN`; non-load-bearing (the runtime `client_id` derives from the actual window origin). |
| `VITE_HOME_IDP` | `LoginScreen` hint | `https://idp.solid-test.jeswr.org` | Display only — the auth issuer always comes from the WebID profile. |

---

## RECIPE — replicate this host for the other `pod-*` apps

Each `pod-*` repo ships `src/ui` = a framework-agnostic component library with an
injectable `fetch?:` seam. To give one a deployable SPA, copy this `web/`
directory into that repo and change **four things**:

1. the imported component + the prop it needs (table below);
2. the Vite alias target (`@jeswr/<pkg>/ui` → `../src/ui/index.ts`) + the
   `src/pod-docs-ui.d.ts` ambient declaration to match that component's props;
3. the container-derivation in `src/auth/session-derivation.ts` (what URL the
   component's prop wants — see "derive" column);
4. the per-subdomain `APP_ORIGIN` and the `client_name` in `gen-clientid.mjs`.

Everything else — `SessionProvider`, `LoginScreen`, the token provider, the
`gen-clientid` script, the build wiring — is identical.

| Repo | Component (`@jeswr/<pkg>/ui`) | Required prop(s) | Derive the prop from the session as… | `APP_ORIGIN` (prod) |
|---|---|---|---|---|
| `pod-docs`  | `DocumentBrowser` | `podRoot: string`, `webId: string` | pod root = `storages[0]` (else WebID origin); container discovered by the data layer via Type Index | `https://docs.solid-test.jeswr.org` |
| `pod-music` | `MusicLibrary`    | `base: string` | the **music container** `${podRoot}music/` (NOT the bare pod root) — the library derives `tracks/`/`albums/`/`playlists/` directly under `base` | `https://music.solid-test.jeswr.org` |
| `pod-drive` | `FileBrowser`     | `rootUrl: string` | the pod root (`storages[0]`) — the file tree root to browse | `https://drive.solid-test.jeswr.org` |
| `pod-photos`| `PhotoGallery`    | `rootUrl: string` | the gallery root container — the pod root (`storages[0]`), or a `${podRoot}photos/` container | `https://photos.solid-test.jeswr.org` |
| `pod-money` | `AccountsView`    | `ledgerUrl: string` | the ledger **document** URL, e.g. `${podRoot}finance/ledger.ttl` (from `MoneyStore.ledgerUrl`; Type-Index-discoverable) | `https://money.solid-test.jeswr.org` |
| `pod-health`| `HealthRecords`   | `resourceUrl: string` | the health **record document** URL, e.g. `${podRoot}health/record.ttl` | `https://health.solid-test.jeswr.org` |
| `pod-mail`  | `Inbox`           | `mailboxUrl: string` | the mailbox **document** URL, e.g. `${podRoot}mail/folders/inbox.ttl` (derive via the data layer's `folderDocument(podRoot, WellKnownFolders.inbox)`) | `https://mail.solid-test.jeswr.org` |
| `pod-chat`  | `ChatRooms`       | `podRoot: string`, `webId: string` | pod root = `storages[0]`; same shape as `pod-docs` | `https://chat.solid-test.jeswr.org` |

Notes / gaps for the 8:

- **`pod-drive`/`pod-photos`/`pod-chat`** take a pod-root-shaped URL
  (`rootUrl`/`podRoot`) → derive exactly like `pod-docs` (`storages[0]`,
  origin fallback). `pod-chat` additionally needs `webId` (already in the
  session). (`pod-photos` may instead point `rootUrl` at a `${podRoot}photos/`
  gallery container.)
- **`pod-music`/`pod-money`/`pod-health`/`pod-mail`** take a *specific
  container/document* URL, NOT a bare pod root — passing `storages[0]` here is a
  BUG. Derive `${podRoot}<conventional-slug>` for that app:
  - `pod-music` → the **music container** `${podRoot}music/` (`base`; the library
    derives `tracks/`/`albums/`/`playlists/` under it);
  - `pod-money` → the **ledger document** `${podRoot}finance/ledger.ttl`
    (`MoneyStore.ledgerUrl`);
  - `pod-health` → the **record document** `${podRoot}health/record.ttl`;
  - `pod-mail` → the **mailbox document** via `folderDocument(podRoot,
    WellKnownFolders.inbox)`.

  Prefer **Type-Index discovery** of that container/document where the data layer
  supports it (mirroring how `pod-docs` discovers `pod-docs/`), falling back to
  the conventional path. Confirm each app's expected slug against its data layer
  before shipping; treat a missing Type-Index registration as the same
  create-and-link fallback `pod-docs` uses.
- All eight components expose the same `fetch?:` seam → mount them with **no
  `fetch` prop** under this `SessionProvider`; the auth-patched global covers
  reads + writes.

### `solid-issues` is already a full app — it only needs a Client ID doc

`solid-issues` (`/Users/jesght/Documents/GitHub/jeswr/solid-issues`) is a
complete application, NOT a library, so it does **not** need this host shell. To
deploy it at `https://issues.solid-test.jeswr.org` it only needs its own
per-origin **Client Identifier Document** + `callback.html` for that subdomain
(same `gen-clientid.mjs` pattern: `client_id`/`redirect_uris`/`client_uri` all
pointing at `issues.solid-test.jeswr.org`). Reuse `scripts/gen-clientid.mjs`
with `APP_ORIGIN=https://issues.solid-test.jeswr.org` and a `client_name` of
"Solid Issues".
