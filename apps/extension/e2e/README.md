# Extension E2E tests

Use Node.js 24 and the locked dependencies:

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

CI runs the same E2E command after `npm run gate`. The command builds `dist/`, then
Playwright's global setup starts an in-memory Community Solid Server on port 3000,
seeded from `setup/seed.json` and `setup/templates/pod/`. It discovers the unpacked
extension's ID and starts the test sites on ports 8080 and 8081 with matching Client
ID Documents. No separately running server or live pod is needed.

Each test loads the real extension in a fresh persistent context using headless
Chromium (`channel: 'chromium'`, which supports extensions). No display server is
needed. The suite has zero retries.

Popup sign-in does not grant unrelated web origins access. The fetch/navigation
tests explicitly opt the test site in using `SOLID_SET_CLIENT_ID` from its
browser-attested isolated world, await the worker's acknowledgement, and reload to
read the granted state. The fetch test also checks that the ungranted site receives
no WebID and its private fetch is denied. The app-login scenario separately drives
the public `window.solid.setClientId` API.

On runners with a read-only home directory, Chromium can fail before any test with
`chrome_crashpad_handler: --database is required`. The launches disable crash
reporting and Breakpad; if the error persists, give Chromium a writable config
directory (without changing where Playwright finds the installed browser):

```sh
mkdir -p /tmp/solid-extension-chromium-config
XDG_CONFIG_HOME=/tmp/solid-extension-chromium-config npm run test:e2e
```

Likewise, if npm's default cache is read-only, set `npm_config_cache` to a writable
directory when installing and running the suite.
