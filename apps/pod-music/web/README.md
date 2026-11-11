<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# `web/` — the Pod Music static host shell

This directory turns the framework-agnostic `@jeswr/pod-music/ui` React component
library (`../src/ui`) into a **deployable, statically-served single-page app**
with standalone Solid login. It is the canonical "host shell" pattern shared
across the `pod-*` apps (stamped from `pod-docs/web`).

The host is intentionally tiny. The whole app is: log in → derive the user's pod
→ resolve the music library container → mount `<MusicLibrary>` → let it read the
pod. All the data logic (LDP, RDF, Type-Index discovery) lives in the library;
the host wires **auth + a music base**.

## How it works

```
index.html → src/main.tsx
  └─ <SessionProvider>            (@jeswr/app-session/react)
       └─ <App>                   (src/App.tsx)
            ├─ logged out → <LoginScreen>          (@jeswr/app-session/react → SignInCard)
            └─ logged in  → <MusicLibrary          (@jeswr/pod-music/ui)
                              base={musicBase} fetch={fetch} />
```

### Auth (standalone, no server)

Music uses `@jeswr/app-session` for its page-lifetime `@jeswr/pod-auth` core,
React session provider and shared `LoginScreen` / `SignInCard`, the same path as
Pod Docs and Pod Drive. `src/auth/pod-auth.ts` supplies the app identity,
redirect URL, development flag, app name and exact legacy cleanup keys. Recent accounts appear
first; users can also enter an address, choose the home provider or another listed
provider, or enter a custom provider address. Addresses are resolved through a
pristine public fetch. A WebID with several providers asks the user to choose a
provider explicitly.

The core restores once on mount, including React StrictMode replay, and owns all
credentials, persistence and logout. `auth.fetch` is passed explicitly to
`MusicStore` discovery and `MusicLibrary`; global fetch stays public. The default automatic credential
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
`pod-music:pss.autologin.flow` and `pod-music:autologin-attempted` sessionStorage
markers, the `pod-music:remembered-account` localStorage pointer, and the
`pod-music:sessions` IndexedDB database left by builds before pod-auth. These
key lists go to `SessionProvider`, which uses the package's `clearLegacyCredentials`.
Other apps' storage and the Music theme preference are preserved.

A `#autologin/<encoded-webid>` deep link adds a one-click account row and is
removed from the address bar. It never opens a popup or redirects without a click.
Only `callback.html` is registered as an OAuth redirect URI.

### How the music base is resolved

`<MusicLibrary base />` needs the music library **container** (the data layer
derives `tracks/`/`albums/`/`playlists/` directly under `base`), NOT a bare pod
root. The shared package derives the pod root; `src/music-base.ts` resolves
the Music container:

- **pod root** = the first `pim:storage` advertised on the WebID profile, else the
  WebID origin (`scheme://host/`). A banner explains that this fallback can
  show only public music: the credential boundary grants no access to it.
- **music base** = via the data layer's Type-Index helper
  `MusicStore.findTrackContainers(webId)` — the parent of a container registered
  for `mo:Track`. When there is no registration (no profile link / no entry / a
  read failure) it falls back to the conventional `${podRoot}music/` and shows a
  banner so the user knows discovery found nothing registered.

### The per-origin static auth artifacts

Solid-OIDC **dereferences** the `client_id` URL, so each deployment must serve its
OWN Client Identifier Document. `scripts/gen-clientid.mjs` generates both files
from a single `APP_ORIGIN` env, written into `public/` before every build:

- `public/clientid.jsonld` — `client_id: ${origin}/clientid.jsonld`,
  `client_name: "Pod Music"`, `redirect_uris: [${origin}/callback.html]`,
  `client_uri: ${origin}/`, `scope: "openid webid offline_access"`,
  `grant_types: [authorization_code, refresh_token]`,
  `response_types: [code]`, `token_endpoint_auth_method: "none"`.
- `public/callback.html` — the OAuth popup → opener post-back, targeting the
  message at **our origin only** (`postMessage(href, "${origin}")`), never `"*"`.

The development artifacts are committed and regenerated from the script +
`APP_ORIGIN` before each build. Vite copies them into `dist/`. Set
`CLIENT_BASE_PATH=/solid-sdk/pod-music/` for a GitHub Pages identity under that base;
only `callback.html` is a permitted redirect.

> `ignore-scripts=true` (supply-chain hardening) means npm lifecycle hooks do NOT
> run — so the generator is chained INLINE in the `build`/`dev` scripts
> (`node scripts/gen-clientid.mjs && vite …`), not as a `prebuild` hook.

## Build + run

```bash
# Dev (defaults APP_ORIGIN to http://localhost:5173):
pnpm install --offline
pnpm --filter @jeswr/pod-music-web dev

# Production build for the music subdomain:
APP_ORIGIN=https://music.solid-test.jeswr.org npm run build
#   → emits a fully static dist/:
#       dist/index.html
#       dist/clientid.jsonld          (client_id = that origin)
#       dist/callback.html            (postMessage target = that origin)
#       dist/assets/*.js, *.css       (hashed; the popup element code-split into a
#                                      lazily-imported chunk)
```

Serve `dist/` with any file server (`caddy file_server`, etc.). The Vite config
aliases `@jeswr/pod-music/ui` → `../src/ui/index.ts`, so Vite bundles the
library's **TypeScript source directly** — no pre-built `dist/ui` is required.

Gates: `npm run lint` (Biome), `npm run typecheck` (tsc — the library source is
NOT re-typechecked here; `src/pod-music-ui.d.ts` declares the consumed surface),
`npm test` (Vitest — app adapter, shared-session integration and music-base tests),
`npm run build`.

## Env

| Var | Used by | Default | Notes |
|---|---|---|---|
| `APP_ORIGIN` | `gen-clientid.mjs` (build) | `http://localhost:5173` | The deployment origin. Set per-subdomain for prod. |
| `VITE_APP_ORIGIN` | UI label only | `http://localhost:5173` | Mirror of `APP_ORIGIN`; non-load-bearing (the runtime `client_id` derives from the actual window origin). |
| `VITE_HOME_IDP` | Shared sign-in card | `https://idp.solid-test.jeswr.org` | Home provider offered first. |
| `VITE_HOME_IDP_NAME` | Shared sign-in card | Provider host | Optional home-provider label. |
| `VITE_KNOWN_PROVIDERS` | Shared sign-in card | Shared directory | Comma-separated HTTPS provider URLs. |

## End-to-end sign-in

`npm run test:e2e` starts the pinned local CSS and Vite host, seeds a private
track library, signs in through the real popup, and verifies that the library
lists the tracks while ambient `fetch` still receives 401/403. It requires the
CSS package and Playwright Chromium to be available locally. The offline gate
only typechecks this harness; it does not run it.
