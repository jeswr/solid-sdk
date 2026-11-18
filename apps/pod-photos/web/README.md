<!-- AUTHORED-BY GPT-6.1 Sol -->
<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# `web/` — the Pod Photos static host shell

This directory turns the framework-agnostic `@jeswr/pod-photos/ui` React component
library (`../src/ui`) into a **deployable, statically-served single-page app**
with standalone Solid login. It is the canonical "host shell" pattern (the same
shape ships in every `pod-*` app). It uses `@jeswr/app-session`, as Pod Docs and
Pod Drive do, with a small Photos adapter and exact legacy-storage cleanup keys.

The host is intentionally tiny. The whole app is: log in → derive the user's pod
from the session → resolve the photos container → mount `<PhotoGallery>` → let it
read the pod. All the data logic (LDP, RDF, WAC-aware listing, the typed photo
model) lives in the library; the host only wires **auth + a gallery root**.

## How it works

```
index.html → src/main.tsx
  └─ <SessionProvider>            (@jeswr/app-session/react)
       └─ <App>                   (src/App.tsx)
            ├─ logged out → <LoginScreen>          (@jeswr/app-session/react)
            └─ logged in  → <PhotoGallery          (@jeswr/pod-photos/ui)
                              rootUrl fetch />
```

### Auth (standalone, no server)

Photos configures `@jeswr/app-session` in `src/auth/pod-auth.ts` and passes its name,
development flag and legacy keys to the shared React provider in `src/main.tsx`.
The package owns the page-lifetime `@jeswr/pod-auth` core and the shared
`@jeswr/suite-ui/sign-in` card, the same path as Pod Docs and Pod Drive. Recent accounts appear
first; users can also enter an address, choose the home provider or another listed
provider, or enter a custom provider address. Addresses are resolved through a
pristine public fetch. A WebID with several providers asks the user to choose a
provider explicitly.

The core restores once on mount, including React StrictMode replay, and owns all
credentials, persistence and logout. `auth.fetch` is passed explicitly to
`PhotoGallery` and Type Index discovery; global fetch stays public. The default automatic credential
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
sessionStorage keys `pod-photos:pss.autologin.flow` and `pod-photos:autologin-attempted`,
the localStorage key `pod-photos:remembered-account`, and the dedicated
`pod-photos:sessions` IndexedDB database left by builds before pod-auth. The shared
package's `clearLegacyCredentials` removes these entries independently when storage is unavailable.
Other applications' storage and the theme preference are preserved.

A `#autologin/<encoded-webid>` deep link adds a one-click account row and is
removed from the address bar. It never opens a popup or redirects without a click.
Only `callback.html` is registered as an OAuth redirect URI.

### How the gallery root is derived from the session

`<PhotoGallery rootUrl />` needs the **photos container** URL. The host derives it
in two steps:

1. **pod root** (`@jeswr/app-session`'s `deriveSession`) = the first
   `pim:storage` on the WebID profile, else the WebID origin (`scheme://host/`).
   A banner tells the user when the origin fallback is used.
2. **photos container** under that pod root (`src/photos-root.ts`) = Type-Index
   discovery of the `schema:Photograph` `solid:instanceContainer` (the library's
   read-only `typeIndexLinks` + `TypeIndexDataset.locate` primitives — NOT the
   write/bootstrap `ensureTypeRegistrations` path), falling back to the
   conventional `${podRoot}photos/` (`PHOTOS_SLUG`). A banner notes the fallback.

### The per-origin static auth artifacts

Solid-OIDC **dereferences** the `client_id` URL, so each deployment must serve its
OWN Client Identifier Document whose `client_id` / `redirect_uris` / `client_uri`
all point at its origin. `scripts/gen-clientid.mjs` generates both files from a
single `APP_ORIGIN` env, written into `public/` before every build:

- `public/clientid.jsonld` — `client_id: ${origin}/clientid.jsonld`,
  `redirect_uris: [${origin}/callback.html]`, `client_uri: ${origin}/`,
  `client_name: "Pod Photos"`, `scope: "openid webid offline_access"`,
  `grant_types: [authorization_code, refresh_token]`,
  `response_types: [code]`, `token_endpoint_auth_method: "none"`.
- `public/callback.html` — the OAuth popup → opener post-back. It targets the
  message at **our origin only** (`postMessage(href, "${origin}")`), never `"*"`,
  because the URL carries the authorization code.

Both have committed localhost defaults, are regenerated for each deployment, and
are copied by Vite into `dist/`. Set `CLIENT_BASE_PATH=/solid-sdk/pod-photos/`
for the GitHub Pages deployment and use the same Vite base.

> `ignore-scripts=true` (supply-chain hardening) means **npm lifecycle hooks do
> NOT run** — so the generator is chained INLINE in the `build`/`dev` scripts
> (`node scripts/gen-clientid.mjs && vite …`), not as a `prebuild` hook.

## Build + run

```bash
# Dev (defaults APP_ORIGIN to http://localhost:5173):
# Install workspace dependencies from the repository root:
pnpm install --offline
npm run dev

# Production build for this app's subdomain:
APP_ORIGIN=https://photos.solid-test.jeswr.org npm run build
#   → emits a fully static dist/:
#       dist/index.html
#       dist/clientid.jsonld          (client_id = that origin)
#       dist/callback.html            (postMessage target = that origin)
#       dist/assets/*.js, *.css       (hashed; the popup element code-split into a
#                                      lazily-imported chunk)
```

`npm run build` output dir: **`dist/`** — serve it with any file server
(`caddy file_server`, etc.). The Vite config aliases `@jeswr/pod-photos/ui` →
`../src/ui/index.ts`, so Vite bundles the library's **TypeScript source directly**
— no pre-built `dist/ui` is required.

Gates: `npm run lint` (Biome), `npm run typecheck` (tsc — the library source is
NOT re-typechecked here; `src/pod-photos-ui.d.ts` declares the consumed surface),
`npm test` (Photos integration, discovery and client-ID tests), `npm run build`.
Shared auth behavior is tested in `@jeswr/app-session`; this app uses its `/testing`
fakes for adoption tests. The Playwright sign-in spec requires a local CSS and is
separate from the offline unit gate.

## Env

| Var | Used by | Default | Notes |
|---|---|---|---|
| `APP_ORIGIN` | `gen-clientid.mjs` (build) | `http://localhost:5173` | The deployment origin. Set per-subdomain for prod. |
| `VITE_APP_ORIGIN` | UI label only | `http://localhost:5173` | Mirror of `APP_ORIGIN`; non-load-bearing (the runtime `client_id` derives from the actual window origin). |
| `VITE_HOME_IDP` | `SignInCard` | `https://idp.solid-test.jeswr.org` | Home provider offered first. |
| `VITE_HOME_IDP_NAME` | `SignInCard` | Provider host | Optional home-provider label. |
| `VITE_KNOWN_PROVIDERS` | `SignInCard` | Shared directory | Comma-separated HTTPS providers. |
| `CLIENT_BASE_PATH` | `gen-clientid.mjs` | `/` | App path ending in `/`; align with Vite's base. |
