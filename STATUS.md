<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.28 — reactive-authentication import

Completed on `lane/sst-8xm.28`, based on `219cdd5a1579a95a6408f272fe6344e72e2e8664`.

## Changes and commits

| Commit | Change |
| --- | --- |
| `da134d1f` | Import all 92 commits from the supplied `reactive-authentication-ai` main (`1b0a7ec`) through a temporary `git clone --no-local` and `git filter-repo --to-subdirectory-filter packages/reactive-authentication`, then merge the filtered history (`93848b8`) locally with unrelated histories allowed. |
| `9436490a` | Rename to `@jeswr/reactive-authentication`; retain all four exports and registration side effects; mark security-critical and private; integrate pnpm, strict TypeScript, Biome, Vitest and enforced 100% coverage; update `suite.json`, lockfile and package skill. Port all 185 original unit/harness tests. |
| `daa9d6c9` | Bundle the browser cache fixture so its transitive `idb-keyval` dependency resolves with pnpm's strict layout. |
| `9db0d7d9` | Add element and worker tests for popup validation, cancellation, WebID/issuer selection, trusted worker messages and tab isolation. |
| `e723d8e9` | Add protocol, storage, credential, SDK, cache and session adversarial tests, reaching 100% coverage. The challenge cursor reuses its existing length getter without changing parsing behavior. Extend only test fixtures for absent `azp` and non-OpenID grants. |
| `716d285b` | Update package README for workspace usage and record the original import lane report. |

Conservative import choices: preserve upstream version `0.1.5` and the existing `.`, `./elements`,
`./registerElements`, `./service-worker` API. Keep the package private pending suite conformance.
No new suite auth policy, RFC 9728 implementation, deployment, publishing or consumer migration.

## Dependency policy

All checks ran before dependency installation; policy and lifecycle-script settings were unchanged.

```sh
pnpm run check:packages @key-value-kit/core @key-value-kit/storage http-link-header multiformats
```

PASS (4 packages, full registry checks): `@key-value-kit/core` and `@key-value-kit/storage` were each
30 days old, meeting `minAgeDays: 30`; `http-link-header` was 3649 days old and `multiformats` 2360.
The KV dependencies passed, so no vendored KV fallback was needed.

```sh
pnpm run check:packages --scan /home/runner/work/solid-sdk-lanes/_sources/reactive-authentication-ai/package.json --strict
pnpm run check:packages @biomejs/biome vitest @vitest/coverage-v8 typescript --strict
```

PASS: all 25 upstream runtime/development dependencies, and all 4 workspace tooling checks.
Upstream dependencies were retained; the workspace tooling/coverage additions are the tools required
by the lane brief. No new runtime dependency was introduced beyond the imported manifest.

Installation commands (PASS; no lifecycle scripts):

```sh
CI=true pnpm install --ignore-scripts --lockfile-only --store-dir /tmp/sst-8xm28-pnpm-store
CI=true pnpm --filter @jeswr/reactive-authentication --filter @jeswr/solid-sdk-workspace install --frozen-lockfile --ignore-scripts --store-dir /tmp/sst-8xm28-pnpm-store
```

The default pnpm store was read-only in this sandbox; retrying with the writable temporary store
resolved installation. The shared lockfile contains pnpm's resulting peer-resolution updates.
`git-filter-repo` was absent from PATH and was installed only into `/tmp/sst-8xm28-filter-repo` with
`python3 -m pip install --target /tmp/sst-8xm28-filter-repo git-filter-repo`.

## Final gate

The exact required package gate ran successfully after the implementation commits and before the
final documentation commit, using Node `24.22.1`, pnpm `10.4.1`, TypeScript `6.0.3`, Vitest `4.1.10`:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
```

- PASS lint: zero errors; 62 inherited/style warnings and 21 informational diagnostics remain.
- PASS build: fresh `dist/` generated, none committed.
- PASS typecheck, including the original Google/MSAL SDK type-contract checks.
- PASS all 246 tests in 27 files, with no skips; all 185 original tests remain present and pass.
- PASS enforced coverage: statements **2009/2009**, branches **1486/1486**, functions **463/463**,
  lines **1808/1808** — **100% in every metric**. Coverage includes every `src/**/*.ts` file.
- PASS root lint, lockfile-transport guard, app-workspace guard and raw-fetch guard.

Additional browser validation (PASS):

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/sst-8xm28-browsers pnpm --filter @jeswr/reactive-authentication exec playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/sst-8xm28-browsers pnpm --filter @jeswr/reactive-authentication run test:browser
PLAYWRIGHT_BROWSERS_PATH=/tmp/sst-8xm28-browsers pnpm --filter @jeswr/reactive-authentication run test:browser:regressions
```

