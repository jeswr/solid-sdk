<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.15 lane report

## Fix round 4

The callback-persistence finding against `011d99c676a0` is addressed.
The package gate and affected workspace gate pass. The full workspace gate
still fails in the same unchanged root guard tests recorded in fix round 3.

| Commit | Change |
| --- | --- |
| `ca4b0f8b` — `fix: require persisted session refresh updates` | Guard both documented JWT callbacks with `trigger: "update"`; require a browser session-update POST that persists the returned cookie. Document shared server-side token storage for refresh during read-only calls. Add eight regressions using the actual documented callbacks and Auth.js session HTTP/JWT handling. |
| This report commit — `docs: record callback persistence fix` | Record validation, security evidence, and remaining verification blockers. |

### Security property and regression evidence

Read-only session calls, including zero-argument `auth()` in React Server
Components, must not redeem a single-use refresh token whose replacement
would be lost with a discarded cookie. The conservative example flow now
refreshes only on explicit browser `useSession().update({})` requests.
Passing `{}` selects a CSRF-protected POST and `trigger: "update"`;
plain `update()` and `getSession()` use GET and skip refresh. The browser
must apply the response cookie before starting the next server-side pod
request. Client update payloads are ignored. Applications needing refresh
inside read-only calls must atomically read, refresh, and persist the entire
current Solid state in shared server-side storage on every call.

The eight new cases execute both documentation examples with real
`@auth/core` CSRF validation, encrypted JWT encoding/decoding, and session
responses over in-memory requests. They prove that sequential read-only
calls with expired or unknown expiry do no token HTTP and leave the stored
JWT state unchanged. Sequential update POSTs persist rotated credentials
before the next request, including with omitted or zero lifetimes. A mock
endpoint rejects reuse of a spent refresh token with `invalid_grant`.
Tests also check that the persisted key survives and browser-visible
session JSON excludes Solid token state. All issuer HTTP remains mocked.

Before the documentation fix, all eight new regressions failed. After the
fix, all **151 refresh tests** and **232 package tests in 4 files** pass.
Production source, exported APIs, manifests, and lockfile are unchanged.
No dependencies were added; dependency-policy checks and installation are
not applicable. No API report update is needed for this documentation fix.

### Fix-round validation

Commands used `PATH=/opt/node24/bin:$PATH` (Node **v24.22.1**, pnpm **10.4.1**).

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/auth-solid^...'` | PASS: both workspace dependencies built. |
| `pnpm --filter @jeswr/auth-solid exec vitest run test/refresh.test.ts -t 'sequential read-only\|persists rotated credentials'` | Expected FAIL before the fix: **8 failed / 143 skipped**. |
| `pnpm --filter @jeswr/auth-solid exec vitest run test/refresh.test.ts` | PASS after the fix: **151 passed**. |
| `pnpm --filter @jeswr/auth-solid run lint && pnpm --filter @jeswr/auth-solid run build && pnpm --filter @jeswr/auth-solid run typecheck && pnpm --filter @jeswr/auth-solid run test` | PASS: lint/build/strict typecheck; **232 tests passed**. |
| `TURBO_SCM_BASE=011d99c676a06f9163af801d469e2310b606a234 pnpm run gate` | PASS, including `lint:root`: **7/7 tasks** succeeded. |
| `pnpm run gate:full` | FAIL (exit 1): `//#test:root`; **161 failed / 739 passed** root tests across 4 failing files. Turbo stopped with **47 successful / 211 total tasks**. |
| `roborev status` | Unavailable: exit 127, `roborev: command not found`. |
| `git diff --check` | PASS. |

The failing root files are `test/agent-layers.test.mjs`,
`test/agent-layers-reachability.test.mjs`, `test/check-packages-guard.test.mjs`,
and `test/check-sdk-layers.test.mjs`. Their empty child-process output
assertions match the previously recorded failures.
`git diff --quiet 011d99c676a06f9163af801d469e2310b606a234 -- test scripts guardrails vitest.config.ts package.json pnpm-lock.yaml`
passed, confirming those sources and configuration are unchanged this round.

Logs: `/tmp/sst-8xm.15-fix4-{deps-build,regressions-red,regressions-green,package-gate,affected-gate,full-gate}.log`.

### Remaining work and open questions

- The requested finding is fixed. Full-workspace verification remains
  blocked by existing root-test failures; automated roborev is unavailable.
  Jesse retains the security review and merge decision.
- No open questions. The conservative choice is explicit browser session
  updates for JWT refresh, with no token consumption during read-only calls.
- No push, PR, branch switch, remote fetch/merge, publishing, or edits to
  another checkout were performed.

---

