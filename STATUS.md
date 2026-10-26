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

## Fix round 3 — review `6da25ef2b778`

Completed both findings in `solid-sdk-lane-sst-8xm.28-6da25ef2b778.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `25bb3490` | Order final generation validation, cancellation and boundary checks, and transport initiation under the fence's shared lock. Release the lock before awaiting the response. Recheck cancellation after asynchronous generation validation before provider work. Add five regressions covering initial, nonce and renewal sends against peer logout, plus cancellation during validation before upgrades and sends. |
| `a4fbfead` | Pass the UMA operation's original ticket generation to `OidcSession.get`. Add a peer-logout regression with broadcasts disabled and delayed validation immediately before ID token acquisition; verify no login, token exchange, memory credential or durable refresh credential is committed by the superseded operation, while a fresh operation succeeds. |
| Final documentation commit (this commit) | Record round-3 verification and the review-tool limitation. |

The send regressions use real Web Locks and confirm that logout waits for transport initiation but
completes while the response is still pending. The UMA regression checks both credential stores;
rejecting the eventual RPT alone is insufficient to pass it.

### Round-3 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **63 warnings** and **21 informational diagnostics**.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **276/276** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2043/2043**, branches **1503/1503**, functions **466/466**,
  lines **1842/1842** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

Regression sensitivity was checked before each implementation fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/logout-send.test.js --coverage.enabled=false
pnpm --filter @jeswr/reactive-authentication exec vitest run test/uma.test.js --coverage.enabled=false '--testNamePattern=captured generation'
```

Expected baseline results: **5/5** send regressions and **1/1** UMA regression failed. The original
UMA implementation started a login, acquired an ID token, disclosed it in an exchange and committed
both memory and durable credentials under generation 1 after peer logout. The fix prevents all five
effects. All six regressions pass in the final coverage-enforced package gate.

Focused verification also passed all **34** core/fetch/send tests and all **10** UMA tests. The first
core run lacked freshly built `dist/` files for its two subprocess import checks; rebuilding and
rerunning passed both checks, as did the final gate. No implementation change was needed for them.

No `check:packages` run was needed because no dependency was added. The authentication package still
has no workspace dependants, so no dependant gate applies. Per the lane brief, no whole-workspace
gate or `gate:full` ran. No push, PR, branch switch, network Git operation or edits to another checkout
were performed. The working tree is clean after this final report commit.

### Round-3 remaining work and questions

Both requested findings are fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev` remains unavailable on PATH, so fresh automated per-commit
verdicts could not be obtained locally. Dispatcher/security review remains outstanding; this
security-critical package has not been merged.

## Fix round 4 — review `aabe179c6427`

Completed both findings in `solid-sdk-lane-sst-8xm.28-aabe179c6427.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `f25357a6` | Remove a superseded durable refresh record under the same fenced commit when the replacement session has no refresh token. Add regressions for refresh followed by reauthorization without offline credentials, restore after clearing memory, and durable deletion failure before the replacement reaches memory. |
| `5d686481` | Retain the verified RPT cache context for each exact resource URL and reuse it for standard DPoP nonce retries. Generate a fresh proof without repeating UMA discovery, context resolution, login or ticket exchange. Add real HTTP and adversarial regressions covering signature/key binding, method and target, access-token hash, distinct proof IDs, separate token/resource nonces, request-body replay, resource/origin isolation, expiry, Bearer rejection, incomplete challenges, invalidation and peer logout during a delayed cache read. |
| Final documentation commit (this commit) | Record round-4 verification and the review-tool limitation. |

Conservative retry behavior: a nonce-only challenge can reuse only a current, usable DPoP RPT already
verified for the exact URL. A missing, expired, invalidated or superseded RPT fails closed; acquiring
an RPT still requires an UMA challenge. Provider selection remains UMA-specific.

### Round-4 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **65 warnings** and **22 informational diagnostics**.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **284/284** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2059/2059**, branches **1520/1520**, functions **467/467**,
  lines **1857/1857** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