Chromium `156.0.8078.4`: all capability, page, opaque redirect, service-worker, automatic-boundary,
Google adapter, popup, cache reload/non-extractable key, and request-body replay checks passed;
both browser regression tests passed. The preinstalled browser version did not match the imported
Playwright version, so its matching browser was downloaded into `/tmp`. The initial browser cache
timeout was fixed by `daa9d6c9`; final runs passed.

Manifest/history checks passed: expected name, `securityCritical: true`, all four exports,
no `@solid/` name in this package manifest, all 92 filtered source commits are ancestors of HEAD,
and no tracked `dist/`. `git diff --check` passed.

The new package has no existing workspace dependants, so no dependant gate was applicable.
The dispatcher-requested scope was respected: no whole-workspace gate or `gate:full`, no network
Git fetch/merge, push, PR, branch switch, or edits to another checkout. Registry/tarball and browser
downloads were used only for dependency installation and validation.

## Unfinished, blocked and open questions

Implementation and lane gate: nothing unfinished or blocked. No open design questions.

The required external roborev review could not run because `roborev` is not installed on the runner.
Dispatcher/security review remains outstanding; this security-critical package has not been auto-merged.
The wider workspace gate and configured live/Docker interoperability runs remain with the dispatcher;
they were outside this lane's requested gate scope.

## Fix round 1 — review `716d285bc60c`

Completed the four findings in
`solid-sdk-lane-sst-8xm.28-716d285bc60c.md` on `lane/sst-8xm.28`.
Only the authentication package and this report changed; no dependencies were added.

| Commit | Change |
| --- | --- |
| `5250bf55` | Capture the DPoP operation's fence signal and generation before issuer/context discovery in both `upgrade()` and `restore()`, and carry that generation into session acquisition. Add six logout-race regressions, including shared-store supersession without broadcasts. |
| `4978e7fc` | Recheck the current boundary immediately before every provider-credentialed send, after provider work, challenge-body disposal and session checks. Add five regressions for removal during initial/nonce/renewal upgrades, automatic-root expiry, and removal during body disposal. |
| `3b67575c` | Pass cancellation signals into both picker lock requests and check them before opening dialogs. Add four regressions using real queued Web Locks and an abort at lock grant. |
| `a975729c` | Preserve DPoP/LWS invalidation context in weak maps keyed by returned requests. Strengthen both history-eviction regressions to require renewal after 101 credentials and preserve replacements on late rejection. Retain recent cloned-request compatibility. Reuse the session-owned fence so the existing shared-store validation remains enforced. |
| Final documentation commit (this commit) | Record fix-round changes, verification and remaining review-tool limitation. |

Conservative behavior: if the boundary is removed or expires during authentication, reject with
`ReactiveAuthenticationError` before sending credentials. Keep the existing bounded token-history
fallback for recent request copies; outstanding returned requests retain context independently.

### Fix-round verification

PASS final required package gate and root checks:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
```

- Lint: zero errors; the existing 62 warnings and 21 informational diagnostics remain.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **261/261** pass in **27/27** files, with no skips.
- Enforced coverage: statements **2036/2036**, branches **1497/1497**, functions **464/464**,
  lines **1835/1835** — **100% in every metric**; thresholds and included sources were unchanged.
- Root checks: Biome, lockfile transport, app workspace and raw-fetch guards all pass.
- `git diff --check`: pass.

The first full run caught two existing constructor-validation regressions in the initial fence patch.
Reusing `OidcSession`'s fence corrected them; the final full run above passes both existing tests.

Regression sensitivity check: temporarily substituted the original six implementation sources from
`716d285b` while retaining the new tests, then restored every source in a `finally` block:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/session-coverage.test.js test/fetch-coverage.test.js test/browser-elements.test.js --coverage.enabled=false --testTimeout=2000 '--testNamePattern=remains fenced|boundary removal during|automatic boundary expiry|picker rechecks cancellation|outstanding invalidation contexts'
```

