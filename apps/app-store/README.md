# Solid App Store

> A discover-and-launch hub for the whole Solid app suite. Browse every app as a card
> grouped by category, search/filter, and **Launch** any live app already logged in —
> the session is re-established securely at your identity provider and **only your public
> WebID ever travels in a link, never a token.** The store is itself a Solid app, and its
> catalog is published as Linked Data (DCAT + `schema:SoftwareApplication`, content-
> negotiable Turtle / JSON-LD, plus a human HTML view).

Part of the [`@jeswr` Solid app suite](https://github.com/jeswr). Built as a Vite + React +
TypeScript static SPA under [`web/`](./web), deployable as the 10th pod-app subdomain.

## What it is

The suite ships many apps (data-layer pod-apps, Pod Manager, Solid Issues, finance
products, demos) but had no single place to **find and open** them. The App Store is that
place: a public directory you can browse logged-out, and — once you sign in with your WebID
— a launcher that opens each app *already authenticated*.

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

A **Launch** button carries **only the user's public WebID** (a WebID is public by
definition). The actual session is re-established at the shared identity-provider broker via
OIDC `prompt=none` silent SSO ([media-kraken#54](https://github.com/NoelDeMartin/media-kraken/issues/54)),
so nothing secret needs to — or does — travel in the URL.

Two mechanisms, selected per app by the manifest's `launch` field
([`web/src/lib/launch.ts`](./web/src/lib/launch.ts)):

1. **`autologin`** (the 8 vite pod-apps + Solid Issues) →
   `https://<app>/#autologin/<encodeURIComponent(webid)>`. The WebID rides in the URL
   **fragment**, which (RFC 3986 §3.5) is client-side and never sent on the wire. The target
   app detects it, runs a full-page `prompt=none` redirect, and — given a live broker session
   + prior authorization — lands already authenticated. The fragment is built with the exact
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

## Develop

```bash
cd web
npm ci                 # keyless: git deps are pinned over git+https (the #78 rule)
npm run dev            # gen-clientid + gen-catalog, then Vite on :5173
npm run lint           # Biome + the lockfile-transport guard
npm run typecheck      # tsc --noEmit
npm test               # Vitest (incl. the launch.ts no-token suite + DCAT isomorphism)
npm run build          # gen-clientid + gen-catalog + vite build → web/dist
```

The build runs `gen-clientid.mjs` (the per-origin Solid-OIDC Client Identifier Document) and
`gen-catalog.mjs` (the DCAT catalog) inline — **not** as npm lifecycle hooks, because
`ignore-scripts=true` (supply-chain hardening) would skip those. The deploy origin is set at
**deploy** time via `APP_ORIGIN` (e.g. `https://apps.solid-test.jeswr.org`), not baked in at
build.

## Deploy

The store deploys as the **10th pod-app subdomain** alongside the others — see
[`docs/DEPLOY.md`](./docs/DEPLOY.md). In short: a new
`apps.<domain>` Caddy vhost + a static-file handler with `Accept`-routing for the
`/catalog` IRI, built on-box in `node:24-alpine` with `APP_ORIGIN` set. (Deploys run from
the suite's main orchestrating session; this repo documents the recipe but does not touch
the live box.)

**Vercel alternative (committed `web/vercel.json`).** The store is a static SPA, so it
can also deploy to Vercel with zero server work. Import settings: Framework Preset
**Vite**, **Root Directory `web`**, build `npm run build`, output `dist`, install
`npm ci`. Set **`APP_ORIGIN`** (and mirror `VITE_APP_ORIGIN`) to the deploy origin
(e.g. `https://apps.solid-test.jeswr.org` or `<project>.vercel.app`) so the build
regenerates `clientid.jsonld` + the DCAT `/catalog` IRIs for that origin. `web/vercel.json`
serves `clientid.jsonld`/`catalog.jsonld` as `application/ld+json` and `catalog.ttl` as
`text/turtle`, all with `Access-Control-Allow-Origin: *`, plus the SPA `→ index.html`
rewrite.

## License

[MIT](./LICENSE) © Jesse Wright.

---

🤖 Built by the PSS agent (@jeswr's agent for `prod-solid-server` / the Solid app + Pod-Manager
suite). Authored by Claude Opus 4.8.