## Fix round 3

The nonce-persistence finding against `1df6f8958bfc` is addressed. The
package gate and affected workspace gate pass. The full workspace gate
still fails in the same unchanged root guard tests recorded in fix round 2.

| Commit | Change |
| --- | --- |
| `56f0f41d` — `fix: preserve authorization-server refresh nonces` | Persist `authorizationServerNonce` in returned JWT state, seed the next refresh proof from it, and capture the latest nonce on both challenge and successful responses. Preserve and extend the regression tests present at lane start; document persistence. |
| This report commit — `docs: record nonce persistence fix` | Record fix-round validation and remaining verification blockers. |

### Security properties and regression evidence

The nonce remains scoped to its persisted session and authorization server;
there is no process-wide cache shared by sessions with the same issuer/key.
JSON-round-tripped sessions reuse the latest nonce on the next token proof.
Missing or empty response headers conservatively retain the previous nonce,
as expected by [RFC 9449 §8.2](https://www.rfc-editor.org/rfc/rfc9449.html#section-8.2).
A challenge replaces a stale nonce for the single allowed retry. The nonce
from the successful retry takes precedence when present; otherwise the
challenge nonce is retained. Successful and failed refreshes leave their
input state unchanged. Invalid persisted nonce values fail before HTTP.

Tests cover all of those cases, fresh proof identifiers and omitted `ath`,
isolation between sessions, and exclusion of the authorization-server nonce
from discovery, extracted pod state, and pod proofs even when the full JWT
state is passed directly. Existing retry, key-binding, transport, credential
replay, and sanitized-error tests continue passing. All HTTP remains mocked.

Before the code fix, the regression tests present at lane start produced
**3 failures / 131 passes**. The completed package suite has **224 tests in
4 files**, including **143 refresh tests** (13 more package tests than fix
round 2). No new dependency or API report update is needed; this package
has no API report configuration.

### Fix-round validation

Commands used `PATH=/opt/node24/bin:$PATH` (Node **v24.22.1**, pnpm **10.4.1**).

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/auth-solid^...'` | PASS: both workspace dependencies built. |
| `pnpm --filter @jeswr/auth-solid exec vitest run test/refresh.test.ts` | Expected FAIL before the fix: **3 failed / 131 passed**. PASS after the fix and additional tests: **143 passed**. |
| `pnpm --filter @jeswr/auth-solid run lint && pnpm --filter @jeswr/auth-solid run build && pnpm --filter @jeswr/auth-solid run typecheck && pnpm --filter @jeswr/auth-solid run test` | PASS: lint/build/strict typecheck; **224 tests passed**. |
| `TURBO_SCM_BASE=1df6f8958bfc63db03b99e4324c91960d503fafb pnpm run gate` | PASS, including `lint:root`: **7/7 tasks** succeeded. |
| `pnpm run gate:full` | FAIL (exit 1): `//#test:root`; **161 failed / 739 passed** root tests across 4 failing files. Turbo stopped with **59 successful / 227 total tasks**. |
| `roborev status` | Unavailable: exit 127, `roborev: command not found`. |
| `git diff --check` | PASS. |

The failing root files are `test/agent-layers.test.mjs`,
`test/agent-layers-reachability.test.mjs`, `test/check-packages-guard.test.mjs`,
and `test/check-sdk-layers.test.mjs`. Their empty child-process output
assertions match the previously recorded failures.
`git diff --quiet 1df6f8958bfc63db03b99e4324c91960d503fafb -- test scripts guardrails vitest.config.ts package.json pnpm-lock.yaml`
passed, confirming those sources and configuration are unchanged this round.

Logs: `/tmp/sst-8xm.15-fix3-{deps-build,regressions-red,regressions-green,package-gate,affected-gate,full-gate}.log`.

### Remaining work and open questions

- The requested nonce fix is complete. Full-workspace verification remains
  blocked by existing root-test failures; automated roborev is unavailable.
  Jesse retains the security review and merge decision.
- No dependencies were added; policy checks and installation are not
  applicable. No open questions.
- No push, PR, branch switch, remote fetch/merge, publishing, or edits to
  another checkout were performed.

---

## Fix round 2

The unknown-expiry callback finding against `381977109fec` is addressed.
The package gate, root lint, and affected workspace gate pass. The full
workspace gate still fails in unchanged root guard tests.

| Commit | Change |
| --- | --- |
| `91ccb542` — `fix: refresh callbacks when expiry is unknown` | Refresh both documented JWT callbacks when expiry is unknown or within 60 seconds. Add 14 tests executing the README and package-skill examples with the real helper over mocked HTTP. |
| This report commit — `docs: record unknown-expiry callback fix` | Record fix-round validation and remaining verification blockers. |

### Behavior and regression evidence

The conservative policy is to refresh on each callback invocation while the
stored expiry is unknown. Both examples document this explicitly. The helper
continues clearing stale expiry; no default lifetime is inferred.

The tests execute the actual documented code, supplying a mock Auth.js setup
and token endpoint. They cover repeated omitted lifetimes, reuse of a rotated
refresh token on the next callback, initially unknown expiry, the inclusive
60-second margin, expired/zero expiry, future expiry, and absent Solid state.
Before the documentation fix, four new regressions failed (two per example)
with **126 passing tests**. The passing package suite now has **211 tests in
4 files**, including **130 refresh tests**. All HTTP remains mocked.

### Fix-round validation

Commands used `PATH=/opt/node24/bin:$PATH` (Node **v24.22.1**, pnpm **10.4.1**).

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/auth-solid^...'` | PASS: both workspace dependencies built. |
| `pnpm --filter @jeswr/auth-solid run lint && pnpm --filter @jeswr/auth-solid run build && pnpm --filter @jeswr/auth-solid run typecheck && pnpm --filter @jeswr/auth-solid run test` | PASS: lint/build/strict typecheck; **211 tests passed**. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=381977109fecb2a50ea01895d2f1e27cd6a112ba pnpm run gate` | PASS: **7/7 tasks** succeeded. |
| `pnpm run gate:full` | FAIL (exit 1): `//#test:root`; **161 failed / 739 passed** root tests across 4 failing files. Turbo stopped with **49 successful / 213 total tasks**. |
| `roborev status` | Unavailable: exit 127, `roborev: command not found`. |
| `git diff --check` | PASS. |

The failing root files are `test/agent-layers.test.mjs`,
`test/agent-layers-reachability.test.mjs`, `test/check-packages-guard.test.mjs`,
and `test/check-sdk-layers.test.mjs`. Their empty child-process output failures
match the pattern recorded in fix round 1.
`git diff --quiet 381977109fecb2a50ea01895d2f1e27cd6a112ba -- test scripts guardrails vitest.config.ts package.json pnpm-lock.yaml`
passed, confirming these sources and configuration are unchanged in this round.

Logs: `/tmp/sst-8xm.15-fix2-{deps-build,regressions-red,package-tests,lint-root,affected-gate,full-gate}.log`.

### Remaining work and open questions

- The requested callback fix is complete. Full-workspace verification remains
  blocked by existing root-test failures, and automated roborev is unavailable.
  Jesse retains the security review and merge decision.
- No dependencies were added; dependency-policy checks and installation are
  not applicable. No open questions.
- No push, PR, branch switch, remote fetch/merge, publishing, or edits to
  another checkout were performed.

---

## Fix round 1 (historical)

Both review findings against `ee16a1332ccdbb2c5538ca50330f4f73d0213d93`
are addressed on `lane/sst-8xm.15`. The package gate, root lint, and affected
workspace gate pass. The full workspace gate still fails in unchanged root
guard tests. The original implementation report below is historical.

| Commit | Change |
| --- | --- |
| `a6258fad` — `fix: validate refresh lifetime and issuer` | Accept omitted `expires_in`, remove stale expiry, and preserve rotated refresh credentials. Compare discovered issuer identifiers exactly before token HTTP. Add regression tests and update package documentation. |
| This report commit — `docs: record refresh review fixes` | Record fix-round validation and remaining verification blockers. |

### Security properties and regression evidence

- **Unknown lifetime:** omission of `expires_in` succeeds with or without
  refresh-token rotation and with or without a previous expiry. The returned
  object has no `expiresAt` property; the input and persisted key are preserved.
  Supplied invalid lifetimes remain rejected; zero and valid lifetimes retain
  their existing behavior. Clearing unknown expiry is the conservative option;
  no lifetime is inferred or configured.
- **Issuer identity:** discovery must match the original persisted issuer string.
  Eight normalization-equivalent mismatches (root trailing slash, hostname case,
  default port, and dot segments, each in both directions) fail before token HTTP.
  Five exact-identifier cases succeed while discovery URLs are constructed
  separately. Existing secure-transport guards remain covered.
- Before the implementation change, the new regressions produced the expected
  **12 failures / 104 passes**: four omitted-lifetime failures and eight accepted
  issuer mismatches. The passing package suite now has **197 tests in 4 files**,
  including **116 refresh tests**. Tests use only mocked HTTP and ephemeral keys.

### Fix-round validation

Commands used `PATH=/opt/node24/bin:$PATH` (Node **v24.22.1**, pnpm **10.4.1**).

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/auth-solid^...'` | PASS: both workspace dependencies built. |
| `pnpm --filter @jeswr/auth-solid run lint && pnpm --filter @jeswr/auth-solid run build && pnpm --filter @jeswr/auth-solid run typecheck && pnpm --filter @jeswr/auth-solid run test` | PASS: lint/build/strict typecheck; **197 tests passed**. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=ee16a1332ccdbb2c5538ca50330f4f73d0213d93 pnpm run gate` | PASS: **7/7 tasks** succeeded, including all auth-solid tasks. |
| `pnpm run gate:full` | FAIL (exit 1): `//#test:root`; **161 failed / 739 passed** root tests across 4 failing files. Turbo stopped with **60 successful / 228 total tasks**. |
| `roborev status` | Unavailable: exit 127, `roborev: command not found`. |
| `git diff --check` | PASS. |

The full-gate failures are empty child-process output assertions in unchanged
`test/agent-layers.test.mjs`, `test/agent-layers-reachability.test.mjs`,
`test/check-packages-guard.test.mjs`, and `test/check-sdk-layers.test.mjs`.
This matches the failure class recorded before this fix round.
`git diff --quiet ee16a1332ccdbb2c5538ca50330f4f73d0213d93 -- test scripts guardrails vitest.config.ts package.json pnpm-lock.yaml`
passed. No unrelated guard changes or additional diagnostic test runs were made.

Logs: `/tmp/sst-8xm.15-fix1-{deps-build,regressions-red,package-tests,lint-root,affected-gate,full-gate}.log`.

### Remaining work and open questions

- Both requested code fixes are complete. Full-workspace verification remains
  blocked by the root test failures; automated roborev review is unavailable.
  Jesse's security review and merge decision remain required.
- No dependencies were added; manifests and lockfile are unchanged.
  Dependency-policy checks and installation are not applicable.
- No open questions. No push, PR, branch switch, remote fetch/merge, publishing,
  or edits to another checkout were performed.

---

# Original implementation report (historical)

Implementation is complete on `lane/sst-8xm.15`, based on
`0d8842080a31b716b2d1350efed53b19eb8c6832`. The auth-solid package gate and root
lint pass. Both workspace gates fail in unchanged root guard tests. Jesse must
review and merge this security-critical change; it must never be auto-merged.

## Commits

| Commit | Change |
| --- | --- |
| `de694af5` — `fix: require explicit DPoP nonce challenges` | Require a 4xx `use_dpop_nonce` error before the shared token seam retries. Add a regression proving `invalid_grant` plus a nonce header does not replay a grant. |
| `36f91f15` — `feat: refresh persisted Solid sessions` | Export `refreshSolidSession`, its options, and `SolidSessionRefreshError` with bounded machine-readable codes. Add discovery, persisted-key refresh, validation, rotation handling, 100 mock tests, and conservative readings in `QUESTIONS.md`. |
| `54459e49` — `docs: show Auth.js session refresh callbacks` | Add README and package-skill JWT callback examples with a 60-second expiry margin and explicit pristine fetch. Document client auth, error handling, persistence, and concurrent rotation responsibilities. |
| This final report commit — `docs: record sst-8xm.15 lane status` | Record validation, security evidence, and remaining verification blockers. |

## Security properties and evidence

| Property changed or preserved | Test evidence |
| --- | --- |
| Persisted refresh credentials are redeemed with their original ES256 DPoP key, without `ath`. | JSON-round-tripped state produces a proof verified with the original public key. The proof JWK thumbprint equals the persisted key's thumbprint; `ath` and private `d` are absent. Missing, public-only, malformed, and symmetric keys fail before HTTP. |
| Refresh credentials cannot be replayed merely because an error carries a nonce header. A genuine nonce challenge permits one retry. | Tests cover 400/401 challenges, a fresh `jti` with the same key/body/client auth, a second nonce failure, missing nonce, a 5xx challenge, and `invalid_grant` with a nonce header. Restoring the previous header-only behavior makes the regression fail with two requests instead of one. |
| Refresh HTTP uses the explicit pristine fetch, validates discovery issuer equality and secure endpoints, and refuses token redirects. | A throwing patched global is never called. Mock tests reject mismatched/malformed discovery, insecure remote HTTP even with development opt-in, URL credentials/fragments, and token redirects 301/302/303/307/308. Loopback HTTP succeeds only with explicit opt-in. Discovery carries no proof or authorization header. |
| Session updates fail closed and preserve verified identity. | Rotation and omitted-rotation tests verify a new object with updated access/refresh/expiry fields, unchanged input, identity, ID token, and key. Malformed JSON, wrong token types, missing/empty/non-string credentials, invalid lifetimes, and overflowing expiry fail. Zero lifetime expires immediately; response latency does not extend expiry. Refresh ID tokens are not adopted without verification. |
| Errors and logs do not disclose credentials or arbitrary server text. | Known OAuth errors have typed codes; arbitrary server errors become `oauth_error`. Tests inject secret fixture values into server descriptions and upstream exceptions and verify sanitized failures without raw causes or console logging. Public clients send no Authorization header; confidential-client Basic credentials are form-encoded correctly. |

All new tests use injected mock endpoints and ephemeral fixture keys. No live
accounts, production token endpoints, or real credentials are used.

## Validation

Commands ran with `PATH=/opt/node24/bin:$PATH` (Node **v24.22.1**, pnpm **10.4.1**).
Dependency lifecycle scripts remain disabled by the existing `.npmrc`.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/auth-solid^...'` | PASS: both workspace dependencies built before package checks. |
| `pnpm --filter @jeswr/auth-solid run lint && pnpm --filter @jeswr/auth-solid run build && pnpm --filter @jeswr/auth-solid run typecheck && pnpm --filter @jeswr/auth-solid run test` | PASS: lint/build/strict typecheck; **181 tests in 4 files passed**. The affected gate independently passed these package tasks. |
| `pnpm run lint:root` | PASS: formatting and all workspace guards. |
| `TURBO_SCM_BASE=0d8842080a31b716b2d1350efed53b19eb8c6832 pnpm run gate` | FAIL (exit 1): `//#test:root`; **166 failed / 734 passed** root tests, 4 failing files. **7/8 tasks succeeded**, including every auth-solid task. |
| `pnpm run gate:full` | FAIL (exit 1): `//#test:root`; **169 failed / 731 passed** root tests, 5 failing files. Turbo stopped with **76 successful / 254 total tasks**. |
| `pnpm exec vitest run test/check-sdk-layers.test.mjs -t 'scans valid manifests without' --maxWorkers=1` | FAIL independently outside Turbo: expected child-process success output is empty; **1 failed / 299 skipped**. This selected fixture does not import auth-solid. |
| `pnpm --filter @jeswr/auth-solid exec vitest run test/refresh.test.ts -t 'does not replay invalid_grant'` with the old header-only predicate temporarily restored | Expected FAIL: two token calls instead of one. Original source restored before the passing package gate. |
| `roborev status` | Unavailable: exit 127, `roborev: command not found`. No automated review verdict can be claimed. |

A Node ESM import of `packages/auth-solid/dist/index.js` also confirmed the built
root exports `refreshSolidSession` and `SolidSessionRefreshError` with its `code`.
Built artifacts remain ignored and uncommitted. This package has no API report
configuration or report file to update.

Workspace failures occur in the following unchanged files:

- `test/check-sdk-layers.test.mjs`: child-process stdout/stderr unexpectedly empty.
- `test/check-packages-guard.test.mjs`: child-process diagnostic output unexpectedly empty.
- `test/agent-layers-reachability.test.mjs`: child-process diagnostic output unexpectedly empty.
- `test/agent-layers.test.mjs`: empty child-process diagnostic output and 5-second timeouts.
- `test/check-vercel-config.test.mjs`: additional 5-second timeouts in the full gate.

`git diff --quiet 0d8842080a31b716b2d1350efed53b19eb8c6832 -- test scripts guardrails vitest.config.ts`
passed, confirming these guard sources/configuration are unchanged from the base.
The isolated failure rules out a failure caused solely by concurrent Turbo work;
the underlying root-test output failure is not resolved by this lane.

Logs are in `/tmp/sst-8xm.15-{lint-root,affected-gate,full-gate,root-diagnostic}.log`,
`/tmp/sst-8xm.15-package-tests.log`, and
`/tmp/sst-8xm.15-nonce-regression-red.log`.

## Dependencies, open questions, and remaining work

- **Dependency policy:** no dependencies added; manifests and lockfile are unchanged.
  `pnpm run check:packages <name>` and `pnpm install` are not applicable.
- **Conservative readings:** `QUESTIONS.md` records the options and selected
  interpretation: required pristine fetch; the provider's public/Basic client
  authentication; explicit nonce errors; safe integer expiry in epoch seconds.
  No unresolved specification question blocks implementation.
- **Verification blockers:** the full workspace gate is not green, and roborev
  is unavailable. Independent security review and Jesse's merge decision remain
  required. No unrelated guard/test changes were made.
- **Lane scope:** no push, PR, remote fetch/merge, publish, branch switch, or
  edits to another checkout were performed. This report is committed last.