Regression sensitivity was checked before each implementation fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/session-coverage.test.js --coverage.enabled=false '--testNamePattern=reauthorization without a refresh token'
pnpm --filter @jeswr/reactive-authentication exec vitest run test/uma.test.js --coverage.enabled=false '--testNamePattern=standard resource-server|nonce retries stay'
```

Expected baseline results: both **2/2** selected session regressions and **2/2** selected UMA regressions
failed. The session tests detected the surviving refresh record and the absent deletion-error rejection;
the UMA tests failed because the nonce challenge carried no UMA `as_uri` or `ticket`. All four, plus
four further nonce safety regressions, pass in the final coverage-enforced package gate.

Focused verification also passed:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/session-coverage.test.js test/persistence.test.js --coverage.enabled=false
pnpm --filter @jeswr/reactive-authentication exec vitest run test/uma.test.js test/uma-coverage.test.js --coverage.enabled=false
```

Results: **19/19** session/persistence tests and **20/20** UMA tests passed. Validation used
Node `24.22.1` and pnpm `10.4.1`.

No `check:packages` run was needed because no dependency was added. The authentication package still
has no workspace dependants, so no dependant gate applies. Per the lane brief, no whole-workspace
gate or `gate:full` ran. No push, PR, branch switch, network Git operation or edits to another checkout
were performed. The working tree is clean after this final report commit.

### Round-4 remaining work and questions

Both requested findings are fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev` remains unavailable on PATH, so fresh automated per-commit
verdicts could not be obtained locally. Dispatcher/security review remains outstanding; this
security-critical package has not been merged.

## Fix round 5 — review `d37d8edce5e5`

Completed the sole finding in `solid-sdk-lane-sst-8xm.28-d37d8edce5e5.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `2e465bdc` | Carry the LWS exchange's original fence generation through `CredentialRequest.expectedGeneration` into `OidcSession.get`. Reuse the session's generation checks before acquisition and its fenced credential commits. Add a peer-logout regression that checks login, token grants, LWS exchange, memory credentials and durable refresh records, then verifies a fresh operation succeeds. |
| Final documentation commit (this commit) | Record round-5 verification and the review-tool limitation. |

The credential-request field is optional for direct source callers. LWS exchanges always supply their
captured generation; credential sessions use the same fence. The regression disables broadcasts and
delays the validation immediately before credential acquisition, so cancellation cannot mask a lost
generation. It verifies that the stale operation writes neither credential store.

### Round-5 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **65 warnings** and **22 informational diagnostics**, unchanged from round 4.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **285/285** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2059/2059**, branches **1520/1520**, functions **467/467**,
  lines **1857/1857** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

Regression sensitivity was checked before the implementation fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/lws.test.js --coverage.enabled=false '--testNamePattern=captured generation'
```

Expected baseline result: the selected regression failed because the stale operation started one login,
obtained one OIDC token grant and committed both memory and durable credentials under generation 1.
The eventual LWS rejection did not remove those credentials. With the fix, all those counts are zero,
and a fresh operation authorizes and commits under generation 1.

Focused verification also passed all **22/22** LWS tests:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/lws.test.js --coverage.enabled=false
```

Validation used Node `24.22.1` and pnpm `10.4.1`. No `check:packages` run was needed because no dependency
was added. No workspace package depends on this package, so no dependant gate applies. Per the lane
brief, no whole-workspace gate or `gate:full` ran. No push, PR, branch switch, network Git operation or
edits to another checkout were performed. The working tree is clean after this final report commit.

### Round-5 remaining work and questions

The requested finding is fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev` remains unavailable on PATH, so fresh automated per-commit
verdicts could not be obtained locally. Dispatcher/security review remains outstanding; this
security-critical package has not been merged.

## Fix round 6 — review `190ed420ef59`

Completed the sole finding in `solid-sdk-lane-sst-8xm.28-190ed420ef59.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `49285007` | Require an explicit `SessionFence` when constructing `OidcIdTokenSource`, expose that fence, and reject an LWS provider whose fence is missing or differs from the source's. Wire one fence through OIDC callers, the OpenID example and the interoperability adapter. Add runtime constructor checks, a compile-time required-fence contract, and a real HTTP regression covering two logout/login cycles with the manager, LWS provider and source sharing the same fence. |
| Final documentation commit (this commit) | Record round-6 verification and the review-tool limitation. |

