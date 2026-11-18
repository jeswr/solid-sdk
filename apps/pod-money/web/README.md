<!-- AUTHORED-BY GPT-6.1 Sol -->
# @jeswr/pod-money-web — static host shell for Pod Money

A Vite + React static SPA that wraps [Pod Money](../)'s `AccountsView` with
standalone Solid sign-in and builds to a static `dist/` for any file server.

## What it does

- Logged out: the shared sign-in card offers recent accounts, a WebID or provider
  address, the home provider, listed providers and a custom provider.
- Logged in: discovers the finance ledger through
  `MoneyStore.discover(fin:Transaction)`, falling back to
  `${podRoot}finance/ledger.ttl` with a note, and shows accounts and transactions.
  Feedback, theme controls and the extension-aware account menu remain in the header.

## Auth

Money configures `@jeswr/app-session` in the small `src/auth/pod-auth.ts` adapter
and supplies its name and exact legacy keys to the shared `SessionProvider` in
`src/main.tsx`. Its `SessionProvider`, `useSession` and `LoginScreen` come from
`@jeswr/app-session/react`, following Pod Docs and Pod Drive. The package owns
one page-lifetime `@jeswr/pod-auth` core and the shared `@jeswr/suite-ui/sign-in`
card. Addresses resolve
through a pristine public fetch. A WebID listing several providers asks the user
to choose explicitly while retaining that WebID.

The core restores once on mount, including React StrictMode replay, and owns all
credentials, persistence and logout. Its bounded `auth.fetch` is passed explicitly
to `MoneyStore` for Type Index discovery and to `AccountsView` for ledger reads.
Global fetch stays public. The automatic credential boundary uses only the
authenticated WebID's verified storage roots. Public profile reads for display
name, avatar and pod root use the pristine public transport.

The first advertised `pim:storage` supplies the pod root. When none is present,
Money retains its WebID-origin fallback and explains that only public finance
data can be read there; the fallback grants no credentials.

The popup element is lazily registered from
`@jeswr/reactive-authentication/registerElements`. A StrictMode-safe holder adapts
its disposable result to the full callback URL. Insecure loopback and dynamic
client registration are enabled only in a development build (`npm run dev`) on
localhost, 127.0.0.0/8 or ::1. Other builds require an HTTPS Client Identifier
Document, so HTTP `vite preview` cannot sign in. Silent `prompt=none` authorization
during restore is declined, keeping popups behind a click. Popup cancellation and
failures show plain messages without raw protocol details.

On first mount, Money removes only its pre-pod-auth IndexedDB database
`pod-money:sessions`, localStorage pointer `pod-money:remembered-account`, and
sessionStorage records `pod-money:autologin-attempted` and
`pod-money:pss.autologin.flow`. Theme preferences and other apps' data are preserved.
Existing legacy sessions require a fresh sign-in.

A `#autologin/<encoded-webid>` deep link adds a one-click account row and is
removed from the address bar. It never starts login without a click. Only
`callback.html` is registered as an OAuth redirect URI.

## Build

The generator runs inline before build/dev (lifecycle hooks are disabled by
`ignore-scripts=true`). It writes `public/clientid.jsonld` and
`public/callback.html` from `APP_ORIGIN`, with optional `CLIENT_BASE_PATH`
(`/solid-sdk/pod-money/` for Pages). Their committed development copies use
`http://localhost:5173`. The callback posts the full URL only to its own origin.

```bash
npm run dev
APP_ORIGIN=https://money.solid-test.jeswr.org npm run build
```

`VITE_HOME_IDP` configures the first provider (default
`https://idp.solid-test.jeswr.org`); `VITE_HOME_IDP_NAME` supplies its label.
`VITE_KNOWN_PROVIDERS` optionally supplies comma-separated HTTPS provider URLs.

## Validation

From the workspace root:

```bash
pnpm turbo run lint typecheck test build --filter=@jeswr/pod-money-web --filter=@jeswr/app-pod-money --output-logs=errors-only
pnpm exec biome check apps/pod-money/web/src apps/pod-money/web/scripts apps/pod-money/web/tests apps/pod-money/web/test
pnpm --filter @jeswr/app-pod-money run coverage
```

`npm run test:e2e` starts a fresh local CSS and Vite, seeds an account, Type Index
and private finance ledger, drives the real popup sign-in, checks the account and
transaction rows, and verifies that ambient fetch still receives 401/403. It
requires the local CSS package and a Playwright Chromium installation. Seeded
credentials and Playwright output are ignored by git.