Expected baseline failure: **12/12 selected regressions failed**, covering all four review findings.
All those regressions pass with the fixes, in the final coverage-enforced run.

PASS existing Chromium suites against the freshly built output, using the already cached browser:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/sst-8xm28-browsers pnpm --filter @jeswr/reactive-authentication exec node test/browser/run.js
PLAYWRIGHT_BROWSERS_PATH=/tmp/sst-8xm28-browsers pnpm --filter @jeswr/reactive-authentication exec node --test test/browser/sdk-regressions.test.js
```

Chromium `156.0.8078.4`: all browser scenarios pass; both SDK/browser regressions pass.
No browser download or network Git operation was needed.

Dependencies were restored from the existing local store without changing manifests or the lockfile:

```sh
CI=true pnpm --filter @jeswr/reactive-authentication --filter @jeswr/solid-sdk-workspace install --frozen-lockfile --ignore-scripts --offline --store-dir /tmp/sst-8xm28-pnpm-store
```

No `check:packages` run was needed because no dependency was added. The authentication package still
has no workspace dependants. Per the lane brief, no whole-workspace gate or `gate:full` ran.

### Fix-round remaining work and questions

All four requested findings are fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. No push, PR, branch switch or edits to another checkout were performed.

`roborev` remains unavailable on PATH, so per-commit roborev verdicts could not be obtained locally.
Dispatcher/security review remains outstanding; this security-critical package has not been merged.

## Fix round 2 — review `dfd6acf0bd32`

Completed all three findings in `solid-sdk-lane-sst-8xm.28-dfd6acf0bd32.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `fe0b8eb5` | Reject automatic redirects in `secureFetch`, preserving manual redirect inspection for storage discovery. Add four regressions covering LWS metadata, WebID profiles, client documents, explicit follow mode, and manual mode. |
| `ae7f299b` | Pass the OAuth operation's original generation to `OidcSession.get`. Add two peer-logout regressions during delayed generation validation and token invalidation, with broadcasts disabled; check that neither memory nor durable credentials are committed under the newer generation. |
| `3782b12e` | Recheck the provider's resources after token acquisition and fence verification, before attaching credentials. Add three regressions for revocation during initial acquisition, renewal and fence verification while the manager's independent boundary still allows the API. |
| Final documentation commit (this commit) | Record fix-round verification and the remaining review-tool limitation. |

Conservative redirect choice: reject every automatic redirect, including HTTPS destinations, rather than
introduce manual redirect following. Explicit manual callers still receive the response for inspection.
The redirect regressions map only the initial HTTPS URL to a loopback fixture through the injected transport;
native fetch handles the redirect, proving that its insecure target is never contacted.

### Round-2 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; the existing **62 warnings** and **21 informational diagnostics** remain.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **270/270** pass in **28/28** files, with no skips.
- Enforced coverage: statements **2038/2038**, branches **1501/1501**, functions **464/464**,
  lines **1837/1837** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

Regression sensitivity was checked before each implementation fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/transport.test.js --coverage.enabled=false
pnpm --filter @jeswr/reactive-authentication exec vitest run test/oauth-source-coverage.test.js --coverage.enabled=false '--testNamePattern=captured generation'
pnpm --filter @jeswr/reactive-authentication exec vitest run test/oauth-sdk-coverage.test.js --coverage.enabled=false '--testNamePattern=resource revocation'
```

Expected baseline results: **4/4**, **2/2**, and **3/3** selected regressions failed, respectively.
All nine now pass in the final coverage-enforced package gate. Focused storage-discovery and existing
OAuth suites also passed after the corresponding fixes.

No `check:packages` run was needed because no dependency was added. The authentication package still
has no workspace dependants, so no dependant gate applies. Per the lane brief, no whole-workspace
gate or `gate:full` ran. No push, PR, branch switch, network Git operation or edits to another checkout
were performed.

### Round-2 remaining work and questions

No implementation work is unfinished or blocked. There are no open questions.
`roborev` remains unavailable on PATH, so automated per-commit verdicts could not be obtained locally.
Dispatcher/security review remains outstanding; this security-critical package has not been merged.
