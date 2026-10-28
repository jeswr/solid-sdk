<!-- AUTHORED-BY Codex GPT-6 -->
# Pod Migrator

An experimental React 19 app for copying a Solid pod and reviewing how permissions translate between providers. Source files remain in place. The migration engine enforces the permission checks; the UI requires an explicit choice for every decision and blocks any abort selection.

Two independent sign-ins use `@jeswr/solid-auth-core`, with separate session databases, storage keys, and full-page callbacks at `<base>callback/source` and `<base>callback/target` (base defaults to `/`). Enter a WebID or select identity provider mode; quick picks cover Inrupt PodSpaces and solidcommunity.net. Storage comes from the authenticated WebID subject’s `pim:storage`, with a required choice when several roots exist. Swapping direction keeps each account bound to its original credentials.

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
registers `<origin><base>callback/source` and `<origin><base>callback/target`. Builds emit
`404.html` and static callback entries as copies of `index.html`, so callbacks load on Pages
without rewrite rules. Host-added trailing slashes on callback directories are accepted;
the token exchange retains the originally registered redirect URI. An `APP_ORIGIN` setting
or CI makes a build deployable and requires HTTPS; a CI build without `APP_ORIGIN` fails.
An unconfigured local build uses `http://localhost:5173` for development. The provider must
be able to dereference the public client document; use the HTTPS deployment for live accounts.

The app uses shared app-shell light/dark/system themes. The flow is connect source → connect target → options → plan → run → result. Linked-data IRI rewriting defaults off. Targets must be folders inside the selected target pod; overlapping source and destination trees are refused. Only informational report items have preselected choices. Each report item exposes its explanation and original Turtle rule, with bulk choices limited to its own kind and supported options.

Cancel during planning discards the plan. Cancel during execution waits for the in-flight operation and displays the engine’s partial result. Progress and the final report are kept in this tab’s `sessionStorage`, including resource paths and permission decisions, without credentials. A reload labels an unfinished run interrupted and never resumes writes automatically. Download the JSON report to retain it after closing the tab. If browser storage is unavailable, a notice explains that the log cannot survive reload.

Screenshot tests run against a development-only mocked engine and mocked accounts:

```sh
pnpm --filter @jeswr/app-pod-migrator test:e2e
```

They cover 375, 768, and 1280 pixel widths in light and dark, capture connection/options/review/run/result screens into ignored `e2e/screens/`, and check overflow, decision gating, abort, and report download. `--mode screens` enables these mocks only in the dev server; builds in that mode are refused. They do not establish live PodSpaces or solidcommunity.net compatibility.

Compared with the design, a completed callback uses the session already established by `handleRedirect`; `restore()` runs only when there is no completed callback, following the auth-core lifecycle. Private profiles use authenticated fetch only for the exact signed-in WebID document, without redirects. Ambiguous WebID issuers fail closed with instructions to enter a chosen provider URL. Unexpected engine failures show an interrupted run without inventing counts or claiming verification.

Access documents must belong exclusively to the resource being migrated. Planning inventories
the existing target tree and profile, and execution rechecks advertisements and document scopes
before writing. Shared/inherited ACL URLs produce skip/abort decisions or a safe execution
failure. Final verification also proves the target owner retains root access, including Control,
even when the root was skipped. CSS-effective denials under other ACR nodes are retained
conservatively; ambiguous grants and unplaced constructs produce owner-only/skip/abort decisions.
Verification refuses target documents with foreign scopes, so an ineffective denial cannot hide
an accidentally broader grant.
