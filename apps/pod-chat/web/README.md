<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# `web/` — the Pod Chat static host shell

This directory turns the framework-agnostic `@jeswr/pod-chat/ui` React component
library (`../src/ui`) into a **deployable, statically-served single-page app**
with standalone Solid login. It is the canonical "host shell" pattern shared
across the `pod-*` apps — stamped from `pod-docs/web` with only the four
per-app changes (component + prop, Vite alias + ambient `.d.ts`, the
session-derivation note, and the per-subdomain `APP_ORIGIN` / `client_name`).

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
            └─ logged in  → <ChatRooms             (@jeswr/pod-chat/ui)
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
   `${origin}/clientid.jsonld`, so the consent screen shows "Pod Chat" instead
   of a throwaway dynamic registration;
4. calls `manager.registerGlobally()` — **this is what patches the global
   `fetch`** (the 0.1.3 constructor does NOT). Forgetting it is the #1
   reactive-auth bug.

Once patched, every plain `fetch()` — including the ones inside `@jeswr/fetch-rdf`
and the `@jeswr/pod-chat` data layer — transparently upgrades on a 401 with a
DPoP token. So `<ChatRooms>` is mounted with **no `fetch` prop**: its `fetch?:`
seam falls back to the now-authenticated ambient global.

The `src/auth/` seam is **copied verbatim** from `pod-docs/web` — it carries the
cross-user-leak fix, the StrictMode auth-flow-holder, the generation-fenced
`reset()` and the per-probe login proof, all hardened across two roborev rounds.
Only the app-name strings in its doc comments differ.

### How the chat containers are derived from the session

`<ChatRooms podRoot webId />` needs only a **pod root** + the **WebID**. The host
derives them in `src/auth/session-derivation.ts`:

- **pod root** = the **first `pim:storage`** advertised on the WebID profile (the
  canonical Solid "where my storage lives" signal). Fallback when a profile omits
  `pim:storage`: the **WebID origin** (`scheme://host/`). A banner tells the user
  when the fallback is used.
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

Both are git-ignored (a per-origin artifact; the script + `APP_ORIGIN` are the
source of truth) and copied by Vite into `dist/` at the root.

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
`npm test` (the copied auth-seam unit tests), `npm run build`.

## Env

| Var | Used by | Default | Notes |
|---|---|---|---|
| `APP_ORIGIN` | `gen-clientid.mjs` (build) | `http://localhost:5173` | The deployment origin. Set per-subdomain for prod. |
| `VITE_APP_ORIGIN` | UI label only | `http://localhost:5173` | Mirror of `APP_ORIGIN`; non-load-bearing (the runtime `client_id` derives from the actual window origin). |
| `VITE_HOME_IDP` | `LoginScreen` hint | `https://idp.solid-test.jeswr.org` | Display only — the auth issuer always comes from the WebID profile. |
