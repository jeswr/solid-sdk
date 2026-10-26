<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

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