The required shared fence follows the brief's design call. Even separate fences with the same namespace
are rejected on the LWS OIDC path; their generation numbers must never be compared as if they belonged
to one fence. Non-session credential sources retain their existing optional-fence behavior.

### Round-6 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **65 warnings** and **22 informational diagnostics**, unchanged from round 5.
- Build and typecheck: pass, including the SDK contracts and the new required-fence type checks.
- Tests: **287/287** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2064/2064**, branches **1525/1525**, functions **468/468**,
  lines **1862/1862** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

Regression sensitivity was checked before the implementation fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/lws.test.js --coverage.enabled=false '--testNamePattern=one explicit fence|sharing one fence'
```

Expected baseline result: **1/2** selected tests failed because construction accepted a missing fence;
the explicitly shared-fence logout/login test already passed. After the fix, missing and null source
fences, absent provider fences, and distinct provider/source fence instances are rejected. The HTTP
regression confirms the resource is private, authenticates three sessions across two logout/login
cycles, checks fresh OIDC grants and LWS exchanges, verifies cache reuse within each session, and
checks identity removal and signal cancellation at every logout. The previous peer-logout acquisition
regression remains covered by the passing full suite.

Focused verification also passed all **42/42** tests in the three touched test files:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/lws.test.js test/session-coverage.test.js test/defensive-coverage.test.js --coverage.enabled=false
```

Validation used Node `24.22.1` and pnpm `10.4.1`. No `check:packages` run was needed because no dependency
was added. The dependant dry run selected only this package, so no dependant gate applies:

```sh
pnpm exec turbo run build typecheck test --filter=...@jeswr/reactive-authentication --dry=json
```

Per the lane brief, no whole-workspace gate or `gate:full` ran. No push, PR, branch switch, network Git
operation or edits to another checkout were performed. The working tree is clean after this final
report commit.

### Round-6 remaining work and questions

The requested finding is fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev status` failed with exit 127 (`roborev: command not found`), so
fresh automated per-commit verdicts could not be obtained locally. Dispatcher/security review remains
outstanding; this security-critical package has not been merged.

## Fix round 7 — review `c5d32cc167b7`

Completed the sole finding in `solid-sdk-lane-sst-8xm.28-c5d32cc167b7.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `fb40d2f7` | Close the completed authorization popup during cleanup while the Web Lock is still held. Preserve the disposable result API with cleanup already complete, so immediate, delayed or repeated disposal cannot close the next flow's popup. Add regressions using real Node Web Locks and Chromium, including two queued successful callbacks and verification that the named popup is closed before another flow can reuse it. |
| Final documentation commit (this commit) | Record round-7 verification and the review-tool limitation. |

The implementation follows the review's proposed close-before-release option. Cancellation and failure
use the same popup cleanup. No new protocol behavior or session policy was introduced.

### Round-7 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **65 warnings** and **22 informational diagnostics**, unchanged from round 6.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **289/289** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2060/2060**, branches **1525/1525**, functions **466/466**,
  lines **1859/1859** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

Regression sensitivity was checked before the implementation fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/browser-elements.test.js --coverage.enabled=false '--testNamePattern=disposal of a completed flow'
```

Expected baseline result: **2/2** selected regressions failed because disposing the first result closed
the second popup. The tests use Node's actual Web Locks and cover both immediate disposal and disposal
after the next flow opens. With the fix, the first popup closes before the second opens, repeated disposal
leaves the active popup open, both callbacks resolve, and the second popup also closes on completion.

Additional verification passed:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/browser-elements.test.js --coverage.enabled=false
PLAYWRIGHT_BROWSERS_PATH=/tmp/sst-8xm28-browsers pnpm --filter @jeswr/reactive-authentication run test:browser
```

All **12/12** element tests pass. Chromium `156.0.8078.4` passes all existing browser smoke checks and
the new queued-popup disposal scenarios. Real popup messages complete both queued calls under immediate
and delayed disposal; each completed popup is closed before the next opens, and the flows receive distinct
window references. The installed browser was reused; no dependency or browser download was needed.

