<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CAL-L2 — sst-u974 lane report

Branch: `lane/sst-u974`. Base: `8865b4b3e01bdb91ab0f102683e0833f786c65cf`.

Implemented the dependency-free timed recurrence core in
`apps/suite/src/apps/calendar/lib/recurrence/`, with a barrel, API documentation, typed errors,
Intl-based IANA wall-time conversion, the requested RRULE subset, EXDATE/RDATE, output/work
caps, and sorted/coalesced free/busy intervals. No React, hooks, fetch, UI or RDF changes.

Commits:

- `1d7e3006` — `feat(calendar): expand zoned recurrence and merge busy intervals`.
  Implementation, public API documentation, conservative scope questions, coverage glob,
  and core recurrence/DST tests.
- `595704a5` — `test(calendar): cover recurrence rejection and hard limits`.
  Invalid/unsupported inputs, scan/output bounds, date limits, explicit gaps, and free/busy.
- Final `docs(calendar): record recurrence lane validation` commit — this report.

Validation (run inside this checkout):

- `pnpm --filter @jeswr/suite-ui run build` — PASS; builds the app's existing prerequisite.
  An initial app typecheck before this build failed because suite-ui declarations were absent;
  the subsequent required app chain passed.
- `pnpm --filter @jeswr/app-suite exec vitest run test/calendar-recurrence.test.ts test/calendar-recurrence-validation.test.ts test/calendar-recurrence-busy.test.ts --coverage.include='src/apps/calendar/lib/recurrence/**/*.ts'`
  — PASS: 117 tests; directory coverage 100% statements (191), branches (138), functions (32),
  and lines (174). Barrel imported by all three test files. No coverage exemptions.
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test`
  — PASS: 30 files / 1,294 tests; all configured app coverage metrics 100%. Biome reports 21
  existing non-null-assertion warnings in unrelated Money code/tests; no lint errors.
- `pnpm run lint:root` — PASS, including workspace/layer/fetch/token/contrast guards.
- `TURBO_SCM_BASE=8865b4b3e01bdb91ab0f102683e0833f786c65cf pnpm run gate`
  — PASS: 7/7 Turbo tasks, 0 cached.
- `pnpm run gate:full` — FAIL after 219 successful / 298 planned tasks (5 cached),
  in 1m25s. The unrelated `@jeswr/federation-codegen#test` has two existing failures in
  `tools/federation-codegen/test/generator.test.ts`:
  - line 81 expects the legacy `https://w3id.org/jeswr/sectors/bookmarks#Bookmark` while
    current ontology inputs use `https://jeswr.org/ns/sectors/bookmarks#Bookmark`;
  - line 126 finds committed `ontology.ttl` differs from freshly generated ontology bytes
    after the namespace/version rebase.
  `git diff 8865b4b3e01bdb91ab0f102683e0833f786c65cf -- tools/federation-codegen packages/solid-federation-vocab`
  is empty: these inputs/tests were not changed by this lane. The full gate aborted remaining
  tasks. Repairs outside the lane's calendar scope were not attempted.
- `git diff 8865b4b3e01bdb91ab0f102683e0833f786c65cf --check` — PASS.

No dependencies added; no `check:packages` calls or manifest/lockfile changes were needed.
No screenshots or Playwright specs: this lane builds only a pure library, with no rendered
components/states. Chromium was not launched.

Review limitation: `roborev status` exits 127 (`roborev: command not found`). Automated
per-commit review could not run in this environment; the dispatcher must run it before merge.
See the repository's mandated workflow in `skills/roborev-review/SKILL.md`.

Scope choices/open questions are recorded in `QUESTIONS.md`: timed API only (date-only,
floating and nominal-duration inputs rejected), and a handwritten subset rather than adding
`rrule`. No implementation work is blocked on these conservative choices.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 1 — out-of-window generated ends

