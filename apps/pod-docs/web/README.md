<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# `web/` — the Pod Docs static host shell

This directory turns the framework-agnostic `@jeswr/pod-docs/ui` React component
library (`../src/ui`) into a **deployable, statically-served single-page app**
with standalone Solid login. It is the canonical "host shell" pattern: the same
shape replicates across every `pod-*` app (see the recipe at the bottom).

The host is intentionally tiny. The whole app is: log in → derive the user's pod
from the session → mount the library component → let it read/write the pod. All
the data logic (LDP, RDF, optimistic create/save, Type-Index discovery) lives in
the library; the host wires auth, a pod root, and the saved documents collection.
`CollectionBrowser` persists server-assigned collection URLs in local storage keyed by
WebID and storage root, and passes `container` / `onContainerChange` to the library.
Remounts restore the exact collection identifier; identity and root changes use separate
selections. A late assignment remains associated with its original identity. If storage
cannot be read or written, the host reports an error before creating another collection.

## How it works

```
index.html → src/main.tsx
  └─ <SessionProvider>            (@jeswr/app-session/react)
       └─ <App>                   (src/App.tsx)
            ├─ logged out → <LoginScreen>          (@jeswr/app-session/react)
            └─ logged in  → <CollectionBrowser>    (src/CollectionBrowser.tsx)
                              └─ <DocumentBrowser podRoot webId container onContainerChange />
```

### Auth (standalone, no server)

Docs configures `@jeswr/app-session` in `src/auth/pod-auth.ts` and passes its name and
legacy credential keys to the shared React provider in `src/main.tsx`. The package owns
the page-lifetime `@jeswr/pod-auth` core and `@jeswr/suite-ui/sign-in` card, as in Pod Drive. Recent accounts appear
first; users can also enter an address, choose the home provider or another listed
provider, or enter a custom provider address. Addresses are resolved through a
pristine public fetch. A WebID with several providers asks the user to choose a
provider explicitly.

The core restores once on mount, including React StrictMode replay, and owns all
credentials, persistence and logout. `auth.fetch` is passed explicitly to
`DocumentBrowser`; global fetch stays public. The default automatic credential
boundary uses only the authenticated WebID's advertised storage roots. Public
profile reads for the display name, avatar and pod root use the pristine public
transport.

The popup element is lazily registered from `@jeswr/reactive-authentication/registerElements`.
A StrictMode-safe holder adapts its disposable result to the full callback URL.
`allowInsecureLoopback` and pod-auth's dynamic client registration are enabled only
in a development build (`npm run dev`) whose hostname is localhost, 127.0.0.0/8 or
::1; every other build uses the HTTPS `clientid.jsonld`, so `vite preview` over HTTP
cannot sign in. Silent `prompt=none` re-authentication during restore is declined
(no popup without a click). The popup supports cancellation; errors use plain
messages without raw protocol details. On first load the app removes the
sessionStorage autologin markers left by builds before pod-auth.

A `#autologin/<encoded-webid>` deep link adds a one-click account row and is
removed from the address bar. It never opens a popup or redirects without a click.
Only `callback.html` is registered as an OAuth redirect URI.

### How the documents container is derived from the session

`<DocumentBrowser podRoot webId />` needs only a **pod root** + the **WebID**.
The shared `@jeswr/app-session` `deriveSession` helper derives them:

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
#       dist/assets/*.js, *.css       (hashed; the popup element code-split into a
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
injectable `fetch?:` seam. To give one a deployable SPA, use `@jeswr/app-session`
for authentication and adapt this host's application wiring:

1. the imported component + the prop it needs (table below);
2. the Vite alias target (`@jeswr/<pkg>/ui` → `../src/ui/index.ts`) + the
   `src/pod-docs-ui.d.ts` ambient declaration to match that component's props;
3. the component's storage props (what URL it wants — see "derive" column), the
   app name, and its obsolete credential keys passed to `SessionProvider`;
4. the per-subdomain `APP_ORIGIN` and the `client_name` in `gen-clientid.mjs`.

Import `SessionProvider`, `useSession` and `LoginScreen` from `@jeswr/app-session/react`.
Keep environment reads and client identity configuration in the app; see the
[package guide](../../../packages/app-session/README.md). The `gen-clientid` script
and build wiring follow the same pattern across hosts.

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