Validation used Node `24.22.1` and pnpm `10.4.1`. No `check:packages` run was needed because no dependency
was added. The dependant dry run selected only this package, so no dependant gate applies:

```sh
pnpm exec turbo run build typecheck test --filter=...@jeswr/reactive-authentication --dry=json
```

Per the lane brief, no whole-workspace gate or `gate:full` ran. No push, PR, branch switch, network Git
operation or edits to another checkout were performed. The working tree is clean after this final
report commit.

### Round-7 remaining work and questions

The requested finding is fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev status` failed with exit 127 (`roborev: command not found`), so
fresh automated per-commit verdicts could not be obtained locally. Dispatcher/security review remains
outstanding; this security-critical package has not been merged.

## Fix round 8 — review `b86d58a61f4e`

Completed both findings in `solid-sdk-lane-sst-8xm.28-b86d58a61f4e.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `abe9df91` | Give each issuer-picker operation a cancellable request, capture that request throughout WebID lookup, and cancel it before releasing the picker lock. Ignore superseded results, errors and control cleanup. Reset the next dialog's controls independently. Add regressions using real Web Locks for delayed WebID selection, profile success and profile failure after cancellation, abort and confirmation, plus inactive-action checks. |
| `7eb7c62d` | Return authenticated redirects without `Location` before discarding their response bodies or incrementing the hop count. Replace the old rejection expectation with regressions covering 301, 302, 303, 307 and 308, unchanged response identity and headers, readable bodies, and zero/default redirect budgets. Retain the existing hop-limit rejection check for redirects with a target. |
| Final documentation commit (this commit) | Record round-8 verification and the review-tool limitation. |

