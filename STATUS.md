<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-8xm.1 — Issues local-CSS e2e coverage

Branch: `lane/sst-8xm.1`. Base: `93afe9d606533fc0b36ab314423d2f0b73e528e6`.

## Commits

- `4bb2dbe9` — `test: seed local inbox accounts`: seed fresh Alice/Bob accounts and private inboxes in global setup, preserve profiles through typed RDF updates, grant the peer Append access, and reject non-local CSS origins. Credentials stay in process memory.
- `8f8b7734` — `test: cover live board and LDN inbox`: add the board and inbox specs, and conditionally replace any server-seeded inbox ACL. The board test observes the real WebSocketChannel2023 subscription and a change frame while a second context changes status, then checks the card moves without navigation. Inbox tests POST a typed, Writer-serialized Announce and check UI assignment delivery to Bob.
- Final documentation commit — `docs: record issues lane validation`: this report.

The original implementation through `dce0ad9a` changed no production application code,
manifests, dependencies, lockfiles, or server configuration. Fix round 1 below adds the
production subscription fixes requested by review.

## Validation

All pnpm commands below ran with `PATH=/opt/node24/bin:$PATH` (Node `v24.22.1`, pnpm `10.4.1`). Dependency lifecycle scripts remained disabled.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/app-issues^...' --concurrency=4` | PASS: 7 dependency builds. The initial direct typecheck lacked workspace `dist` declarations; this bootstrap resolved those errors. |
| `pnpm --filter @jeswr/app-issues run lint` | PASS. |
| `pnpm --filter @jeswr/app-issues exec eslint e2e` | PASS after the final code change. |
| `pnpm --filter @jeswr/app-issues run build` | FAIL: existing Next.js Google Fonts fetches were unavailable; exact errors below. |
| `pnpm --filter @jeswr/app-issues run typecheck` | PASS, including both specs and global setup, after the final code change. |
| `pnpm --filter @jeswr/app-issues run test` | PASS: 47 files, 710 tests. |
| `pnpm run lint:root` | PASS, including workspace/layer guards and all 74 contrast pairs. |
| `TURBO_SCM_BASE=93afe9d606533fc0b36ab314423d2f0b73e528e6 pnpm run gate` | FAIL at `@jeswr/app-issues#build`: same Google Fonts errors; 8 successful tasks of 10. |
| `pnpm run gate:full` | FAIL at `//#test:root`: 72 successful tasks of 258; root tests had 178 failures and 722 passes across 5 failed and 7 passed files. Other tasks were interrupted. |
| `pnpm --filter @jeswr/app-issues exec playwright test --list` | PASS: 28 tests in 7 files, including all 3 new tests. |
| `pnpm --filter @jeswr/app-issues test:e2e` | FAIL on both attempts, including the final code state, during configured webServer startup before global setup or browser tests; exact output below. |
| `git diff --check 93afe9d606533fc0b36ab314423d2f0b73e528e6 HEAD` | PASS for both implementation commits. |

A direct Node smoke check also loaded global setup and confirmed a remote `IT_CSS_BASE` is rejected before any request.

## Exact startup/build failures

The requested e2e command reported:

```text
Error: Process from config.webServer was not able to start. Exit code: 1

 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @jeswr/app-issues@0.1.0 test:e2e: `bash scripts/test-e2e.sh`
Exit status 1
```

The output did not identify a deeper startup cause. No alternate server, browser flags, mocks, or production server were substituted.

The Issues build and affected gate reported:

```text
Error: Turbopack build failed with 2 errors:
[next]/internal/font/google/geist_a71539c9.module.css
next/font: error:
Failed to fetch `Geist` from Google Fonts.

[next]/internal/font/google/geist_mono_8d43a2aa.module.css
next/font: error:
Failed to fetch `Geist Mono` from Google Fonts.
```

The failed requests targeted the existing `fonts.googleapis.com` font declarations. The build also emitted an existing guarded-fetch dynamic DNS import warning; the two fatal errors were the font fetches.

