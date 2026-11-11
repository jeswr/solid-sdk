<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# `web/` — the Pod Mail static host shell

This directory turns the framework-agnostic `@jeswr/pod-mail/ui` React component
library (`../src/ui`) into a **deployable, statically-served single-page app**
with standalone Solid login. Its shared auth adapter follows the finished
Pod Docs and Pod Drive hosts, with Mail's own storage keys and mailbox discovery.

The host is intentionally tiny: log in → derive the user's pod from the session →
discover the inbox mailbox document → mount `<Inbox>` → let it read the pod. All
the data logic (LDP, RDF, the mailbox model) lives in the library; the host only
wires **auth + a mailbox URL**.

## How it works

```
index.html → src/main.tsx
  └─ <SessionProvider>            (@jeswr/app-session/react)
       └─ <App>                   (src/App.tsx)
            ├─ logged out → <LoginScreen>          (@jeswr/app-session/react)
            └─ logged in  → discover mailbox → <Inbox mailboxUrl fetch />   (@jeswr/pod-mail/ui)
```

### Auth (standalone, no server)

Mail configures `@jeswr/app-session` in `src/auth/pod-auth.ts` and passes its name and
exact legacy credential keys to the shared `SessionProvider` in `src/main.tsx`. The package
owns the page-lifetime `@jeswr/pod-auth` core and `@jeswr/suite-ui/sign-in` card,
as in Pod Docs and Pod Drive. Recent accounts appear
first; users can also enter an address, choose the home provider or another listed
provider, or enter a custom provider address. Addresses are resolved through a
pristine public fetch. A WebID with several providers asks the user to choose a
provider explicitly.

The core restores once on mount, including React StrictMode replay, and owns all
credentials, persistence and logout. `auth.fetch` is passed explicitly to
the profile/Type Index discovery and `Inbox`; global fetch stays public. The default automatic credential
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
obsolete credentials through the package's `clearLegacyCredentials` helper:
IndexedDB database `pod-mail:sessions` (refresh tokens and DPoP keys), localStorage
key `pod-mail.remembered-account` (public remembered-account pointer), and sessionStorage
keys `pod-mail:pss.autologin.flow` and `pod-mail:autologin-attempted` (redirect state
and loop guard). Other applications' storage and Mail's theme preference are preserved.

A `#autologin/<encoded-webid>` deep link adds a one-click account row and is
removed from the address bar. It never opens a popup or redirects without a click.
Only `callback.html` is registered as an OAuth redirect URI.

### How the mailbox document is derived from the session

`<Inbox mailboxUrl fetch />` needs a mailbox **DOCUMENT** URL (a Pod Mail mailbox is a
document, `…/mail/folders/inbox.ttl`, not a container). `src/mailbox-discovery.ts`
derives it:

1. **pod root** = the **first `pim:storage`** on the WebID profile (else the WebID
   origin), exactly as the shared `@jeswr/app-session` `deriveSession` helper derives it.
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

Both are committed with the development origin and regenerated for each build;
the script and `APP_ORIGIN` are the source of truth. Set `CLIENT_BASE_PATH`
for Pages deployments (Mail uses `/solid-sdk/pod-mail/`). Vite copies them into `dist/`.

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
consumed surface), `npm test` (the shared-auth and mailbox tests), `npm run build`.

## Env

| Var | Used by | Default | Notes |
|---|---|---|---|
| `APP_ORIGIN` | `gen-clientid.mjs` (build) | `http://localhost:5173` | The deployment origin. Set per-subdomain for prod (`https://mail.solid-test.jeswr.org`). |
| `VITE_APP_ORIGIN` | UI label only | `http://localhost:5173` | Mirror of `APP_ORIGIN`; non-load-bearing (the runtime `client_id` derives from the actual window origin). |
| `VITE_HOME_IDP` | `LoginScreen` | `https://idp.solid-test.jeswr.org` | Home provider shown first; explicit WebID hints are checked by pod-auth. |

`VITE_HOME_IDP_NAME` labels the home provider. `VITE_KNOWN_PROVIDERS` accepts
comma-separated HTTPS provider URLs; otherwise the shared directory is used.

`pnpm run test:e2e` drives real popup sign-in against local CSS, lists the seeded
private messages, and checks anonymous and ambient browser fetches receive 401/403.
