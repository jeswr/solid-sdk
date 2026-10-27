<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-qfzq — CAL-L8 lane report

Branch: `lane/sst-qfzq`. Base: `2c99c9d2202c6b18c38c88ed1524fcb3d2efd460`.

Implemented the pure `applyDrag` library in `apps/suite/src/apps/calendar/lib/drag/`:
wall-clock half-up snapping, exact timed-move duration, minimum resize duration with
clamping, exclusive all-day dates, DST gaps/overlaps, recurrence scope and per-edge
elapsed/wall/date offsets. Validation fails closed with `CalendarDragError.code`;
delta limits and supported epoch bounds are exported. Added API documentation,
95 unit tests and the directory coverage glob. No UI or dependency changes.

## Commits

- `9fed158f` — `docs: record calendar drag edge-case choices` (`QUESTIONS.md`).
- `fb0c0d13` — `feat: add pure calendar drag arithmetic` (implementation, tests,
  coverage configuration and API documentation).
- Final report commit — `docs: record calendar drag lane verification` (this file).

## Verification

All successful pnpm invocations used Node **v24.22.1**, pnpm **10.4.1**, and this
environment prefix (the default Node 22 pnpm launcher initially tried to provision
pnpm outside the sandbox's writable roots):

```sh
env PATH=/opt/node24/bin:$PATH npm_config_manage_package_manager_versions=false
```

The commands below follow that prefix; additional environment assignments are
shown explicitly. Lifecycle scripts stayed disabled.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/app-suite^... --concurrency=4` | PASS — 7 dependency builds |
| `pnpm --filter @jeswr/app-suite run lint` | PASS — 54 existing warnings in unrelated Money libraries; no drag diagnostics |
| `pnpm --filter @jeswr/app-suite run build` | PASS — Next.js production build |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS |
| `pnpm --filter @jeswr/app-suite run test` | PASS — 153 files, 7,602 tests; 100% statements, branches, functions and lines |
| `pnpm --filter @jeswr/app-suite exec vitest run test/calendar-drag.test.ts --coverage.include='src/apps/calendar/lib/drag/**/*.ts'` | PASS — 95 tests; 100% statements, branches, functions and lines in every drag file |
| `pnpm exec biome check apps/suite/src/apps/calendar/lib/drag apps/suite/test/calendar-drag.test.ts apps/suite/vitest.config.ts` | PASS — 6 files, no diagnostics |
| `pnpm run lint:root` | PASS |
| `TURBO_SCM_BASE=2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 pnpm run gate` | Initial run failed: 8 existing root `agent-layers` tests exceeded their 5-second timeout during concurrent builds |
| `VITEST_MAX_WORKERS=1 TURBO_SCM_BASE=2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 pnpm run gate` | PASS — 13/13 tasks; 879 root tests and 7,602 app tests |
| `VITEST_MAX_WORKERS=1 pnpm run gate:full` | FAIL outside this lane — 320 successful tasks / 365 scheduled; `@jeswr/federation-trust#test` delegation-credential snapshot mismatch |
| `VITEST_MAX_WORKERS=1 pnpm --filter @jeswr/federation-trust run test` | Reproduced alone — 53 pass / 1 fail; same snapshot mismatch |
| `git diff --check` | PASS |

Before the final gates, ran:

```sh
git -c commit.gpgsign=false -c user.name='Jesse Wright' -c user.email=63333554+jeswr@users.noreply.github.com merge origin/main
```

Result: **Already up to date**. The local `origin/main` ref is the supplied base;
no remote was fetched and no other checkout was touched.

An initial concurrent focused/full coverage run collided in Vitest's shared
`coverage/.tmp` directory; the full test was rerun alone and passed. An early
typecheck caught two invalid-fixture casts involving optional properties; corrected
before the implementation commit. No test timeouts or assertions were changed.

## Remaining verification limitation

The full workspace gate fails at
`packages/federation-trust/test/characterization.test.ts:196`,
`delegation credential structure is stable`. The inline snapshot expects the
public JWK JSON property order `crv,x,kty`; Node 24 emits `kty,crv,x`. Both that
package and the lockfile are unchanged from the supplied base. The same failure
reproduces without other work running. Fixing this unrelated snapshot is outside
CAL-L8's scope; the lane's affected gate and all required app checks pass.

`roborev` is not installed and no post-commit review hook is present in this
sandbox, so automated per-commit verdicts could not be obtained. No review was
claimed as passing.

## Scope and conservative choices

See `QUESTIONS.md` for the unspecified cases and selected conservative readings:
retain a matching original DST-overlap offset or require an explicit choice;
reject all-day partial-day gestures and start resizing; preserve all-day date
spans or reject impossible skipped-date spans; clamp outward when a fixed edge is
off-grid; return explicit series offsets and reject unsupported epoch ranges.
These choices do not block the completed implementation.

`check:packages`: not applicable — no dependencies added or changed; lockfile
unchanged. Screenshots/axe/Playwright: not applicable — pure library, no UI states
or components built, and no browser launched.

Removed only the 14 untracked `callback.html` / `clientid.jsonld` files generated
by the full gate in the seven pod web apps. Build output remains ignored; no
generated artifacts are committed. No pushes, PRs, branch switches or publishing.

## Fix round 1 — 2026-10-27

Starting head: `6b41285c3d08ee77c78e282405ea83de5f6987a1`. Addressed only the
two supplied review findings on `lane/sst-qfzq`:

- `30adefcd` — `fix: use the first instant for all-day boundaries`. Validate
  all-day inputs and resolve moved, resized and clamped boundaries to the earliest
  valid instant, including repeated Havana midnights and every overlap option.
- `1ed80aab` — `fix: normalize fractional-minute drag deltas`. Round converted
  milliseconds only within `2 * Number.EPSILON * abs(rawMilliseconds)` and use
  the validated integer throughout arithmetic. Reject larger submillisecond
  fractions before Intl work. Test signed decimal values, values near the size
  bound, and half-up snap ties for all three gestures.
- Final report commit — `docs: record calendar drag fix verification`.

Before each fix, the new regression cases reproduced the findings (six failing
all-day cases and five failing fractional-minute cases). After both fixes,
all 111 drag tests pass with 100% statements, branches, functions and lines.
The API documentation describes canonical all-day boundaries and fractional
conversion tolerance. No dependencies, lockfile, UI or unrelated source changes.

Commands below used Node `v24.22.1`, pnpm `10.4.1`, and the environment prefix
shown in the original verification section. Lifecycle scripts remained disabled.

| Command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/app-suite^... --concurrency=4` | PASS — 7 dependency builds |
| `pnpm exec biome check --write apps/suite/src/apps/calendar/lib/drag apps/suite/test/calendar-drag.test.ts` | PASS — formatted the new tests |
| `pnpm --filter @jeswr/app-suite exec vitest run test/calendar-drag.test.ts --coverage.include='src/apps/calendar/lib/drag/**/*.ts'` | PASS — 111 tests; 100% statements, branches, functions and lines |
| `pnpm --filter @jeswr/app-suite run lint` | PASS — 54 existing unrelated warnings |
| `pnpm --filter @jeswr/app-suite run build` | PASS — Next.js production build |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS |
| `VITEST_MAX_WORKERS=1 pnpm --filter @jeswr/app-suite run test` | PASS — 153 files, 7,618 tests; 100% coverage across all configured files |
| `pnpm run lint:root` | PASS |
| `VITEST_MAX_WORKERS=1 TURBO_SCM_BASE=6b41285c3d08ee77c78e282405ea83de5f6987a1 pnpm run gate` | PASS — 12/12 tasks |
| `VITEST_MAX_WORKERS=1 pnpm run gate:full` | FAIL outside this lane — 224 successful tasks / 311 scheduled; `@jeswr/suite-ui#test` AppLauncher test exceeded its 5-second timeout; all 879 root tests passed |
| `VITEST_MAX_WORKERS=1 pnpm --filter @jeswr/suite-ui run test` | PASS in isolation — 8 files, 196 tests; no timeout or test changes |
| `git diff --check` | PASS |

The full gate stopped at `packages/suite-ui/test/navigation.test.ts:159`,
`supports checkboxes, keyboard reorder, drag pin/reorder and enforces the six-app
limit`. The complete suite-ui test run passed alone. `packages/suite-ui` and the
lockfile have no changes relative to the starting head. The full workspace gate
has not passed; its previously recorded federation-trust snapshot failure was
not reached in this round. The package gate and affected gate both passed.

`roborev` remains unavailable in the sandbox; no automated per-commit verdict is
claimed. No new implementation questions or unfinished fixes. All-day boundaries
always choose the earliest valid instant, including with `overlap: "later"`, as
required by the review. No tracker, remote, branch or other checkout changes.
