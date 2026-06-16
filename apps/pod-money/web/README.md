# @jeswr/pod-money-web — static host shell for Pod Money

A Vite + React **static SPA** that wraps the [pod-money](../) `./ui` `AccountsView`
with a standalone Solid login, and builds to a static `dist/` any file server
(Caddy `file_server`) can serve per-subdomain.

It is the money sibling of `pod-docs/web`: same security-hardened auth seam
(`src/auth/`, copied verbatim — cross-user-leak fix, StrictMode auth-flow holder,
generation-fenced `reset()`, per-probe login proof), same per-origin static
Client Identifier Document model.

## What it does

- **Logged out** → a WebID-first login screen. The OIDC issuer is resolved from
  the WebID profile; the consent screen shows "Pod Money" (static client id).
- **Logged in** → discovers the user's finance ledger from their pod root (Type
  Index → `MoneyStore.discover(fin:Transaction)`, falling back to
  `${podRoot}finance/ledger.ttl` with a banner) and mounts `<AccountsView>`. No
  `fetch` prop — reads go through the auth-patched global fetch (DPoP).

## Build

The per-origin auth artifacts (`clientid.jsonld` + `callback.html`) are generated
at build from `APP_ORIGIN` (the deploy origin), so a copy can never drift from
the origin it claims:

```bash
# dev (Vite server)
npm run dev

# production build for the money subdomain → static dist/
APP_ORIGIN=https://money.solid-test.jeswr.org npm run build
```

The HOME IdP issuer hint is `https://idp.solid-test.jeswr.org`
(env-overridable via `VITE_HOME_IDP`); the auth issuer always comes from the
WebID profile.

## Gate

```bash
npm run lint
npm run typecheck
npm test
APP_ORIGIN=http://localhost:5173 npm run build
APP_ORIGIN=https://money.solid-test.jeswr.org npm run build
```

`ignore-scripts=true` (`.npmrc`) — supply-chain hardening; no npm lifecycle hook
runs on install.