The full gate's failed root files were `test/agent-layers-reachability.test.mjs`, `test/agent-layers.test.mjs`, `test/check-packages-guard.test.mjs`, `test/check-sdk-layers.test.mjs`, and `test/vercel-ignore-build.test.mjs`. Diagnostics included empty-output assertions (for example, `AssertionError: expected '' to contain '6 manifests scanned'`) and `Error: Test timed out in 5000ms.` These files are outside this lane's changes; no root-test fixes were attempted.

## Dependencies, remaining verification, and questions

- No dependencies added; `check:packages` was not needed or run. No manifest or lockfile changes; lifecycle scripts remained disabled.
- Local browser behavior remains unverified because the configured webServer could not start. The full and affected gates are not green; focused Issues lint, typecheck, and unit tests are green.
- Per-commit roborev review could not run: `roborev status` returned `/bin/bash: line 1: roborev: command not found` (exit 127). No reviewer tooling was installed.
- Open questions: none. The specs use only the harness's local `http://localhost:<port>` CSS. Inbox refresh uses the existing Refresh button; the board test requires the socket event and forbids navigation.

## Fix round 1 — sst-8xm.1

Review baseline: `dce0ad9a7013da8e0f3c3109995ddbafdc456896`.

- `768fc815` — `fix: watch issue edits through CSS subscriptions`: accept discovered
  HTTP(S) notification services on the user's storage origins, including CSS's service
  outside the pod path. Topic and inbox URLs retain the own-storage path restriction;
  foreign services and sockets still fail closed. Subscribe to each loaded issue as
  well as the container, refresh the subscription set on membership changes, and close
  all watchers and queued refreshes on teardown. The e2e test matches the edited issue's
  subscription and socket, then requires its `Update` frame. Add 15 regression tests.
- Final documentation commit — `docs: record subscription fix validation`: this report.

