<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-sxdq — CAL-L5 Reminder scheduling

Implemented on `lane/sst-sxdq`, based on
`8865b4b3e01bdb91ab0f102683e0833f786c65cf` (2026-10-26).

## Commits

- `4a58ba6a docs: record reminder scheduling interpretations`: numbered conservative
  decisions in `QUESTIONS.md` with spec references and alternatives.
- `c9b002f9 feat: schedule calendar reminders with delivery state`: pure library and barrel,
  resolved absolute/relative triggers, injected clock, half-open windows, immutable
  snooze/dismiss/deliver reducer, delivery dedupe, revision fencing, deterministic ordering,
  next wakeup and typed fail-closed validation; API documentation.
- `7f3136c2 test: cover calendar reminder scheduling exhaustively`: 103 behavior and
  rejection tests with synthetic inputs; reminder glob added to app coverage inclusion.
- Final documentation commit: this report and completed validation results.

## Validation

- `git -c commit.gpgsign=false -c user.name="Jesse Wright" -c user.email=63333554+jeswr@users.noreply.github.com merge origin/main`
  — PASS, already up to date. Local `origin/main` is the base commit; no fetch was needed.
  `git merge-base --is-ancestor origin/main HEAD` also passed before the final gates.
- `pnpm exec biome check --write apps/suite/src/apps/calendar/lib/reminders apps/suite/test/calendar-reminders.test.ts apps/suite/vitest.config.ts`
  — PASS; formatted the new code and tests.
- `pnpm --filter @jeswr/app-suite exec vitest run test/calendar-reminders.test.ts --coverage.include='src/apps/calendar/lib/reminders/**/*.ts'`
  — PASS, 103 tests. Directory coverage: statements 125/125, branches 107/107,
  functions 18/18, lines 111/111 (100% each, every file).
- Initial `pnpm --filter @jeswr/app-suite run typecheck` — failed because this fresh
  checkout lacked built `@jeswr/suite-ui` declarations. Built that workspace dependency
  with `pnpm --filter @jeswr/suite-ui run build` (PASS), then repeated typechecking as
  part of the following successful app validation.
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test`
  — PASS, all four stages. Lint reports 21 existing warnings in Money budget sources/tests;
  none in the new reminder code. All 28 app test files / 1,280 tests passed, with 100%
  statements, branches, functions and lines across all included library directories.
- `pnpm run lint:root` — PASS, including workspace/layer/fetch/token/contrast guards.
- `TURBO_SCM_BASE=8865b4b3e01bdb91ab0f102683e0833f786c65cf pnpm run gate`
  — PASS, 7/7 Turbo tasks; app 1,280 tests plus root 686 tests passed.
- `pnpm run gate:full` — FAIL outside lane scope: 287/349 Turbo tasks successful,
  4 cached, then `@jeswr/federation-codegen#test` failed (2 tests failed, 23 passed).
  `tools/federation-codegen/test/generator.test.ts` expects the old
  `https://w3id.org/jeswr/sectors/bookmarks#Bookmark` target class and byte-for-byte old
  generated ontology output; the source vocabulary now uses `https://jeswr.org/ns/`.
  Both failures are present in unchanged base files: the diff against the base for
  `tools/federation-codegen` and `packages/solid-federation-vocab` is empty. No fixes to
  those unrelated projects were made. The full gate did not complete the remaining tasks.
  Removed only the generated, previously absent `clientid.jsonld` and `callback.html`
  files under the eight `apps/pod-*/web/public/` directories after the gate stopped.
- `git diff --check 8865b4b3` — PASS.

## Scope, limitations and questions

- No dependencies or manifest changes; `check:packages` and lockfile changes are not
  applicable. No packages/applications were added to the workspace inventory.
- No UI was built. Screenshots, dev fixture routes, Playwright and axe are not applicable
  to this pure library lane; Chromium was not launched.
- `QUESTIONS.md` records the conservative policies: epoch-millisecond/pre-expanded
  occurrence inputs, fixed `PT` offsets only, half-open windows, explicit acknowledgements,
  per-occurrence dismissal, and caller-owned state persistence/pruning. Unsupported
  calendar-relative durations, floating/all-day inputs, repeat alarms and unknown fields
  fail closed. No unresolved question blocks the supported contract.
- `roborev` is not installed (`command -v roborev` found no executable), and the checkout
  has no active post-commit review hook. Automated review verdicts are unavailable in this
  environment; no review tooling was installed or configured.
- Implementation and requested app/affected checks are complete. Full-workspace green
  remains blocked by the unrelated federation-codegen failures above; automated commit
  reviews remain unavailable. No other lane work is unfinished.