The picker keeps active lookup failures visible while ignoring completions from ended operations, even
when a supplied picker or transport ignores cancellation. Its derived request clones the caller's
request so the caller's body remains usable. Redirect handling follows the missing-location return in
[Fetch's HTTP-redirect algorithm](https://fetch.spec.whatwg.org/#http-redirect-fetch); explicit redirect
modes retain their existing behavior. No broader design or policy change was needed.

### Round-8 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **63 warnings** and **22 informational diagnostics**.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **300/300** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2075/2075**, branches **1537/1537**, functions **466/466**,
  lines **1870/1870** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

Regression sensitivity was checked before each implementation fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/browser-elements.test.js --coverage.enabled=false '--testNamePattern=stale profile completion after cancel'
pnpm --filter @jeswr/reactive-authentication exec vitest run test/fetch-coverage.test.js --coverage.enabled=false '--testNamePattern=without Location preserve'
```

Both selected regressions failed as expected: the old picker left the completed operation's lookup
signal live, and the old redirect path threw `Too many redirects` at a zero hop budget before checking
for `Location`. All regression cases pass in the final coverage-enforced gate. Focused element
verification also passed **22/22** tests:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/browser-elements.test.js --coverage.enabled=false
```

An initial combined focused run of `test/fetch-coverage.test.js test/core.test.js` before building
passed 28 tests and failed two existing subprocess checks because `dist/` was absent. The final
build-first gate passes both checks. The first gate build also caught the strict optional-field
declaration when clearing the active request; the corrected declaration is included in `abe9df91`.

Validation used Node `24.22.1` and pnpm `10.4.1`. No `check:packages` run was needed because no dependency
was added. The dependant dry run selected only this package, so no dependant gate applies:

```sh
pnpm exec turbo run build typecheck test --filter=...@jeswr/reactive-authentication --dry=json
```

Per the lane brief, no whole-workspace gate or `gate:full` ran. No push, PR, branch switch, network Git
operation or edits to another checkout were performed. The working tree is clean after this final
report commit.

### Round-8 remaining work and questions

Both requested findings are fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev status` failed with exit 127 (`roborev: command not found`), so
fresh automated per-commit verdicts could not be obtained locally. Dispatcher/security review remains
outstanding; this security-critical package has not been merged.

## Fix round 9 — review `c4836d9bf425`

Completed both findings in `solid-sdk-lane-sst-8xm.28-c4836d9bf425.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `78ee24e1` | Carry the selected provider to transport initiation and check its synchronous resource guard alongside the manager boundary, after challenge cleanup and fence validation. Reuse the Bearer provider's existing resource assertion through an optional provider hook, preserving compatibility with existing providers. Add six regressions for initial and renewed tokens, revocation during cleanup with and without a manager fence, and revocation during final fence validation. |
| `dcb7126f` | Use actual RPT expiry for UMA nonce retries. Keep the cache's existing renewal margin. Exercise signed one-second, ten-second and ordinary five-minute RPTs through token-endpoint and resource nonce challenges, verifying fresh proofs, the same token and body replay. Verify a nonce retry succeeds one millisecond before expiry and rejects at and after expiry without acquiring new credentials. |
| Final documentation commit (this commit) | Record round-9 verification and the review-tool limitation. |

The implementation uses the review's actual-expiry option for nonce retries. The provider guard is
synchronous so no asynchronous gap remains between resource-policy validation and transport initiation.
No broader protocol, session-policy or dependency change was needed.

### Round-9 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **63 warnings** and **22 informational diagnostics**, unchanged from round 8.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **308/308** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2076/2076**, branches **1534/1534**, functions **467/467**,
  lines **1871/1871** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

Regression sensitivity was checked before each implementation fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/oauth-sdk-coverage.test.js --coverage.enabled=false '--testNamePattern=prevents the .* transport send'
pnpm --filter @jeswr/reactive-authentication exec vitest run test/uma.test.js --coverage.enabled=false '--testNamePattern=nonce retry \((1|10)s RPT\)|until actual expiry'
```

Expected baseline results: all **6/6** boundary regressions failed because the credentialed transport
call still ran after provider-resource revocation; all **3/3** UMA regressions failed with
`No usable verified UMA RPT context for nonce retry` while the RPT was still valid.
Every case passes in the final coverage-enforced gate. Focused verification also passed:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/oauth-sdk-coverage.test.js test/fetch-coverage.test.js --coverage.enabled=false
pnpm --filter @jeswr/reactive-authentication exec vitest run test/uma.test.js test/uma-coverage.test.js --coverage.enabled=false
```

These runs passed **27/27** boundary/fetch tests and **22/22** UMA tests. UMA regressions use the local
protocol servers and a mocked wall clock, with actual signature, key-binding and nonce verification.

Validation used Node `24.22.1` and pnpm `10.4.1`. No `check:packages` run was needed because no dependency
was added. The dependant dry run selected only this package, so no dependant gate applies:

```sh
pnpm exec turbo run build typecheck test --filter=...@jeswr/reactive-authentication --dry=json
```

Per the lane brief, no whole-workspace gate or `gate:full` ran. No push, PR, branch switch, network Git
operation or edits to another checkout were performed. The working tree is clean after this final
report commit.

### Round-9 remaining work and questions

Both requested findings are fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev status` failed with exit 127 (`roborev: command not found`), so
fresh automated per-commit verdicts could not be obtained locally. Dispatcher/security review remains
outstanding; this security-critical package has not been merged.

## Fix round 10 — review `b7274db9dc1d`

Completed the single finding in `solid-sdk-lane-sst-8xm.28-b7274db9dc1d.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `99665513` | Adapt browser-hidden authenticated redirects before answering service-worker fetches. Add four worker unit regressions and eight Chromium cases covering 303/307 POST responses in default, follow, manual and error modes. Document the response contract. |
| Final documentation commit (this commit) | Record round-10 verification and the review-tool limitation. |

The brief leaves the worker response shape open. The conservative choice is a synthetic `300`, with
`Cache-Control: no-store`, no `Location`, and a plain-text explanation that the target is hidden and
the write may have succeeded. Default and explicit `follow` fetches resolve with this observable,
non-success response. The worker never repeats the write or follows its hidden target. Explicit
`manual` preserves the opaque response; `error` retains its rejection. The core algorithm is unchanged.

### Round-10 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **63 warnings** and **22 informational diagnostics**, unchanged from round 9.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **312/312** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2079/2079**, branches **1538/1538**, functions **468/468**,
  lines **1874/1874** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

Regression sensitivity was checked before the implementation fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/worker-coverage.test.js --coverage.enabled=false '--testNamePattern=worker hidden redirects'
PLAYWRIGHT_BROWSERS_PATH=/tmp/sst-8xm28-browsers pnpm --filter @jeswr/reactive-authentication run test:browser
```

Expected baseline failures: both default/follow unit cases returned the incompatible opaque response;
all four default/follow browser cases rejected with `TypeError` after one authenticated write. The
manual/error cases already passed. Every case passes with the fix. Focused worker verification passes
**11/11** tests:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/worker-coverage.test.js --coverage.enabled=false
```

PASS final Chromium smoke suite against the freshly built output:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/sst-8xm28-browsers pnpm --filter @jeswr/reactive-authentication exec node test/browser/run.js
```

Chromium `156.0.8078.4` passes all existing checks and all **8/8** new worker redirect cases. Each
case verifies one authenticated POST with its original body and zero requests to the hidden target,
using local OpenID/storage fixtures that validate the token and DPoP proof. The installed browser was
reused; no browser or dependency download was needed.

Validation used Node `24.22.1` and pnpm `10.4.1`. No `check:packages` run was needed because no dependency
was added. The dependant dry run selected only this package, so no dependant gate applies:

```sh
pnpm exec turbo run build typecheck test --filter=...@jeswr/reactive-authentication --dry=json
```

Per the lane brief, no whole-workspace gate or `gate:full` ran. No push, PR, branch switch, network Git
operation or edits to another checkout were performed. The working tree is clean after this final
report commit.

### Round-10 remaining work and questions

The requested finding is fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev status` failed with exit 127 (`roborev: command not found`), so
fresh automated per-commit verdicts could not be obtained locally. Dispatcher/security review remains
outstanding; this security-critical package has not been merged.

## Fix round 11 — review `96df02d4a877`

Completed the single finding in `solid-sdk-lane-sst-8xm.28-96df02d4a877.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `e09a7ae5` | Track Bearer rejection records by token value until logout and check every returned token against them. Preserve eager renewal hints. Add a concurrent-401 regression through `ReactiveAuthenticationClient` with the real OAuth source, plus regressions for rejection during initial/renewal reads and rejection retention/reset across replacements/logout. |
| Final documentation commit (this commit) | Record round-11 verification and the review-tool limitation. |

A superseded token's invalidation cannot overwrite another token's rejection. The source still owns
renewal and receives the rejected token as a hint; the complete set of rejected values determines
whether a returned token is usable. Successful renewal preserves the other rejection records, and
`forget()` clears them for the next session. No public API or retry budget changed.

### Round-11 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **63 warnings** and **22 informational diagnostics**, unchanged from round 10.
- Build and typecheck: pass, including the SDK type-contract checks and existing MSAL eager-refresh test.
- Tests: **316/316** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2082/2082**, branches **1538/1538**, functions **468/468**,
  lines **1878/1878** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

The client regression was run before the implementation fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/oauth.test.js --coverage.enabled=false '--testNamePattern=concurrent 401s for successive Bearer tokens'
```

Expected baseline failure: the late request returned **401** instead of **200**, despite an available
refresh. The final coverage-enforced gate passes this case. The test holds the current token's renewal,
then delivers an older token's 401. Both requests recover within their single renewal, using the same
fresh token. Local OAuth fixtures verify two refresh grants (one initial rotation and one shared
renewal), zero refresh-token reuse, and no additional authorization flow. The three additional provider
cases cover invalidation during either token read and value-based rejection retention until logout.

Validation used Node `24.22.1` and pnpm `10.4.1`. No `check:packages` run was needed because no dependency
was added. The dependant dry run selected only this package, so no dependant gate applies:

```sh
pnpm exec turbo run build typecheck test --filter=...@jeswr/reactive-authentication --dry=json
```

Per the lane brief, no whole-workspace gate or `gate:full` ran. No push, PR, branch switch, network Git
operation or edits to another checkout were performed. The working tree is clean after this final
report commit.

### Round-11 remaining work and questions

The requested finding is fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev status` failed with exit 127 (`roborev: command not found`), so
fresh automated per-commit verdicts could not be obtained locally. Dispatcher/security review remains
outstanding; this security-critical package has not been merged.

## Fix round 12 — review `b293cd1733d4`

Completed both findings in `solid-sdk-lane-sst-8xm.28-b293cd1733d4.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `e192645b` | Retain each upgraded UMA request's issuing context and compare the rejected token within that context. Preserve verified resource context for request copies. Add a concurrent-client regression for an RPT reused across resources, plus DPoP/Bearer cases for changing contexts, copied requests and late rejection after replacement. |
| `41dbfc46` | Associate cancellation with the captured session generation. Observe durable logout before capturing the signal; ignore duplicate and older broadcasts. Keep pending older generation reads cancelled. Add delayed-broadcast regressions for login, restoration and client fetch, plus cache-ticket and memory-only peer cases. |
| Final documentation commit (this commit) | Record round-12 verification and the review-tool limitation. |

UMA invalidation no longer uses a token-only context lookup: the upgraded request retains its verified
cache key, and compare-and-remove checks the rejected token under that key. Reusing the same RPT in
another context cannot redirect a pending rejection to that other context's entry.

The fence advances its observed generation on durable reads and newer notifications, aborting the
previous generation's controller once. `signalFor(generation)` returns an already-aborted signal for
superseded operations, including a generation read that finishes late. Provider, cache, session and
client callers capture that generation's signal. A delayed logout for the generation already observed
leaves new work running; a newer logout still aborts it. Memory-only peers retain notified generations,
and local logout advances beyond the latest observed generation.

### Round-12 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **63 warnings** and **22 informational diagnostics**, unchanged from round 11.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **325/325** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2091/2091**, branches **1545/1545**, functions **469/469**,
  lines **1888/1888** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

The new UMA regressions were run against the original UMA provider before applying its fix:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/uma.test.js test/uma-coverage.test.js --coverage.enabled=false '--testNamePattern=two contexts share|retains each request'
```

Expected baseline failures: the concurrent first request returned **401** instead of **200**, and both
DPoP/Bearer provider cases reused the rejected RPT instead of renewing its original context. With the
fix, the concurrent request renews once, the other context's cached record is unchanged, and the
ID-token session is reused. Late invalidation does not delete a replacement.

The original fence also failed the new delayed-broadcast login/restoration and cache-ticket cases:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/uma.test.js test/core-coverage.test.js test/session-coverage.test.js --coverage.enabled=false '--testNamePattern=two contexts share|follow observed generations|survives a delayed logout'
```

Login and restoration rejected with `SessionSupersededError`; observing the durable generation did
not cancel the older cache ticket. Additional checks verified that a pending old generation read
stays cancelled when either a broadcast or another durable read observes logout. These checks caught
the need to pair signals with the exact captured generation rather than merely reading the current
controller after an await. All cases pass in the final coverage-enforced gate.

Validation used Node `24.22.1` and pnpm `10.4.1`. No `check:packages` run was needed because no dependency
was added. The dependant dry run selected only this package, so no dependant gate applies:

```sh
pnpm exec turbo run build typecheck test --filter=...@jeswr/reactive-authentication --dry=json
```

Per the lane brief, no whole-workspace gate or `gate:full` ran. No push, PR, branch switch, network Git
operation or edits to another checkout were performed. The working tree is clean after this final
report commit.

### Round-12 remaining work and questions

Both requested findings are fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev status` failed with exit 127 (`roborev: command not found`), so
fresh automated per-commit verdicts could not be obtained locally. Dispatcher/security review remains
outstanding; this security-critical package has not been merged.

## Fix round 13 — review `8fc647239d6d`

Completed both findings in `solid-sdk-lane-sst-8xm.28-8fc647239d6d.md`.
Only `packages/reactive-authentication` and this report changed. No dependencies were added.

| Commit | Change |
| --- | --- |
| `9d775c08` | Carry the provider-issued request in the reactive retry's optional `ChallengeContext.request` field. Select the nonce retry's RPT through that request's recorded context. Add a same-URL concurrent-context regression and adjust direct-provider nonce tests to retain the issuing request. |
| `c47e1d24` | Bind UMA and client-credentials requests to their cache ticket's AbortSignal before issuer lookup, retaining the signal through UMA context resolution. Add real issuer-picker/Web Lock regressions for both providers and an abortable UMA context-resolution regression. |
| Final documentation commit (this commit) | Record round-13 verification and the review-tool limitation. |

Concurrent operations at one URL no longer select each other's RPTs for nonce retries. The reactive
client retains the exact issued request even though transport and body replay use request copies.
Direct provider callers may supply that issued request as the upgrade input or in the challenge's
`request` field. Conservative handling: nonce-only retries without an exact recorded issuing request,
including unbound copies, fail closed rather than selecting credentials from mutable URL-wide state.
Expiry checks, invalidation, logout fencing and retry budgets remain covered.

Calling either provider's `forget()` now closes a pending issuer picker, rejects its upgrade with
`SessionSupersededError`, and releases the picker's Web Lock for the next generation. Caller aborts
also propagate. UMA storage-context resolution receives the same logout-bound request and cancels
before login or exchange; the next generation can authenticate successfully.

### Round-13 verification

PASS required package gate and root checks, run before the final documentation commit:

```sh
pnpm --filter @jeswr/reactive-authentication run lint && pnpm --filter @jeswr/reactive-authentication run build && pnpm --filter @jeswr/reactive-authentication run typecheck && pnpm --filter @jeswr/reactive-authentication run test
pnpm run lint:root
git diff --check
```

- Package lint: zero errors; **63 warnings** and **22 informational diagnostics**, unchanged from round 12.
- Build and typecheck: pass, including the SDK type-contract checks.
- Tests: **329/329** pass in **29/29** files, with no skips.
- Enforced coverage: statements **2095/2095**, branches **1549/1549**, functions **469/469**,
  lines **1892/1892** — **100% in every metric**. Coverage configuration and thresholds are unchanged.
- Root lint: Biome, lockfile transport, app workspace and raw-fetch guards pass.
- Whitespace validation: pass.

Each new regression failed against its corresponding original implementation:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/uma.test.js --coverage.enabled=false '--testNamePattern=concurrent UMA nonce retries'
pnpm --filter @jeswr/reactive-authentication exec vitest run test/browser-elements.test.js --coverage.enabled=false '--testNamePattern=logout cancels issuer lookup'
pnpm --filter @jeswr/reactive-authentication exec vitest run test/uma.test.js --coverage.enabled=false '--testNamePattern=logout cancels pending storage-context'
```

Expected baseline failures: the first concurrent operation retried with the second context's RPT;
both providers left the issuer picker open after logout; and UMA context discovery's signal remained
unaborted. The fixed concurrent test verifies distinct RPTs, fresh signed DPoP proofs with the correct
nonce, unchanged request bodies, one nonce retry per operation, and no extra exchanges or logins.
The picker tests use the actual `IdpPicker` and native Web Locks through the existing DOM event seam;
they verify the next upgrade can open its picker and that cancellation performs no discovery, login,
context lookup or grant. All **51/51** focused cases pass:

```sh
pnpm --filter @jeswr/reactive-authentication exec vitest run test/uma.test.js test/uma-coverage.test.js test/browser-elements.test.js --coverage.enabled=false
```

Validation used Node `24.22.1` and pnpm `10.4.1`. No `check:packages` run was needed because no dependency
was added. The dependant dry run selected only this package, so no dependant gate applies:

```sh
pnpm exec turbo run build typecheck test --filter=...@jeswr/reactive-authentication --dry=json
```

Per the lane brief, no whole-workspace gate or `gate:full` ran. No push, PR, branch switch, network Git
operation or edits to another checkout were performed. The working tree is clean after this final
report commit.

### Round-13 remaining work and questions

Both requested findings are fixed and tested. No implementation work is unfinished or blocked;
there are no open questions. `roborev status` failed with exit 127 (`roborev: command not found`), so
fresh automated per-commit verdicts could not be obtained locally. Dispatcher/security review remains
outstanding; this security-critical package has not been merged.
