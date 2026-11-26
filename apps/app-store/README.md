# Solid App Store

<!-- AUTHORED-BY Codex GPT-6 -->

Hosted at https://jeswr.github.io/solid-sdk/app-store/ by the
[workspace Pages workflow](../../.github/workflows/pages.yml); Vercel git deployments
are disabled. See [workspace deployment setup](../../docs/deployment.md).
The hosting recipes below describe optional standalone deployments.

> A discover-and-launch hub for the whole Solid app suite. Browse every app as a card
> grouped by category, search/filter, and **Launch** any live app with your account ready
> to choose. **Only your public WebID ever travels in a link, never a token.** Each app
> handles its own sign-in. The store is itself a Solid app, and its
> catalog is published as Linked Data (DCAT + `schema:SoftwareApplication`, content-
> negotiable Turtle / JSON-LD, plus a human HTML view).

Part of the [`@jeswr` Solid app suite](https://github.com/jeswr). Built as a Vite + React +
TypeScript static SPA under [`web/`](./web), deployable as the 10th pod-app subdomain.

## What it is

The suite ships many apps (data-layer pod-apps, Pod Manager, Solid Issues, finance
products, demos) but had no single place to **find and open** them. The App Store is that
place: a public directory you can browse logged-out, and — once you sign in — a launcher
that passes your public WebID to each app's sign-in screen.

- **Catalog grid** grouped by category (Documents, Media, Comms, Health, Productivity,
  Finance, Demo) with a search box and a "Live only" filter.
- **Launch** on every live app; "Coming soon" cards (with a repo link) for the apps that
  are not yet deployed.
- **The suite chrome** via [`@jeswr/app-shell`](https://github.com/jeswr/app-shell): a
  light/dark theme toggle, an account menu, and a feedback button that files issues here.
- **Silent session restore** on load (the cross-app UX invariant): reopen the tab and your
  session is rebuilt from a persisted DPoP-bound refresh token — no redirect, no popup.

## The Linked Data catalog

The store is dereferenceable Linked Data. One stable catalog IRI
(`${origin}/catalog#it`) is a `dcat:Catalog` of `dcat:CatalogRecord`s, each a curation
envelope (`dct:issued`/`dct:modified`, lifecycle status, `foaf:maker`) pointing at a
`schema:SoftwareApplication` (name, applicationCategory, description, url, a free offer,
and `schema:identifier` → the app's own `clientid.jsonld`). This **reuses** DCAT + Dublin
Core + schema.org rather than minting a bespoke shape — the same discipline as
[`@jeswr/federation-registry`](https://github.com/jeswr/federation-registry).

A store **listing** is a *curation* claim; it deliberately stays distinct from a
federation **membership** (a *signed* claim). The catalog therefore *links to* (never
duplicates) the future `fedreg:Membership` / `fedapp:App` layer via each app's `client_id`
IRI.

Three representations of the one catalog IRI:

| Accept | Served |
|---|---|
| `text/turtle` (and bare `*/*`) | `catalog.ttl` |
| `application/ld+json` | `catalog.jsonld` |
| `text/html` (explicitly outranking RDF) | the SPA, deep-linking to the `#/catalog` HTML view |

Both RDF files are generated at build time from the committed
[`web/data/apps.json`](./web/data/apps.json) by
[`web/scripts/gen-catalog.mjs`](./web/scripts/gen-catalog.mjs) — serialised through
`n3.Writer` (Turtle) and the `jsonld` library (JSON-LD) from **one** in-memory quad array,
so the two representations cannot drift (a test asserts they parse to an isomorphic
dataset). RDF is never hand-concatenated.

## The launch model — and why no token is ever in a URL

A **Launch** button carries **only the user's public WebID**. Apps using the shared
session package treat it as an account suggestion requiring a click; the destination
owns its sign-in and restore. Credentials never travel in the link.

Two mechanisms, selected per app by the manifest's `launch` field
([`web/src/lib/launch.ts`](./web/src/lib/launch.ts)):

1. **`autologin`** (the 8 vite pod-apps + Solid Issues) →
   `https://<app>/#autologin/<encodeURIComponent(webid)>`. The WebID rides in the URL
   **fragment**, which (RFC 3986 §3.5) is client-side and never sent on the wire. The target
   app consumes it as a suggested account. Shared-session apps never start login from
   the fragment alone. The fragment is built with the exact
   `autologinFragment` shape from
   [`create-solid-app`](https://github.com/jeswr/create-solid-app) so producer and parser
   agree.
2. **`prefill`** (Pod Manager) → `https://app/?webid=<encodeURIComponent(webid)>`. PM
   prefills the WebID and surfaces a one-click sign-in (its popup model needs a user
   gesture).

When you are **logged out**, Launch falls back to a plain link to the app — which shows its
own login. `launchUrl` is a pure, exhaustively-tested function: its test suite asserts that
**no** `access_token` / `refresh_token` / `id_token` / authorization code / DPoP proof /
Bearer / `eyJ…` JWT ever appears in any produced URL, across every mechanism and session
state.

## Auth

[`web/src/auth/pod-auth.ts`](./web/src/auth/pod-auth.ts) is the app's adapter to
`@jeswr/app-session`: it configures the client identity, callback, development flag, app
name and obsolete credential keys. The shared React `SessionProvider` owns restore and
logout, and `LoginScreen` renders the shared SignInCard inside the store's native dialog.
Provider addresses and the home provider can be configured with `VITE_KNOWN_PROVIDERS`,
`VITE_HOME_IDP` and `VITE_HOME_IDP_NAME`.

The catalog, search, filters and Linked Data downloads remain public while signed out,
restoring or experiencing a sign-in error. The store reads no private pod data, so it has
no pod component requiring authenticated fetch. Global fetch stays public and is never
patched; public profile display reads use the package's pristine credential-free fetch.
Pod-auth owns credential persistence and grants credentials only to verified storage roots.

`web/public/clientid.jsonld` and `callback.html` are generated (not committed) by every
`dev` and `build` run for `APP_ORIGIN` and `CLIENT_BASE_PATH`.
Only `callback.html` is registered as a redirect URI. Production uses the current
deployment's HTTPS `clientid.jsonld`; dynamic registration and insecure HTTP are enabled
only in a development build served on loopback. On first mount the shared cleanup removes
the old `solid-app-store:sessions` IndexedDB database, localStorage
`solid-app-store:remembered-account`, and sessionStorage `app-store:pss.autologin.flow`
and `app-store:autologin-attempted`. Theme settings and other apps' records are preserved.

## Develop

```bash
pnpm install --offline # from the workspace root, using the installed cache
cd apps/app-store/web
pnpm run dev           # gen-clientid + gen-catalog, then Vite on :5173
pnpm run lint          # Biome + the lockfile-transport guard
pnpm run typecheck     # tsc --noEmit
pnpm test              # Vitest (shared session integration + launch links + DCAT isomorphism)
pnpm run build         # gen-clientid + gen-catalog + vite build → web/dist
```

The build runs `gen-clientid.mjs` (the per-origin Solid-OIDC Client Identifier Document) and
`gen-catalog.mjs` (the DCAT catalog) inline — **not** as npm lifecycle hooks, because
`ignore-scripts=true` (supply-chain hardening) would skip those. The deploy origin is set at
build time via `APP_ORIGIN`; `CLIENT_BASE_PATH` supplies the app's path when it is
served below a domain root.

## Deploy

The workspace Pages workflow publishes the store at
https://jeswr.github.io/solid-sdk/app-store/. To reproduce its build from the
monorepo root (Node 24):

```sh
APP_ORIGIN=https://jeswr.github.io node scripts/build-pages.mjs app-store
```

The generated client identity, redirect URIs, catalog IRIs and links include the
app's base path. Vercel git deployments are disabled. The older standalone Caddy
recipe remains in [`docs/DEPLOY.md`](./docs/DEPLOY.md).

## License

[MIT](./LICENSE) © Jesse Wright.

---

🤖 Built by the PSS agent (@jeswr's agent for `prod-solid-server` / the Solid app + Pod-Manager
suite). Authored by Claude Opus 4.8.
