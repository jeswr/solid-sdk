<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-xv8r — PHO-L6 lane report

Branch: `lane/sst-xv8r`. Base: `2c99c9d2202c6b18c38c88ed1524fcb3d2efd460`.
Scope: `apps/suite/src/apps/photos/lib/geo/`, its tests and coverage inclusion.

## Commits

- `7bb5f2b8` — `feat(photos): add GPS and map clustering helpers`: typed errors, validated
  unsigned EXIF rationals, suspicious origin, decimal/DMS formatting, RFC 5870/OpenStreetMap
  links, mean-radius haversine distance, bounded Web Mercator clustering, API documentation,
  tests, coverage glob, and conservative interpretation notes in `QUESTIONS.md`.
- `d1a6febc` — `test(photos): verify Mercator boundaries and isolation`: edge adjacency, a
  known nonlinear tile-row boundary, frozen inputs, independent results.
- `89d8ce46` — `fix(photos): check EXIF bounds before rounding`: exact rational comparisons
  prevent a tiny excess beyond ±90/±180 from disappearing through floating-point addition;
  regression first reproduced the bug, then passed after the fix.
- Final documentation commit: this report, committed after the final checks below.

## Environment and validation

Commands run from this checkout with Node `v24.22.1` and pnpm `10.4.1`:

```sh
export PATH="/opt/node24/bin:$PATH"
export npm_config_manage_package_manager_versions=false
export VITEST_MAX_WORKERS=1
```

The Node 22 shell default tried to install a package-manager version outside the writable
roots; selecting the already-installed Node 24 toolchain avoided that. No dependencies or
lockfiles changed; lifecycle scripts remain disabled.

Standalone app tests also passed with `VITEST_MAX_WORKERS=4`. The final gate retry uses one
worker and `--env-mode=loose` because Turbo's default strict mode filters out this variable.
The repository's gate scripts and test timeouts are unchanged.

| Command | Result |
| --- | --- |
| `git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main` | Passed; origin is the local `/home/user/solid-sdk` clone. No network remote was accessed. |
| `git merge origin/main` (with the required commit identity and signing disabled) | Passed: already up to date; `origin/main` is the base above. Done before final gates. |
| `pnpm exec turbo run build --filter='@jeswr/app-suite^...'` | Passed: all 7 dependency builds. An initial typecheck before these builds failed on absent workspace declarations. |
| `pnpm exec biome check apps/suite/src/apps/photos/lib/geo apps/suite/test/photos-geo.test.ts` | Passed, no warnings on lane files. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/photos-geo.test.ts --coverage.include='src/apps/photos/lib/geo/**/*.ts'` | Passed: 113 tests; directory coverage 100% statements (86/86), branches (52/52), functions (19/19), lines (85/85), including the barrel. |
| `pnpm --filter @jeswr/app-suite run lint` | Passed; 54 existing warnings in unrelated app files. |
| `pnpm --filter @jeswr/app-suite run build` | Passed. |
| `pnpm --filter @jeswr/app-suite run typecheck` | Passed after dependency builds. |
| `pnpm --filter @jeswr/app-suite run test` | Passed: 153 files, 7620 tests, 100% app coverage. The unrestricted worker run was interrupted after making no progress; bounded retries passed. |
| `pnpm run lint:root` | Passed, including all 74 contrast pairs and the agent layer guard. |
| `TURBO_SCM_BASE=2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 pnpm run gate` | Initial run failed: four existing root guard cases exceeded their 5000 ms timeout under unrestricted workers. |
| `pnpm run test:root` (one worker) | Passed: 12 files, 879 tests. |
| `TURBO_SCM_BASE=2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 pnpm run gate --env-mode=loose` | Passed: 13/13 tasks, including app lint/build/typecheck/test and all root tests; 3m52.767s. App: 153 files, 7620 tests, 100% coverage. |
| `pnpm run gate:full` | Initial run failed: six existing root guard cases exceeded 5000 ms under unrestricted workers. |
| `pnpm run gate:full --env-mode=loose` (one worker) | Failed outside lane scope: `@jeswr/federation-trust#test`, delegation credential inline snapshot mismatch at `test/characterization.test.ts:196`. 288 tasks passed, 352 scheduled, 10 cached; 13m31.506s. Root tests and app checks passed. |
| `pnpm --filter @jeswr/federation-trust exec vitest run test/characterization.test.ts` | Reproduced independently: 19 tests passed, 1 snapshot failed with the same embedded-JWK property-order mismatch. |
| `git diff --check` | Passed. |

Tests accept exactly `MAX_CLUSTER_POINTS` (200000) and reject 200001 before any member read,
including when zoom is also invalid. Zoom 0 and 20 are accepted; 21 is rejected. Geographic and
Mercator boundaries, each hemisphere, malformed/unsafe rationals, zero denominators, minute/second
overflow, all error codes, DMS carry, date-line distances, sorting and immutability are covered.

## Remaining work and questions

- Full-workspace gate remains blocked by the unchanged federation-trust test's JSON property-order
  snapshot: expected delegate-key JWK order `crv,x,kty`, received `kty,crv,x`. The embedded JWK's
  properties and values match, while its serialized property order differs. This package is
  outside the brief and was not edited; its
  snapshot was not updated. The affected gate and every requested app check are green.
- Full-gate web builds generated 14 previously untracked `callback.html` / `clientid.jsonld`
  files in seven legacy `apps/pod-*/web/public/` directories. Removed only those generated files
  and their empty directories after the gate stopped. No unrelated source change is retained.
- No dependency additions; `check:packages` is not applicable.
- Pure library only: no rendered components/states, screenshots, browser run, or Playwright specs
  are applicable. Chromium was not launched.
- Conservative choices are recorded in `QUESTIONS.md`: arithmetic centroids from original
  coordinates, ascending ASCII `zoom/x/y` tie-break, edge tile assignment, and strict IDs/zoom.
  No blocking product question.
- `roborev status` failed with exit 127: the executable is unavailable and this isolated checkout
  has no review hook. Automated review remains for the dispatcher; no verdict was available to read.
- Bead state is left to the dispatcher: this lane cannot touch other checkouts, and the local
  beads skill prohibits tracker operations from a worktree. The bead is not closed before merge.
- No push, PR, branch switch, dependency addition, or write to another checkout was performed.
