# Deploying

The app is a standard Next.js (App Router) site. All Solid auth/data happens
client-side against the user's pod, so there is no server runtime to operate — it
deploys equally well as a **static site** behind any file server, or to **Vercel**.

The Client Identifier Document (`/clientid.jsonld`) is pre-rendered at build time
(`force-static`) with the deployment origin baked in, so the **deploy origin must be
set at build time** via the `APP_ORIGIN` env var. It defaults to
`http://localhost:3200` for local builds.

## Static export (Caddy `file_server` — the `issues.solid-test.jeswr.org` deploy)

Build a fully static site (plain HTML + assets + a pre-rendered `clientid.jsonld`)
into `out/`, with the deploy origin baked in:

```bash
APP_ORIGIN=https://issues.solid-test.jeswr.org APP_STATIC_EXPORT=1 npm run build
# emits: out/index.html, out/clientid.jsonld, out/callback.html, out/_next/…, assets
```

Serve `out/` with Caddy `file_server` on the subdomain (same pattern as the Pod
Manager). Two host requirements:

- **HTTPS** — the IdP rejects a non-`localhost` `client_id` over HTTP.
- **`.jsonld` MIME** — `/clientid.jsonld` MUST be served as `application/ld+json`.
  Caddy's default MIME map does not cover `.jsonld`, so set it explicitly, e.g.:

  ```caddyfile
  issues.solid-test.jeswr.org {
    root * /srv/issues
    @clientid path /clientid.jsonld
    header @clientid Content-Type application/ld+json
    file_server
  }
  ```

`APP_STATIC_EXPORT=1` switches `next.config.ts` to `output: "export"` (a static
export is incompatible with `next start`, so it stays opt-in — the default build
remains a `next start`-servable server build used by the Playwright e2e harness).

## Vercel

```bash
APP_ORIGIN=https://<your-vercel-domain> npx vercel --prod
```

Or set `APP_ORIGIN` in the Vercel project's Environment Variables and let
push-to-`main` auto-deploy. (Without `APP_STATIC_EXPORT` this is the normal server
build; only `clientid.jsonld` is pre-rendered, so `APP_ORIGIN` must match the
deployed domain for the published `client_id` to be dereferenceable.)

## Production login (automatic)

- The **Client Identifier Document** at **`/clientid.jsonld`** advertises
  `client_id` / `redirect_uris` (`/callback.html`) / `client_uri` at `APP_ORIGIN`,
  with `scope: "openid webid offline_access"`, so on the deployed HTTPS origin the
  app authenticates with this stable `client_id` and the consent screen shows
  **"Solid Issues"**.
- On `localhost` the app falls back to **dynamic client registration** at runtime (a
  remote IdP can't dereference a `localhost` client-id document) — so local dev and
  localhost-against-live testing both work without changes.
- **Identity provider:** login is **WebID-first** — the user enters their WebID and
  the OIDC issuer is resolved from the profile's `solid:oidcIssuer`. A user on the
  `solid-test` pods therefore logs in via `https://idp.solid-test.jeswr.org` (the same
  live broker the Pod Manager uses) automatically, with no app-side issuer config.

`public/callback.html` is the OIDC redirect target (it `postMessage`s the auth
response to its own origin) and ships in every build.
