<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-8xm.1 — Issues local-CSS e2e coverage

Branch: `lane/sst-8xm.1`. Base: `93afe9d606533fc0b36ab314423d2f0b73e528e6`.

## Commits

- `4bb2dbe9` — `test: seed local inbox accounts`: seed fresh Alice/Bob accounts and private inboxes in global setup, preserve profiles through typed RDF updates, grant the peer Append access, and reject non-local CSS origins. Credentials stay in process memory.
- `8f8b7734` — `test: cover live board and LDN inbox`: add the board and inbox specs, and conditionally replace any server-seeded inbox ACL. The board test observes the real WebSocketChannel2023 subscription and a change frame while a second context changes status, then checks the card moves without navigation. Inbox tests POST a typed, Writer-serialized Announce and check UI assignment delivery to Bob.
- Final documentation commit — `docs: record issues lane validation`: this report.

No production application code, manifests, dependencies, lockfiles, or server configuration changed.

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
