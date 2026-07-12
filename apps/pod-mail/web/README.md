<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# `web/` — the Pod Mail static host shell

This directory turns the framework-agnostic `@jeswr/pod-mail/ui` React component
library (`../src/ui`) into a **deployable, statically-served single-page app**
with standalone Solid login. It is the canonical "host shell" pattern, stamped
from `pod-docs/web`: the auth seam (`src/auth/`) is copied **verbatim** from that
already-hardened host (two roborev rounds) so this app inherits the same
cross-user-leak / StrictMode / per-probe-proof fixes.

The host is intentionally tiny: log in → derive the user's pod from the session →
discover the inbox mailbox document → mount `<Inbox>` → let it read the pod. All
the data logic (LDP, RDF, the mailbox model) lives in the library; the host only
wires **auth + a mailbox URL**.

## How it works

```
index.html → src/main.tsx
  └─ <SessionProvider>            (src/auth/SessionProvider.tsx — the ONE auth seam, copied verbatim)
       └─ <App>                   (src/App.tsx)
            ├─ logged out → <LoginScreen>          (WebID-first login)
            └─ logged in  → discover mailbox → <Inbox mailboxUrl />   (@jeswr/pod-mail/ui)
```

### Auth (standalone, no server)

`SessionProvider` is the only place auth is wired, and it is **copied verbatim**
from `pod-docs/web/src/auth/` (do not re-derive it). On mount it:

1. snapshots the pristine `globalThis.fetch` (for the pre-popup public profile
   read, so it can never recurse on a 401);
2. **dynamically** imports `@solid/reactive-authentication` (so the browser-only
   custom element + oauth stack never evaluate at module-eval / SSR / prerender
   time — verified by the build: `customElements.define` is `0` in the main
   bundle and lives only in the lazily-imported chunk);
3. builds a `WebIdDPoPTokenProvider` (ported from `create-solid-app`) bound to
   this origin's **static Client Identifier Document** at `${origin}/clientid.jsonld`,
   so the consent screen shows "Pod Mail" instead of a throwaway dynamic
   registration;
4. calls `manager.registerGlobally()` — **this is what patches the global
   `fetch`** (the 0.1.3 constructor does NOT). Forgetting it is the #1
   reactive-auth bug.

Once patched, every plain `fetch()` — including the ones inside `@jeswr/fetch-rdf`
and the `@jeswr/pod-mail` data layer — transparently upgrades on a 401 with a
DPoP token. So `<Inbox>` is mounted with **no `fetch` prop**: its `fetch?:` seam
falls back to the now-authenticated ambient global.

### How the mailbox document is derived from the session

`<Inbox mailboxUrl />` needs a mailbox **DOCUMENT** URL (a Pod Mail mailbox is a
document, `…/mail/folders/inbox.ttl`, not a container). `src/mailbox-discovery.ts`
derives it:

1. **pod root** = the **first `pim:storage`** on the WebID profile (else the WebID
   origin), exactly as `src/auth/session-derivation.ts` derives it.
2. **inbox document** — discovered from the user's **Type Index**: read the
   `solid:publicTypeIndex` (else `solid:privateTypeIndex`) pointer off the
   profile, fetch that index, and `locate(schema:EmailMessage)`. A registration
   points at Pod Mail's **mail root container**, so the inbox document is derived
   as `<mailContainer>folders/inbox.ttl`.
3. **fallback** — when no `schema:EmailMessage` registration is discoverable, the
   conventional `folderDocument(podRoot, "inbox")` = `<podRoot>mail/folders/inbox.ttl`.
   A **banner** tells the user the location was assumed, not discovered.

All RDF is read through `@jeswr/fetch-rdf` + the data layer's typed Type-Index
reader (`TypeIndexDataset`) — never a bespoke parser, never hand-built triples.

> Pod Mail's data layer ships no high-level "discover mailbox from profile"
> helper (no `ensureTypeRegistrations` equivalent), and its Type-Index
> registration is container-scoped, so the host derives the inbox document itself
> via the data-layer path conventions (`folderDocument` / `WellKnownFolders`).

> Tokens are in-memory only — closing the tab logs out. Durable session restore
> (DPoP refresh token in IndexedDB, proactive refresh) is the Pod-Manager
> enhancement and a documented follow-up; `scope` already requests
> `offline_access` so it is a provider-level add, not a redesign.

### The per-origin static auth artifacts

Solid-OIDC **dereferences** the `client_id` URL, so each deployment must serve
its OWN Client Identifier Document whose `client_id` / `redirect_uris` /
`client_uri` all point at its origin. `scripts/gen-clientid.mjs` generates both
files from a single `APP_ORIGIN` env, written into `public/` before every build:

- `public/clientid.jsonld` — `client_id: ${origin}/clientid.jsonld`,
  `client_name: "Pod Mail"`, `redirect_uris: [${origin}/callback.html]`,
  `client_uri: ${origin}/`, `scope: "openid webid offline_access"`,
  `grant_types: [authorization_code, refresh_token]`, `response_types: [code]`,
  `token_endpoint_auth_method: "none"`.
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

# Production build for the mail subdomain:
APP_ORIGIN=https://mail.solid-test.jeswr.org npm run build
#   → emits a fully static dist/:
#       dist/index.html
#       dist/clientid.jsonld          (client_id = https://mail.solid-test.jeswr.org/clientid.jsonld)
#       dist/callback.html            (postMessage target = that origin)
#       dist/assets/*.js, *.css       (hashed; reactive-auth code-split into a
#                                      lazily-imported chunk)
```

`npm run build` output dir: **`dist/`** — serve it with any file server
(`caddy file_server`, etc.). The Vite config aliases `@jeswr/pod-mail/ui` →
`../src/ui/index.ts`, so Vite bundles the library's **TypeScript source
directly** — no pre-built `dist/ui` is required.

Gates: `npm run lint` (Biome), `npm run typecheck` (tsc — the library source is
NOT re-typechecked here; `src/pod-mail-ui.d.ts` + `src/pod-mail.d.ts` declare the
consumed surface), `npm test` (the verbatim auth-seam unit tests), `npm run build`.

## Env

| Var | Used by | Default | Notes |
|---|---|---|---|
| `APP_ORIGIN` | `gen-clientid.mjs` (build) | `http://localhost:5173` | The deployment origin. Set per-subdomain for prod (`https://mail.solid-test.jeswr.org`). |
| `VITE_APP_ORIGIN` | UI label only | `http://localhost:5173` | Mirror of `APP_ORIGIN`; non-load-bearing (the runtime `client_id` derives from the actual window origin). |
| `VITE_HOME_IDP` | `LoginScreen` hint | `https://idp.solid-test.jeswr.org` | Display only — the auth issuer always comes from the WebID profile. |
