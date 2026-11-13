<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# `web/` — the Pod Chat static host shell

This directory turns the framework-agnostic `@jeswr/pod-chat/ui` React component
library (`../src/ui`) into a **deployable, statically-served single-page app**
with shared Solid login through `@jeswr/app-session`, as in Pod Docs and Pod Drive.
The app owns its client identity adapter, legacy key list, chrome and chat view.

The host is intentionally tiny. The whole app is: log in → derive the user's pod
from the session → mount the library component → let it read/write the pod. All
the data logic (LDP, RDF, optimistic create/save, Type-Index discovery) lives in
the library; the host only wires **auth + a pod root**.

## How it works

```
index.html → src/main.tsx
  └─ <SessionProvider>            (@jeswr/app-session/react)
       └─ <App>                   (src/App.tsx)
            ├─ logged out → <LoginScreen>          (shared SignInCard)
            └─ logged in  → <ChatRooms             (@jeswr/pod-chat/ui)
                              podRoot webId fetch={auth.fetch} />
```

### Auth (standalone, no server)

Chat imports `SessionProvider`, `useSession` and `LoginScreen` from
`@jeswr/app-session/react`. The package owns one page-lifetime `@jeswr/pod-auth`
core and the shared `@jeswr/suite-ui/sign-in` card. The only local auth module,
`src/auth/pod-auth.ts`, configures the client ID, callback, development flag and
Chat's exact legacy keys. Recent accounts appear
first; users can also enter an address, choose the home provider or another listed
provider, or enter a custom provider address. Addresses are resolved through a
pristine public fetch. A WebID with several providers asks the user to choose a
provider explicitly.

The core restores once on mount, including React StrictMode replay, and owns all
credentials, persistence and logout. `auth.fetch` is passed explicitly to
`ChatRooms`; global fetch stays public. The default automatic credential
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
old `pod-chat:sessions` IndexedDB database, the `pod-chat:remembered-account`
localStorage pointer, and the `pod-chat:autologin-attempted` and
`pod-chat:pss.autologin.flow` sessionStorage records. Theme preferences and other
applications' data are retained.

A `#autologin/<encoded-webid>` deep link adds a one-click account row and is
removed from the address bar. It never opens a popup or redirects without a click.
Only `callback.html` is registered as an OAuth redirect URI.

### How the chat containers are derived from the session

`<ChatRooms podRoot webId fetch={auth.fetch} />` needs only a **pod root** + the **WebID**. The host
receives them from `@jeswr/app-session`'s shared session derivation:

- **pod root** = the **first `pim:storage`** advertised on the WebID profile (the
  canonical Solid "where my storage lives" signal). Fallback when a profile omits
  `pim:storage`: the **WebID origin** (`scheme://host/`). A banner tells the user
  when the fallback is used; pod-auth grants no credentials there, so only public
  rooms can be shown.
- The **chat containers themselves are NOT derived here.** `@jeswr/pod-chat`'s
  `ChatStore` owns that: it derives `pod-chat/rooms/` + `pod-chat/messages/` from
  the pod root and registers them in the user's **Type Index**
  (`ensureTypeRegistrations`) for cross-app discovery. So the host's only job is a
  correct pod root; container derivation is the data layer's concern.

### The per-origin static auth artifacts

Solid-OIDC **dereferences** the `client_id` URL, so each deployment must serve
its OWN Client Identifier Document whose `client_id` / `redirect_uris` /
`client_uri` all point at its origin. `scripts/gen-clientid.mjs` generates both
files from a single `APP_ORIGIN` env, written into `public/` before every build:

- `public/clientid.jsonld` — `client_id: ${origin}/clientid.jsonld`,
  `redirect_uris: [${origin}/callback.html]`, `client_uri: ${origin}/`,
  `client_name: "Pod Chat"`, `scope: "openid webid offline_access"`,
  `grant_types: [authorization_code, refresh_token]`,
  `response_types: [code]`, `token_endpoint_auth_method: "none"`.
- `public/callback.html` — the OAuth popup → opener post-back. It targets the
  message at **our origin only** (`postMessage(href, "${origin}")`), never `"*"`.

Both are committed with local-development defaults and regenerated before dev
and build; the script + `APP_ORIGIN` are the source of truth. Vite copies them
into `dist/`. Set `CLIENT_BASE_PATH=/solid-sdk/pod-chat/` for GitHub Pages and
use the same base when building Vite.

> `ignore-scripts=true` (supply-chain hardening) means **npm lifecycle hooks do
> NOT run** — so the generator is chained INLINE in the `build`/`dev` scripts
> (`node scripts/gen-clientid.mjs && vite …`), not as a `prebuild` hook.

## Build + run

```bash
# Dev (defaults APP_ORIGIN to http://localhost:5173):
npm install
npm run dev

# Production build for the chat subdomain:
APP_ORIGIN=https://chat.solid-test.jeswr.org npm run build
#   → emits a fully static dist/:
#       dist/index.html
#       dist/clientid.jsonld          (client_id = that origin)
#       dist/callback.html            (postMessage target = that origin)
#       dist/assets/*.js, *.css       (hashed; reactive-auth code-split into a
#                                      lazily-imported chunk)
```

`npm run build` output dir: **`dist/`** — serve it with any file server
(`caddy file_server`, etc.). The Vite config aliases `@jeswr/pod-chat/ui` →
`../src/ui/index.ts`, so Vite bundles the library's **TypeScript source
directly** — no pre-built `dist/ui` is required.

Gates: `npm run lint` (Biome), `npm run typecheck` (tsc — the library source is
NOT re-typechecked here; `src/pod-chat-ui.d.ts` declares the consumed surface),
`npm test` (shared-auth integration and UI tests), `npm run build`.

## Env

| Var | Used by | Default | Notes |
|---|---|---|---|
| `APP_ORIGIN` | `gen-clientid.mjs` (build) | `http://localhost:5173` | The deployment origin. Set per-subdomain for prod. |
| `VITE_APP_ORIGIN` | UI label only | `http://localhost:5173` | Mirror of `APP_ORIGIN`; non-load-bearing (the runtime `client_id` derives from the actual window origin). |
| `VITE_HOME_IDP` | `LoginScreen` | `https://idp.solid-test.jeswr.org` | Home provider shown first in the sign-in card. |
| `VITE_HOME_IDP_NAME` | `LoginScreen` | Provider host | Optional home provider label. |
| `VITE_KNOWN_PROVIDERS` | `LoginScreen` | Shared directory | Comma-separated HTTPS provider URLs. |
| `CLIENT_BASE_PATH` | `gen-clientid.mjs` | `/` | App base path, including a trailing slash. |

The Playwright smoke test drives a real popup sign-in against local CSS, lists
private seeded rooms, and checks ambient fetch still gets 401/403. Run
`pnpm --filter @jeswr/pod-chat-web test:e2e` where CSS and Chromium are available.
