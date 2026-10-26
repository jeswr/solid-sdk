# Interoperability testing

The library is tested against real servers and identity providers, not only against the mock servers in `test/`.
The harness lives in `interop/`. It runs the built library (`dist/`) through its public API, exactly as an
application wires it, and writes a sanitized report.

- [Local servers](local.md): Community Solid Server, Keycloak, Node Solid Server, Solid Nextcloud, PHP Solid Server
  and Manas, all in disposable Docker containers. These run in CI and are mandatory.
- [Hosted Solid pod providers](solid-hosted.md): the 15 providers listed on solidproject.org (census of
  2026-09-27), plus Enterprise Solid Server and TrinPod.
- [Standard OAuth 2.0 / OpenID Connect providers](live-providers.md): GitHub, GitLab, Auth0, Okta, Google (web
  server flow), Microsoft Entra (code flow), and any other OIDC provider.
- [Google Identity Services and MSAL.js](google-microsoft.md): the providers' own browser SDKs, with the library
  running in the page.
- [External Linked Web Storage deployments](lws.md): the OpenID, SAML, controlled identifier and did:key suites.
- [Solid-OIDC with UMA authorization servers](uma.md): `SolidUmaTokenProvider` against a configured deployment
  (UMA challenge, claim push of the Solid-OIDC ID token, RPT use). This is never Keycloak or plain OAuth evidence.

## Results

Each scenario of each target is recorded with one of four statuses:

| Status | Meaning | Counts as compatibility? |
| --- | --- | --- |
| `PASS` | Ran, made at least one check, and every check held. | Yes |
| `FAIL` | Ran and a check or step failed. Also used for scenarios blocked by a failed prerequisite, and for runs that timed out. | No, and it fails the run |
| `UNTESTED` | Not run here. The cause is missing configuration or credentials, a capability declared `"unverified"`, a manual sign-in without `--headed`, or no data location configured. | No. With `--strict`/`--require` it fails the run |
| `UNSUPPORTED` | The manifest documents a known absence: a capability `false` with a reason, or a scenario the target can't run. Also used for a declared known incompatibility that reproduced in this run, and for scenarios depending on it. | No |

Rules the harness enforces, each covered by `test/interop-harness.test.js`:

- A `PASS` needs at least one check.
- An undeclared capability is a configuration gap: `UNTESTED` for the scenario, and manifest validation fails.
- Unknown behaviour is declared `"unverified"`, never `false`.
- A declared known incompatibility runs every time. It becomes `UNSUPPORTED` only if it fails with its exact
  signature. If it passes, fails in another way, or times out, that is a `FAIL`.
- A run in which nothing passed is never OK. The one exception is `--verify-known-incompatible` when at least one
  declared incompatibility reproduced.
- Setup, adapter, teardown and browser-context failures fail the run. Every selected target is listed in the
  report even when the run aborts.
- `--strict` treats every selected target as required.

Reports go to `interop/reports/<name>/report.{json,md}` (git-ignored). They keep target and scenario IDs,
statuses, check counts, durations, safe flow facts and versions, and nothing else. They never contain tokens,
authorization codes, cookies, client secrets, account names, email addresses or WebIDs of live accounts, and no
HAR files, traces or screenshots are captured.

Failure reasons for live targets are built only from allowlists: the harness's own check messages, known error
class names, and registered OAuth or Node error codes. Values that identify a person are compared with checks that
never print them.

## Where the library runs

| Environment | How it is exercised | Evidence here |
| --- | --- | --- |
| Node.js (library in Node) | `solid-oidc`, `oauth-code`, `lws` and `solid-uma` adapters. A real browser (Playwright) is only the user agent for the provider's login pages; the redirect lands on a loopback listener. | CSS (dynamic registration and a Client Identifier Document) and Keycloak (public, `client_secret_basic`, `client_secret_post`, plain OAuth, short-lived, no-audience): all pass |
| Node.js, no browser at all | `client-credentials` adapter (`ClientCredentialsTokenProvider`: a script acting as its WebID with DPoP-bound client-credentials tokens) | CSS: 5/5 pass (a disposable credential is created through the CSS account API and deleted afterwards) |
| Browser (library in the page) | `solid-browser` adapter (`<authorization-code-flow>` popup, WebCrypto DPoP keys, CORS); `google-gis` and `msal-browser` adapters; the browser suite in `test/browser/` (service worker, Web Locks, BroadcastChannel, IndexedDB persistence). | Chromium 153, Firefox 155 and WebKit 26.6 pass against real CSS (Firefox on Linux; see limits) |
| Node.js versions | `npm test` on 24.5.0 (the minimum), the latest 24 and 26, on Linux, macOS and Windows (CI). | Node 24.5.0, 25.1.0 and 26.10.0 (macOS) |

