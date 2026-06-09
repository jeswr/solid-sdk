# Deploying

The app is a standard Next.js (App Router) site — it deploys to **Vercel** with no
build config or environment variables. All Solid auth/data happens client-side
against the user's pod.

## Vercel (one-time setup — needs your Vercel account)

1. Push this repo to GitHub (done — see below).
2. In the Vercel dashboard: **Add New → Project → Import** this GitHub repo.
   Framework preset auto-detects **Next.js**; defaults are correct (no env vars).
3. Deploy. After that, every push to `main` auto-deploys (no CI deploy job — Vercel
   owns deploys; GitHub Actions only runs typecheck/lint/unit/build/e2e).

Or from the CLI: `npx vercel` (login) then `npx vercel --prod`.

## Production login (automatic)

- A **Client Identifier Document** is served at **`/clientid.jsonld`** (route handler
  in `src/app/clientid.jsonld/`), deriving `client_id` from the deployed origin.
- On a deployed HTTPS origin the app authenticates with this static `client_id`, so
  the consent screen shows **"Solid Issues"** and the redirect is matched against the
  published `redirect_uris` (`/callback.html`).
- On `localhost` the app falls back to **dynamic client registration** (a remote IdP
  can't dereference a `localhost` client-id document) — so local dev and
  localhost-against-live testing both work without changes.

No other deployment steps are required. `public/callback.html` is the OIDC redirect
target and ships with the build.