The implementation follows the server-level discovery and separate resource/container
notification behavior in the [CSS 7 notification documentation](https://communitysolidserver.github.io/CommunitySolidServer/7.x/usage/notifications/).
It continues to discover the service URL rather than assuming a CSS path. No dependencies,
manifests, lockfiles, or server configuration changed; `check:packages` was not needed.

All commands used `PATH=/opt/node24/bin:$PATH` (Node `v24.22.1`, pnpm `10.4.1`), with
dependency lifecycle scripts disabled.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/app-issues^...' --concurrency=4` | PASS: 7 dependency builds. |
| `pnpm --filter @jeswr/app-issues exec vitest run src/lib/notifications.test.ts src/lib/own-pod.test.ts src/lib/use-issues.test.tsx` | PASS: 40 tests. Before the resource fix, both new resource-subscription regressions failed. |
| `pnpm --filter @jeswr/app-issues run lint` | PASS; one existing `react-hooks/exhaustive-deps` warning in `src/components/issues-view.tsx:881`. |
| `pnpm --filter @jeswr/app-issues exec eslint e2e` | PASS. |
| `pnpm --filter @jeswr/app-issues run build` | FAIL: existing Google Fonts fetch failures for Geist and Geist Mono, exactly as recorded above. |
| `pnpm --filter @jeswr/app-issues run typecheck` | PASS, including the new hook tests and changed e2e spec; also rerun after the build attempt. |
| `pnpm --filter @jeswr/app-issues run test` | PASS: 48 files, 725 tests. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=dce0ad9a7013da8e0f3c3109995ddbafdc456896 pnpm run gate` | FAIL at `@jeswr/app-issues#build`: the same two Google Fonts fetch errors; 8 successful tasks of 10. |
| `pnpm run gate:full` | FAIL at `//#test:root`: 49 successful tasks of 214. Root tests: 4 files failed, 8 passed; 161 tests failed, 739 passed. Other tasks were interrupted. |
| `pnpm --filter @jeswr/app-issues exec playwright test --list` | PASS: 28 tests in 7 files. |
| `pnpm --filter @jeswr/app-issues test:e2e` | FAIL before browser tests: configured local webServer could not start; exact error below. |
| `git diff --check dce0ad9a7013da8e0f3c3109995ddbafdc456896 HEAD` | PASS. |

The local-CSS e2e attempt reported:

```text
Error: Process from config.webServer was not able to start. Exit code: 1

ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @jeswr/app-issues@0.1.0 test:e2e: `bash scripts/test-e2e.sh`
Exit status 1
```

The full gate's failing root files were `test/agent-layers-reachability.test.mjs`,
`test/agent-layers.test.mjs`, `test/check-packages-guard.test.mjs`, and
`test/check-sdk-layers.test.mjs`. Failures again included empty CLI-output assertions,
such as `AssertionError: expected '' to contain '6 manifests scanned'`. These root
tests are outside the review fixes and were left unchanged.

No alternate server or browser setup was used. Browser behavior remains unverified;
the package build, affected gate, and full gate remain non-green for the failures above.
`roborev status` again returned `/bin/bash: line 1: roborev: command not found`
(exit 127), so automated per-commit review remains unavailable. Open questions: none.

## Fix round 2 — sst-8xm.1

Review baseline: `7015b66f44dcf2e6d1886a40294d611b99a5badf`.

- `23dafedf` — `fix: preserve queued issue refreshes`: retain the shared debounce
  timer across membership changes and reconcile subscriptions by topic, closing
  removed topics and opening added topics while keeping unchanged topics connected.
  Tracker, identity, and storage-scope changes, and unmount, still close all watchers
  and cancel queued invalidations. Add five tests and strengthen the membership test.
- Final documentation commit — `docs: record queued refresh fix validation`: this report.

Before the fix, the two deferred-fetch race cases (container and resource invalidations)
lost their queued read, and the subscription-retention assertion failed. After the fix,
all eight hook tests pass. The race cases resolve the first membership read while a
second invalidation is queued, then require the next read to reveal the third issue
without another notification or a manual refresh.

Commands used `PATH=/opt/node24/bin:$PATH` (Node `v24.22.1`, pnpm `10.4.1`), with
dependency lifecycle scripts disabled.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/app-issues^...' --concurrency=4` | PASS: 7 dependency builds. The first hook-test attempt lacked workspace `dist`; this bootstrap resolved it. |
| `pnpm --filter @jeswr/app-issues exec vitest run src/lib/use-issues.test.tsx` | PASS: 8 tests, including the two reproduced races and tracker/identity/storage cleanup cases. |
| `pnpm --filter @jeswr/app-issues run lint` | PASS; the existing `react-hooks/exhaustive-deps` warning at `src/components/issues-view.tsx:881` remains. |
| `pnpm --filter @jeswr/app-issues run build` | FAIL: existing Google Fonts connection failures for Geist and Geist Mono; exact fatal errors below. |
| `pnpm --filter @jeswr/app-issues run typecheck` | PASS after the build attempt. |
| `pnpm --filter @jeswr/app-issues run test` | PASS: 48 files, 730 tests. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=7015b66f44dcf2e6d1886a40294d611b99a5badf pnpm run gate` | FAIL at `@jeswr/app-issues#build`: the same Google Fonts errors; 8 successful tasks of 10. |
| `pnpm run gate:full` | FAIL at `//#test:root`: 44 successful tasks of 210. Root tests: 4 files failed, 8 passed; 161 tests failed, 739 passed. Other tasks were interrupted. |
| `git diff --check 7015b66f44dcf2e6d1886a40294d611b99a5badf` | PASS. |

The package build and affected gate reported:

```text
Error: Turbopack build failed with 2 errors:
[next]/internal/font/google/geist_a71539c9.module.css
next/font: error:
Failed to fetch `Geist` from Google Fonts.

[next]/internal/font/google/geist_mono_8d43a2aa.module.css
next/font: error:
Failed to fetch `Geist Mono` from Google Fonts.
```

Both requests failed to establish a connection to `https://fonts.googleapis.com`.
The existing guarded-fetch dynamic-import warning also appeared. No font, server,
dependency, manifest, lockfile, or e2e-spec changes were made. Browser tests were not
rerun in this round; their earlier configured-webServer startup failure remains
recorded above. No dependencies were added, so `check:packages` was not needed.

The full gate again failed in `test/agent-layers-reachability.test.mjs`,
`test/agent-layers.test.mjs`, `test/check-packages-guard.test.mjs`, and
`test/check-sdk-layers.test.mjs`, including empty CLI-output assertions such as
`AssertionError: expected '' to contain 'executor-only'`. These failures are outside
the requested refresh-race fix and remain unchanged. The package build, affected
gate, and full gate remain non-green for the recorded failures.

`roborev status` returned `/bin/bash: line 1: roborev: command not found` (exit 127),
so automated per-commit review remains unavailable. Open questions: none.

## Fix round 3 — sst-8xm.1

Review baseline: `2806f23e5147e5d4e77c6d24182317a789704d24`.

- `df84dd8f` — `fix: bound live issue refresh delays`: preserve the shared 800 ms
  trailing debounce and enforce a five-second maximum wait from the first queued
  invalidation. Either timer flushes the board and clears both timers; tracker,
  identity, and storage changes, and unmount, cancel both timers. Both timers
  survive membership changes alongside the existing subscriptions.
- Final documentation commit — `docs: record polling starvation fix validation`:
  this report.

The regression uses the actual notification watcher and injected discovery failures
to start 40 polling fallbacks 625 ms apart. It failed before the fix because no
refresh occurred by 30 seconds. After the fix, the board shows the external status
change at 30 seconds and continues refreshing throughout the 125-second reproduction
window. A second test checks short bursts still debounce and do not leave an extra
refresh queued. Existing scope-change and unmount tests now advance through the
five-second bound; the polling regression also verifies all timers stop on unmount.

Commands used `PATH=/opt/node24/bin:$PATH` (Node `v24.22.1`, pnpm `10.4.1`), with
dependency lifecycle scripts disabled.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/app-issues^...' --concurrency=4` | PASS: 7 dependency builds. |
| `pnpm --filter @jeswr/app-issues exec vitest run src/lib/use-issues.test.tsx` | PASS: 10 tests. Before the fix, the new polling-starvation regression failed. |
| `pnpm --filter @jeswr/app-issues run lint` | PASS; the existing `react-hooks/exhaustive-deps` warning at `src/components/issues-view.tsx:881` remains. |
| `pnpm --filter @jeswr/app-issues run build` | FAIL: existing Google Fonts connection failures for Geist and Geist Mono; exact fatal errors below. |
| `pnpm --filter @jeswr/app-issues run typecheck` | PASS after the build attempt. |
| `pnpm --filter @jeswr/app-issues run test` | PASS: 48 files, 732 tests. |
| `pnpm run lint:root` (inside the affected gate) | PASS. |
| `TURBO_SCM_BASE=2806f23e5147e5d4e77c6d24182317a789704d24 pnpm run gate` | FAIL at `@jeswr/app-issues#build`: the same two Google Fonts errors; 8 successful tasks of 10. |
| `pnpm run gate:full` | FAIL at `//#test:root`: 56 successful tasks of 221. Root tests: 4 files failed, 8 passed; 161 tests failed, 739 passed. Other tasks were interrupted. |
| `git diff --check 2806f23e5147e5d4e77c6d24182317a789704d24` | PASS. |

The package build and affected gate reported:

```text
Error: Turbopack build failed with 2 errors:
[next]/internal/font/google/geist_a71539c9.module.css
next/font: error:
Failed to fetch `Geist` from Google Fonts.

[next]/internal/font/google/geist_mono_8d43a2aa.module.css
next/font: error:
Failed to fetch `Geist Mono` from Google Fonts.
```

Both requests failed to establish a connection to `https://fonts.googleapis.com`.
The full gate again failed in `test/agent-layers-reachability.test.mjs`,
`test/agent-layers.test.mjs`, `test/check-packages-guard.test.mjs`, and
`test/check-sdk-layers.test.mjs`, including empty CLI-output assertions such as
`AssertionError: expected '' to contain 'storage-client may depend only on'`.
These failures match the earlier rounds and are outside the requested fix.

No dependencies, manifests, lockfiles, server configuration, or e2e specs changed;
`check:packages` was not needed. Browser tests were not rerun in this round; their
earlier configured-webServer startup failure remains recorded above. The package
build, affected gate, and full gate remain non-green for the recorded failures.
`roborev status` again returned `/bin/bash: line 1: roborev: command not found`
(exit 127), so automated per-commit review remains unavailable. Open questions: none.