Not claimed: Bun, Deno, React Native or other mobile runtimes, and Electron. None of them is tested.

## Commands

```sh
npm run interop:list                           # every target, its adapter and what is missing to run it

# Local, disposable (Docker with Compose v2; ports on 127.0.0.1 only; containers removed afterwards)
npm run interop:local                          # CSS (3 profiles) + 6 Keycloak configurations, strict: all must pass
npm run interop:local:browser -- --browser webkit        # library in the browser against CSS (chromium|firefox|webkit)
npm run interop:local:incompatible             # NSS, Nextcloud, PHP, Manas: declared incompatibilities must reproduce

# Live (needs credentials in RA_INTEROP_* variables; see each page)
npm run interop:live -- --target solidcommunity-net --require solidcommunity-net --headed
```

`npm run interop:local:incompatible -- --strict` is expected to fail: those servers have no passing scenario, and
strict coverage demands one. Use `--verify-known-incompatible` (the script's default) to check them.

### Live configuration, unattended sessions and unverified capabilities

- **One configuration document.** Instead of hundreds of separate variables, provide one JSON document with
  `--config <file>` or in `RA_INTEROP_CONFIG`:

  ```json
  {"variables": {"RA_INTEROP_GITHUB_CLIENT_ID": "…", "RA_INTEROP_GITHUB_USER_ID": "…"},
   "files": {"RA_INTEROP_GITHUB_STORAGE_STATE": {"base64": "…"}}}
  ```

  It accepts only `RA_INTEROP_*` variables that some target declares (`interop/lib/runConfig.js`). Files (session
  states, private JWKs) are written to a fresh directory under the user's temporary directory and removed when the
  run ends:
  - On POSIX systems the directory is 0700 and the files are 0600.
  - Windows has no POSIX mode bits, so the per-user temporary directory's ACL applies (by default the user, SYSTEM
    and Administrators).

  Files are never uploaded, and every value is registered for redaction. In CI this document is the single secret
  `INTEROP_LIVE_CONFIG`.
- **Unattended sign-in ("session" mode).**
  - A target whose login is `manual` normally needs `--headed`.
  - Without `--headed`, it runs only if a dedicated test account's saved IdP session (`*_STORAGE_STATE`, a
    Playwright storageState recorded once in a headed browser) is configured. The provider must then redirect back
    without any interaction.
  - The run fails closed ("dedicated session expired or needs interaction") when:
    - a login form appears;
    - a Node-executed login (the `session` recipe) gets no redirect within 30 s;
    - a browser-SDK popup (Google, Microsoft) doesn't complete within 60 s.

    Nothing is ever typed, and personal browser profiles are never used.
  - A configured `storageState` file that does not exist is a configuration error, never silently ignored.
  - Whether a provider allows this from a CI runner is documented per provider, and many (MFA, device-bound
    sessions, consent prompts) need a local headed run.
- **Required test identity.** Committed live targets require the expected account (WebID, user id, email, UPN or
  subject). The adapters compare it in memory, so a different signed-in account never counts as a pass.
- **`--exercise-unverified`.** Also runs scenarios whose capability is declared `"unverified"`, such as automatic
  storage discovery or refresh-token rotation on hosted pods.
  - It also asserts those capabilities inside scenarios that run anyway, for example rotation in `*.refresh-restore`
    or revocation in `*.logout`. One policy decides this (`expectsCapability`): assert when the capability is
    declared `true`, or when it is `"unverified"` and being exercised. An absent feature then fails, e.g. a refresh
    that did not rotate.
  - The result is what this run observed: PASS or FAIL, with `exercisedUnverified` noted. The manifest's
    expectation (e.g. a normative Solid requirement) is never counted as proof.

Other options:

- `--no-stack`: reuse a stack you started with `node interop/local/stack.js up <services…>`.
- `--report-dir <dir>`: write the report somewhere else.
- `--browser <engine>`: choose the Playwright engine.
- `--headed`: allow manual sign-in; you complete the login and any MFA yourself, and nothing is stored.

Optionally, a Playwright `storageState` file from a test-only account (the path goes in the target's
`*_STORAGE_STATE` variable, and the file is never committed) can reuse an identity-provider session.

## CI

`.github/workflows/ci.yml`:

