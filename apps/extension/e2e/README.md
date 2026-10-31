<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Extension E2E tests

Use Node.js 24 and the workspace lockfile, from the solid-sdk root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @jeswr/app-extension exec playwright install chromium
pnpm --filter @jeswr/app-extension run test:e2e
```

CI runs the same E2E command in `.github/workflows/extension.yml`; `gate.yml` covers lint,
typecheck, unit tests and build. The command builds `dist/`, then Playwright's global
setup starts an in-memory Community Solid Server on port 3000, seeded from
`setup/seed.json` and `setup/templates/pod/`, with an isolated Components.js module root
(see `setup/css-server.ts`). It discovers the unpacked
extension's ID and starts the test sites on ports 8080 and 8081 with matching Client
ID Documents. No separately running server or live pod is needed.

The seed has two independent accounts (`test@example.com` / `test-pod` for Alex Wilder
and `work@example.com` / `work-pod` for Morgan Chen), both with password
`test-password-123`. Each pod's private note includes its own text and owner WebID;
its public type index resolves only that pod's note.

Each test loads the real extension in a fresh persistent context using headless
Chromium (`channel: 'chromium'`, which supports extensions). No display server is
needed. The suite has zero retries.

Popup sign-in does not grant unrelated web origins access. The fetch/navigation
tests first check that the ungranted test site gets only the `window.solid` stub, then
grant it through the real flow: a user click calls `window.solid.requestAccess`, and the
test approves the consent window (profile picker included). The revocation test checks
that a captured `fetch` stops working on the next request.

`multi-profile.spec.ts` adds both accounts through the profile controls, explicitly
binds `http://localhost:8080` to Alex and `http://localhost:8081` to Morgan in the
consent picker, and checks private reads and denials in both directions, including
after a default-profile switch. It uses `http://127.0.0.1:8080` as a third, ungranted
origin on the existing test server and checks the exact consent-only API and native
fetch. Finally, it revokes the first site's access through the side panel, checks
its next captured fetch is denied, and verifies the second site's reads still work.
The test has its own fresh browser context and creates all its own profiles and
grants; it does not depend on another spec's state or change shared pod data.

`permission-surfaces.spec.ts` covers populated grant rows (collapsed, expanded, and
revoke confirmation) and form-fill preview cards (unchecked and checked) at 375, 768,
and 1280 pixels in both light and dark themes. It signs in and grants access through
the real extension flows against the seeded local server. Each state checks document
and container horizontal overflow, attaches a full-page screenshot, and runs browser
axe WCAG A/AA checks with colour contrast explicitly enabled. Contrast must produce
passing results with no violations or incomplete contrast checks. The preview is
cancelled after checking, leaving the site's form untouched.

To run just these browser checks (also included in the normal E2E command):

```sh
pnpm --filter @jeswr/app-extension run test:e2e -- permission-surfaces.spec.ts
```

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