Generated RRULE starts at or after the exclusive window end are skipped before validating
their interval ends. COUNT accounting remains before window filtering. Explicit DTSTART
and RDATE validation remains unconditional, and overlapping intervals still validate their ends.
No dependencies, API, or design changes.

Regression tests reproduce the reviewed year-9999 overflow and the exact window-end boundary.
Both failed with `invalid-date` before the fix. Additional assertions retain rejection of
overflowing visible occurrences and out-of-window explicit DTSTART/RDATE intervals.

Validation for this round:

- `pnpm --filter @jeswr/app-suite exec vitest run test/calendar-recurrence.test.ts test/calendar-recurrence-validation.test.ts test/calendar-recurrence-busy.test.ts --coverage.include='src/apps/calendar/lib/recurrence/**/*.ts'`
  — PASS: 120 tests; recurrence coverage 100% statements, branches, functions, and lines.
- `pnpm --filter @jeswr/suite-ui run build` — PASS (existing app prerequisite).
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test`
  — PASS: 30 files / 1,297 tests, all configured coverage metrics 100%. Lint retains 21
  existing Money warnings. An initial lint attempt found formatting in the new test;
  formatting was corrected before this successful chain.
- `pnpm run lint:root` — PASS.
- `TURBO_SCM_BASE=30bc4d852089c868cdfad8c6d3b06ddf0e86f3b6 pnpm run gate`
  — PASS: 6/6 Turbo tasks, 0 cached.
- `pnpm run gate:full` — initial attempt stopped after 37/200 tasks on an unrelated
  5-second timeout in `test/agent-layers.test.mjs:509` (the export-star path-character case).
- `pnpm exec turbo run test:root` — isolated retry PASS: 7 files / 686 tests.
- `pnpm run gate:full` — retry FAIL after 279 successful / 348 planned tasks (39 cached),
  in 4m24s, at the same two pre-existing `@jeswr/federation-codegen#test` failures recorded
  above: `test/generator.test.ts:81` expects the old bookmarks namespace, and line 126
  detects `ontology.ttl` drift. No changes relative to `30bc4d852089` in
  `tools/federation-codegen` or `packages/solid-federation-vocab`. Remaining tasks were
  aborted; unrelated repairs are outside this fix round. Generated, untracked
  `apps/pod-*/web/public/{callback.html,clientid.jsonld}` build outputs were removed.
- `git diff --check` — PASS.

Commits for this round:

- `0a8e3fd4` — `fix(calendar): skip generated starts beyond the window` (fix and regression tests).
- Final `docs(calendar): record boundary fix validation` commit — this report.

`roborev status` remains unavailable (exit 127); the dispatcher must provide automated review.
No unfinished implementation work or new open questions. No UI/screenshots apply.

## Fix round 2 — generated zoned start overflow

`Zone.resolve()` now returns the resolved instant without imposing the supported year range.
Generated starts are range-checked after UNTIL/window filtering; explicit DTSTART, RDATE,
and EXDATE still validate their resolved instants unconditionally. Visible occurrences
continue to validate both endpoints. No dependencies, public API, or design changes.

Regression tests cover the reviewed New York year-9999 start with and without UNTIL,
and rejection of out-of-range explicit zoned dates at both supported date boundaries.
The two generated-start cases failed with `invalid-date` before the fix.

Validation for this round:

- `pnpm --filter @jeswr/app-suite exec vitest run test/calendar-recurrence-validation.test.ts --coverage.enabled=false`
  — before the fix: 2 expected regression failures, 97 passes.
- `pnpm --filter @jeswr/app-suite exec vitest run test/calendar-recurrence.test.ts test/calendar-recurrence-validation.test.ts test/calendar-recurrence-busy.test.ts --coverage.include='src/apps/calendar/lib/recurrence/**/*.ts'`
  — PASS: 124 tests; recurrence coverage 100% statements (194), branches (140),
  functions (32), and lines (176).
