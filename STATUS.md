<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.15 lane report

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
