<!-- AUTHORED-BY GPT-6.1 Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
# Pod Migrator

An experimental React 19 app for copying a Solid pod and reviewing how permissions translate between providers. Source files remain in place. The migration engine enforces the permission checks; the UI requires an explicit choice for every decision and blocks any abort selection.

Two independent `@jeswr/pod-auth` sessions use `@jeswr/app-session` for restore, sign-in UI,
remembered accounts and explicit issuer choice. Source pod and Destination pod each render the
shared two-step SignInCard. Each page-lifetime core has its own popup callback
(`<base>callback/source/` or `<base>callback/target/`) and its own credential namespace, derived
by pod-auth from the client ID and redirect URI. Only one popup login can run at a time.
Signing out of one account leaves the other signed in. Storage comes from the authenticated
WebID subject’s `pim:storage`, with a required choice when several roots exist. Swapping
direction keeps each account bound to its original credentials.

Each connection detects the storage implementation separately from its access-control language.
An HTTPS storage hostname under `*.inrupt.com` at the default port establishes ESS; CSS and NSS
require a successful storage-root response with an exposed `X-Powered-By` header identifying
`Community Solid Server` (optionally `/version`) or `solid-server/version`. Detection tries HEAD,
then GET if the header is unavailable or HEAD is unsupported. The login issuer, including
`https://login.inrupt.com/`, cannot identify the storage implementation: an Inrupt account may
own a pod hosted elsewhere. Without storage evidence the implementation stays unknown, and
ACP targets are blocked until CSS or ESS semantics can be established.

From the workspace root, with Node 24 on PATH:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/app-pod-migrator dev
pnpm --filter @jeswr/app-pod-migrator lint
pnpm --filter @jeswr/app-pod-migrator typecheck
pnpm --filter @jeswr/app-pod-migrator test
pnpm --filter @jeswr/app-pod-migrator build:pages
# Other deployments:
APP_ORIGIN=https://migrate.example APP_BASE_PATH=/ pnpm --filter @jeswr/app-pod-migrator build
```

The public deployment is [GitHub Pages](https://jeswr.github.io/solid-sdk/pod-migrator/).
`build:pages` sets `APP_ORIGIN=https://jeswr.github.io` and
`APP_BASE_PATH=/solid-sdk/pod-migrator/`. Publish `dist/` at that base path; builds remain
uncommitted. For another host, set its HTTPS origin and an absolute base path ending in `/`.
Environment fields resolve independently, preferring shell values, mode-local files, mode
files, `.env.local`, then `.env`; empty values do not hide a lower-priority setting.

Vite uses the same base for assets, the app icon, sign-in routing, and the Client Identifier
Document at `<origin><base>clientid.jsonld`. The document's `client_id` is its exact URL and it
registers only `<origin><base>callback/source/` and `<origin><base>callback/target/`.
Both callbacks are standalone popup pages that post the full callback URL to the opener,
with the deployment's exact origin as target. They never load the app or start a restore.
The dev server serves the same documents; builds emit both callback directory entries and
an application `404.html`. Vercel serves callback files outside the SPA rewrite.
Set `APP_ORIGIN` to the deployment's HTTPS origin for production. Dynamic client registration
and insecure loopback authentication require both a development build and a loopback page host;
a production bundle on localhost does not enable either. Migration storage roots retain their
HTTPS-only policy.

The app uses shared app-shell light/dark/system themes. The flow is connect source → connect target → options → plan → run → result. Linked-data IRI rewriting defaults off. Targets must be folders inside the selected target pod; overlapping source and destination trees are refused. Only informational report items have preselected choices. Each report item exposes its explanation and original Turtle rule, with bulk choices limited to its own kind and supported options.

Cancel during planning discards the plan. Cancel during execution waits for the in-flight operation and displays the engine’s partial result. Progress and the final report are kept in this tab’s `sessionStorage`, including resource paths and permission decisions, without credentials. A reload labels an unfinished run interrupted and never resumes writes automatically. Download the JSON report to retain it after closing the tab. If browser storage is unavailable, a notice explains that the log cannot survive reload.

Screenshot tests run against a development-only mocked engine and mocked accounts:

```sh
pnpm --filter @jeswr/app-pod-migrator test:e2e
```

They cover 375, 768, and 1280 pixel widths in light and dark, capture connection/options/review/run/result screens into ignored `e2e/screens/`, and check overflow, decision gating, abort, and report download. `--mode screens` enables these mocks only in the dev server; builds in that mode are refused. They do not establish live PodSpaces or solidcommunity.net compatibility.

Each shared session provider restores once on mount, including StrictMode replay, and stays
mounted throughout planning, execution and role swaps. Each side's `auth.fetch` is passed
explicitly to its private profile reader, server/access probes and migration HTTP adapter.
Global fetch stays pristine; public reads omit cookies. pod-auth alone grants credentials
for verified storage roots; issuer/profile assertions in app code never widen that boundary.
Private profiles retry through the bounded fetch only for the exact signed-in WebID document,
without redirects. Existing complete-graph checks and Unicode/JSON-LD conversion checks remain.
Login cancellation uses abort signals and never signs out either session. Unexpected engine
failures show an interrupted run without inventing counts or claiming verification.

On first mount, the package's `clearLegacyCredentials` removes only the former auth-core stores:
`pod-migrator:{source,target}:sessions` from IndexedDB,
`pod-migrator:{source,target}:remembered-account` and `:recent-accounts` from localStorage,
and `pod-migrator:{source,target}:redirect-flow` and `:redirect-sentinel` from sessionStorage.
The previous `src/auth/connections.ts` configured them; auth-core's controller created the
session stores, remembered/recent account writers and transient redirect records. The app's
theme, migration report, role order and other apps' storage remain intact.

Access documents must belong exclusively to the resource being migrated. Planning inventories
the existing target tree and profile, and execution rechecks advertisements and document scopes
before writing. Shared/inherited ACL URLs produce skip/abort decisions or a safe execution
failure. Final verification also proves the target owner retains root access, including Control,
even when the root was skipped. CSS-effective denials under other ACR nodes are retained
conservatively; ambiguous grants and unplaced constructs produce owner-only/skip/abort decisions.
Verification refuses target documents with foreign scopes, so an ineffective denial cannot hide
an accidentally broader grant.
