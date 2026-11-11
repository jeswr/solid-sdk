<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# `web/` — the Pod Drive static host shell

This directory turns the framework-agnostic `@jeswr/pod-drive/ui` React component
library (`../src/ui`) into a **deployable, statically-served single-page app**
with standalone Solid login. It is the canonical "host shell" pattern, stamped
from the hardened `pod-docs/web` reference: the same shape replicates across
every `pod-*` app.

The host is intentionally tiny. The whole app is: log in → derive the user's pod
root from the session → mount the `FileBrowser` → let it read the pod. All the
data logic (LDP container reads, RDF, WAC handling) lives in the library; the
host only wires **auth + a pod root**.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## How it works

```
index.html → src/main.tsx
  └─ <SessionProvider>            (@jeswr/app-session/react)
       └─ <App>                   (src/App.tsx)
            ├─ logged out → <LoginScreen>          (shared account and provider card)
            └─ logged in  → <FileBrowser           (@jeswr/pod-drive/ui)
                              rootUrl={podRoot} fetch={auth.fetch} />
```

### Auth (standalone, no server)

Drive configures `@jeswr/app-session` in `src/auth/pod-auth.ts`, with its app name and
obsolete credential keys passed to the shared provider in `src/main.tsx`. The package
owns one page-lifetime `@jeswr/pod-auth` core and the shared
`@jeswr/suite-ui/sign-in` card. Recent accounts appear first; users can also enter
an address, choose the home provider or another listed provider, or enter a custom
provider address. Addresses are resolved through a pristine public fetch. A WebID
with several providers asks the user to choose a provider explicitly.

The core restores once on mount, including React StrictMode replay, and owns all
credentials, persistence and logout. `auth.fetch` is passed explicitly to
`FileBrowser`; global fetch stays public. The default automatic credential boundary
uses only the authenticated WebID's advertised storage roots. Public profile reads
for the display name, avatar and drive root use the pristine public transport.

The popup element is lazily registered from `@jeswr/reactive-authentication/registerElements`.
A StrictMode-safe holder adapts its disposable result to the full callback URL.
`allowInsecureLoopback` and pod-auth's dynamic client registration are enabled only
in a development build (`npm run dev`) whose hostname is localhost, 127.0.0.0/8 or
::1; every other build uses the HTTPS `clientid.jsonld`, so `vite preview` over HTTP
cannot sign in. Silent `prompt=none` re-authentication during restore is declined
(no popup without a click). The popup supports cancellation; errors use plain
messages without raw protocol details. On first load the app deletes the refresh
tokens and keys stored by builds before pod-auth.

A `#autologin/<encoded-webid>` deep link adds a one-click account row and is
removed from the address bar. It never opens a popup or redirects without a click.
Only `callback.html` is registered as an OAuth redirect URI.

### How the drive root is derived from the session

`<FileBrowser rootUrl />` needs only a **pod root**. The shared `@jeswr/app-session`
`deriveSession` helper derives it:

- **pod root** = the **first `pim:storage`** advertised on the WebID profile (the
  canonical Solid "where my storage lives" signal). Fallback when a profile omits
  `pim:storage`: the **WebID origin** (`scheme://host/`). A banner tells the user
  when the fallback is used.
- Pod Drive's data layer (`listContainer`) **GETs that container directly** and
  lets the user descend the LDP container tree via the breadcrumb — it has **no
  Type-Index discovery** step (unlike pod-docs's `DocsStore`, which resolves its
  `pod-docs/` container via the Type Index). So the host hands `FileBrowser` the
  pod root and the file tree starts there.

### The per-origin static auth artifacts

Solid-OIDC **dereferences** the `client_id` URL, so each deployment must serve
its OWN Client Identifier Document whose `client_id` / `redirect_uris` /
`client_uri` all point at its origin. `scripts/gen-clientid.mjs` generates both
files from a single `APP_ORIGIN` env, written into `public/` before every build:

- `public/clientid.jsonld` — `client_id: ${origin}/clientid.jsonld`,
  `client_name: "Pod Drive"`, `redirect_uris: [${origin}/callback.html]`,
  `client_uri: ${origin}/`, `scope: "openid webid offline_access"`,
  `grant_types: [authorization_code, refresh_token]`,
  `response_types: [code]`, `token_endpoint_auth_method: "none"`.
- `public/callback.html` — the OAuth popup → opener post-back. It targets the
  message at **our origin only** (`postMessage(href, "${origin}")`), never `"*"`,
  because the URL carries the authorization code.

Both are generated per-origin artifacts; the script and `APP_ORIGIN` are the source of truth,
and the checked-in files provide the local development defaults. They are copied by Vite into `dist/` at the root.

> `ignore-scripts=true` (supply-chain hardening) means **npm lifecycle hooks do
> NOT run** — so the generator is chained INLINE in the `build`/`dev` scripts
> (`node scripts/gen-clientid.mjs && vite …`), not as a `prebuild` hook (a `pre*`
> hook would be silently skipped).

## Build + run

```bash
# Dev (defaults APP_ORIGIN to http://localhost:5173):
npm install
npm run dev

# Production build for the deploy origin:
APP_ORIGIN=https://drive.solid-test.jeswr.org npm run build
#   → emits a fully static dist/:
#       dist/index.html
#       dist/clientid.jsonld          (client_id = that origin)
#       dist/callback.html            (postMessage target = that origin)
#       dist/assets/*.js, *.css       (hashed; reactive-auth code-split into a
#                                      lazily-imported chunk)
```

`npm run build` output dir: **`dist/`** — serve it with any file server
(`caddy file_server`, etc.). The Vite config aliases `@jeswr/pod-drive/ui` →
`../src/ui/index.ts`, so Vite bundles the library's **TypeScript source
directly** — no pre-built `dist/ui` is required.

Gates: `npm run lint` (Biome), `npm run typecheck` (tsc — the library source is
NOT re-typechecked here; `src/pod-drive-ui.d.ts` declares the consumed surface),
`npm test` (shared auth and UI integration tests), `npm run build`.

## Env

| Var | Used by | Default | Notes |
|---|---|---|---|
| `APP_ORIGIN` | `gen-clientid.mjs` (build) | `http://localhost:5173` | The deployment origin. Set per-subdomain for prod. |
| `VITE_APP_ORIGIN` | UI label only | `http://localhost:5173` | Mirror of `APP_ORIGIN`; non-load-bearing (the runtime `client_id` derives from the actual window origin). |
| `VITE_HOME_IDP` | Sign-in card | `https://idp.solid-test.jeswr.org` | Home provider, shown first. |
| `VITE_HOME_IDP_NAME` | Sign-in card | Provider host | Home provider display name. |
| `VITE_KNOWN_PROVIDERS` | Sign-in card | Shared provider directory | Comma-separated HTTPS provider URLs. |
