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

## How it works

```
index.html → src/main.tsx
  └─ <SessionProvider>            (src/auth/SessionProvider.tsx — the ONE auth seam)
       └─ <App>                   (src/App.tsx)
            ├─ logged out → <LoginScreen>          (WebID-first login)
            └─ logged in  → <FileBrowser           (@jeswr/pod-drive/ui)
                              rootUrl={podRoot} />
```

### Auth (standalone, no server)

`SessionProvider` is the only place auth is wired, and it is **copied verbatim**
from `pod-docs/web/src/auth/` — the security-hardened seam that went through two
roborev rounds (cross-user-leak fix, StrictMode auth-flow holder,
generation-fenced `reset()`, per-probe login proof). On mount it:

1. snapshots the pristine `globalThis.fetch` (for the pre-popup public profile
   read, so it can never recurse on a 401);
2. **dynamically** imports `@solid/reactive-authentication` (so the browser-only
   custom element + oauth stack never evaluate at module-eval / SSR / prerender
   time — verified by the build: `customElements.define` is `0` in the main
   bundle and lives only in the lazily-imported chunk);
3. builds a `WebIdDPoPTokenProvider` (ported from `create-solid-app`) bound to
   this origin's **static Client Identifier Document** at
   `${origin}/clientid.jsonld`, so the consent screen shows "Pod Drive" instead
   of a throwaway dynamic registration;
4. calls `manager.registerGlobally()` — **this is what patches the global
   `fetch`** (the 0.1.3 constructor does NOT). Forgetting it is the #1
   reactive-auth bug.

Once patched, every plain `fetch()` — including the ones inside `@jeswr/fetch-rdf`
and the `@jeswr/pod-drive` data layer — transparently upgrades on a 401 with a
DPoP token. So `<FileBrowser>` is mounted with **no `fetch` prop**: its `fetch?:`
seam falls back to the now-authenticated ambient global.

Login is WebID-first: the user enters their WebID, the issuer is resolved from
the WebID profile (never a hard-coded IdP), the popup mints a DPoP token, and a
probe of the (private) storage root proves the session
(`assessLoginProbe` — per-attempt token-attach delta, not a sticky flag).
`allowInsecureLoopback` is enabled **only** for a `localhost` origin (dev against
a local CSS over HTTP); a deployed HTTPS origin stays strict.

> Tokens are in-memory only — closing the tab logs out. Durable session restore
> (DPoP refresh token in IndexedDB, proactive refresh) is the Pod-Manager
> enhancement and a documented follow-up for this shell; `scope` already requests
> `offline_access` so it's a provider-level add, not a redesign.

### How the drive root is derived from the session

`<FileBrowser rootUrl />` needs only a **pod root**. The host derives it in
`src/auth/session-derivation.ts`:

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
`npm test` (the verbatim auth-seam unit tests), `npm run build`.

## Env

| Var | Used by | Default | Notes |
|---|---|---|---|
| `APP_ORIGIN` | `gen-clientid.mjs` (build) | `http://localhost:5173` | The deployment origin. Set per-subdomain for prod. |
| `VITE_APP_ORIGIN` | UI label only | `http://localhost:5173` | Mirror of `APP_ORIGIN`; non-load-bearing (the runtime `client_id` derives from the actual window origin). |
| `VITE_HOME_IDP` | `LoginScreen` hint | `https://idp.solid-test.jeswr.org` | Display only — the auth issuer always comes from the WebID profile. |