- `pnpm --filter @jeswr/suite-ui run build` — PASS (existing app prerequisite).
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test`
  — PASS: 30 files / 1,301 tests, all configured coverage metrics 100%. Lint retains
  21 existing Money warnings. An initial lint attempt identified formatting in the new
  test; it was formatted before the successful chain.
- `pnpm run lint:root` — PASS.
- `TURBO_SCM_BASE=f73aa3c3477804925d5256219fd975bd7176554d pnpm run gate`
  — PASS: 6/6 Turbo tasks, 0 cached.
- `pnpm run gate:full` — FAIL after 209 successful / 290 planned tasks (5 cached),
  in 1m15s, at the same two pre-existing `@jeswr/federation-codegen#test` failures:
  `test/generator.test.ts:81` expects the old bookmarks namespace, and line 126
  detects `ontology.ttl` drift. The diff relative to `f73aa3c34778` is empty for
  `tools/federation-codegen` and `packages/solid-federation-vocab`. Remaining tasks
  were aborted; unrelated repairs are outside this fix round.
- `git diff --check` — PASS.

Commits for this round:

- `6fca6d76` — `fix(calendar): filter generated starts before range validation`
  (fix and regression tests).
- Final `docs(calendar): record zoned boundary fix validation` commit — this report.

`roborev status` remains unavailable (exit 127); the dispatcher must provide automated review.
No dependencies added or `check:packages` calls needed. No unfinished implementation work,
new open questions, UI changes, or screenshots.

## Fix round 3 — local-year cutoff

Removed the local-year-9999 scan clamp so generated local dates in year 10000 can resolve
to supported UTC instants. Window/UNTIL filtering and subsequent instant/interval validation
remain in place. This fixes the reviewed Kiritimati omission without changing explicit-date
validation, the public API, or dependencies.

Regression tests assert all three expected UTC intervals for the reviewed
`9999-12-30T00:00:00` Kiritimati start, using COUNT, UNTIL, and an unbounded daily rule.
All three failed before the fix, returning only two intervals.

Validation for this round:

- `pnpm --filter @jeswr/app-suite exec vitest run test/calendar-recurrence-validation.test.ts --coverage.enabled=false`
  — before the fix: 3 expected regression failures, 99 passes.
- `pnpm --filter @jeswr/app-suite exec vitest run test/calendar-recurrence.test.ts test/calendar-recurrence-validation.test.ts test/calendar-recurrence-busy.test.ts --coverage.include='src/apps/calendar/lib/recurrence/**/*.ts'`
  — PASS: 127 tests; recurrence coverage 100% statements (194), branches (140),
  functions (32), and lines (176).
- `pnpm --filter @jeswr/suite-ui run build` — PASS (existing app prerequisite).
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test`
  — PASS: 30 files / 1,304 tests, all configured coverage metrics 100%. Lint retains
  21 existing Money warnings.
- `pnpm run lint:root` — PASS.
- `TURBO_SCM_BASE=f73aa3c3477804925d5256219fd975bd7176554d pnpm run gate`
  — PASS: 7/7 Turbo tasks, 0 cached.
- `pnpm run gate:full` — FAIL after 227 successful / 299 planned tasks (5 cached),
  in 1m42s, at the same two pre-existing `@jeswr/federation-codegen#test` failures:
  `test/generator.test.ts:81` expects the old bookmarks namespace, and line 126
  detects `ontology.ttl` drift. The diff relative to `f73aa3c34778` is empty for
  `tools/federation-codegen` and `packages/solid-federation-vocab`. Remaining tasks
  were aborted; unrelated repairs are outside this fix round.
- `git diff f73aa3c3477804925d5256219fd975bd7176554d --check` — PASS.

Commits for this round:

- `68fcf085` — `fix(calendar): retain valid UTC starts beyond the local year`
  (fix and regression tests).
- Final `docs(calendar): record local-year fix validation` commit — this report, committed last.

`roborev status` remains unavailable (exit 127); the dispatcher must provide automated review.
No dependencies added or `check:packages` calls needed. No unfinished implementation work,
new open questions, UI changes, or screenshots.