- `test`: `npm test` (library and harness tests) on Node 24.5.0, the latest 24 and 26, on Linux, macOS and Windows.
- `browser`: the browser suite and the offline Google/Microsoft wiring check, on Chromium, Firefox and WebKit.
- `interop-local` (mandatory):
  - `interop:local`, strict: CSS (dynamic registration, Client ID document, client credentials) and Keycloak (six
    configurations).
  - `interop:local:incompatible`, which verifies each declared incompatibility.
- `interop-browser`: `interop:local:browser`, strict, on each engine.
- Reports are uploaded as artifacts.

`.github/workflows/interop-live.yml` runs only on manual dispatch:

- You choose the targets (optionally with `--exercise-unverified`), and every selected target is required.
- The credentials are the one `INTEROP_LIVE_CONFIG` secret described above.
- A missing configuration, an expired session, or a target that needs a person fails the run rather than passing as
  untested.
- `browser` also runs, in each engine:
  - `npm run test:browser:regressions` (`RA_TEST_BROWSER=<engine>`): the browser-SDK driver's cancellation and
    session-mode regressions.
  - `interop/runtime/selftest.js`: the Solid browser adapter's abort and ownership self-test.
  - `interop/browser/wiring.js`.

  A browser that cannot launch fails the job; nothing is skipped. `npm test` stays offline and launches no browser.

## Manifest

The manifest is `interop/targets/*.json` (`schemaVersion` 1), made of fragments that are merged and validated
together. Each target declares:

- `adapter` and `category` (`local` or `live`), plus the `software` (name, version, open/closed/service, URL).
- `env`: `RA_INTEROP_*` variables with descriptions and `secret`/`pii`/`optional` flags.
- `config`: may reference those variables.
- `capabilities`: `true`, `false` or `"unverified"`, with `capabilityNotes` reasons.
- Optionally `unsupported`, `knownIncompatible` (a reason plus a failure signature) and `scenarios`.

The adapter specs in `interop/lib/manifest.js` list each adapter's scenarios and capabilities.

## Evidence (2026-09-27, macOS arm64, Node 25.1.0, Docker 27.4.0)

- `npm test`: 185/185 pass, none skipped (library plus harness tests). Earlier 183-test revisions passed on Node
  25.1.0, 24.5.0 and 26.10.0.
- TypeDoc (`--emit none`), `npm pack --dry-run` and `npm audit --omit=dev` (0 vulnerabilities) pass.
- `npm run interop:local` (strict): PASS 44, FAIL 0, UNSUPPORTED 8 (declared).
  - Covers CSS in three profiles (dynamic registration, Client Identifier Document, client credentials) and
    Keycloak in six configurations.
- `npm run interop:local:incompatible`: all four declared incompatibilities reproduced (UNSUPPORTED 25, UNTESTED 11
  for unverified capabilities). The same run with `--strict` fails, as documented.
- `npm run interop:local:browser`: 5/5 on Chromium 153 and on WebKit 26.6.
- Firefox 155 on Linux (Playwright 1.63 container):
  - browser suite 9/9;
  - SDK regressions 2/2, wiring check and Solid browser adapter self-test pass;
  - `css-local-browser` 5/5 against a real CSS container.
- Browser suite: 9/9 on Chromium and on WebKit. `npm run test:browser:regressions` (2/2), the offline wiring check
  and the Solid browser adapter self-test pass on both.
- Live targets were not run, because no credentials are configured.
  - They report `UNTESTED` with the missing variable names, and `--require` fails. For example,
    `--target google-gis,microsoft-msal,github --require` gives 16 UNTESTED scenarios and exits 1.
  - An undeclared variable in the run configuration is refused.
  - A configured but missing session file is a configuration error.
  - No live compatibility is claimed.

## Limits

- Firefox is exercised on Linux (CI and the Playwright container). On the development host (macOS, Darwin 27),
  Playwright's Firefox build 1543 exits at launch with "Could not find profile folder". The sandbox and the
  temporary directory were both ruled out as causes.
- Solid Nextcloud and NSS images are built from their upstream Dockerfiles at pinned commits, with floating base
  images pinned by digest. Package installation inside those builds (`apt-get`, `composer`) still resolves at
  build time, so rebuilt images may differ in patch versions. PHP Solid Server's packages come from the frozen
  Debian archive.
- Sign-ins that need a person (login forms, consent, MFA) run only locally with `--headed`. With a dedicated saved
  session, they can be attempted unattended (`session` mode), but that has not been verified against any live
  provider.
