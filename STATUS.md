<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-7o0m — MON-L4 recurring transactions and forecasting

Branch: `lane/sst-7o0m`. Base: `8865b4b3e01bdb91ab0f102683e0833f786c65cf`.

Implemented the pure TypeScript library under
`apps/suite/src/apps/money/lib/forecast/`, its public barrel and API documentation,
synthetic unit tests, and the directory's coverage include. No React, hooks, fetch,
RDF persistence, UI, new packages, or dependency changes.

## Commits

- `64ab702b feat(money): add recurring transaction forecasts`: template expansion
  for weekly/biweekly/monthly day or last/yearly, upcoming bills, exact integer
  account/day forecasts, conservative history detection, typed validation errors,
  API documentation, coverage glob, and numbered spec readings in `QUESTIONS.md`.
- `7d39f814 test(money): cover recurring forecasts and rejected inputs`: 25 tests
  covering supported schedules, leap/century and range boundaries, bills,
  account/currency isolation, exact accumulation and overflow, detection tolerance,
  immutability, malformed/sparse/accessor inputs, and private error messages.
- Final documentation commit: this status report (committed last).

## Validation

Commands were run in this checkout. Generated outputs are excluded from commits.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/money-forecast.test.ts --coverage.include='src/apps/money/lib/forecast/**/*.ts'` | PASS: 25 tests; 100% statements (164/164), branches (83/83), functions (34/34), lines (142/142), every file in the new directory. |
| `pnpm --filter @jeswr/suite-ui run build` | PASS: built the existing workspace dependency before the app build/typecheck. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS (exit 0; Biome reports non-null assertion warnings). |
| `pnpm --filter @jeswr/app-suite run build` | PASS: Next.js production build. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 28 files, 1,202 tests; all configured coverage thresholds 100%. |
| `git -c commit.gpgsign=false merge origin/main` | Already up to date. Local `origin/main` is the supplied base; no remote fetch. Run before the final Turbo gates. |
| `pnpm run lint:root` | PASS, including workspace/layer/token/contrast guards (74 contrast pairs, zero failures). |
| `TURBO_SCM_BASE=8865b4b3e01bdb91ab0f102683e0833f786c65cf pnpm run gate` | PASS: 7/7 tasks, app tests and 686 root tests. |
| `pnpm run gate:full` | FAIL: 267 tasks succeeded of 335 scheduled; stopped at two unrelated `@jeswr/federation-codegen` test failures described below. |
| `pnpm --filter @jeswr/federation-codegen run test` | FAIL in isolation: the same two namespace/fixture tests; 23 tests pass. |
| `git diff --exit-code 8865b4b3e01bdb91ab0f102683e0833f786c65cf -- tools/federation-codegen packages/solid-federation-vocab` | PASS: both failing codegen and vocabulary areas are unchanged from the supplied base. |
| `git diff --check` | PASS. |

The initial focused test run exposed one unexercised amount-minimum branch; its
fixture was extended and the repeat achieved 100%. An early typecheck preflight
failed because the clean checkout had no built `@jeswr/suite-ui` declarations;
building that dependency resolved it. Final app checks and the affected gate pass.

No third-party dependencies were added, so `check:packages` is not applicable.
No UI was built, no Playwright was launched, and no screenshots were taken.
The full gate generated untracked `callback.html` and `clientid.jsonld` under the
eight existing `apps/pod-*/web/public/` directories. Those generated files and their
otherwise-empty directories were removed after verification to restore a clean tree.

## Limitations and open questions

`roborev` is not installed/on PATH in this sandbox. Automated per-commit review
could not be queued or read; dispatcher review remains outstanding. No review
configuration or hooks were changed.

The full-workspace gate fails in `tools/federation-codegen/test/generator.test.ts`:
"projects the bookmarks node shape into typed cardinalities and RDF term kinds"
expects `https://w3id.org/jeswr/sectors/bookmarks#Bookmark` but receives
`https://jeswr.org/ns/sectors/bookmarks#Bookmark`; "uses only ontology and SHACL
inputs and reproduces every committed output byte" also fails on the old-versus-new
namespace in committed `ontology.ttl`. These inputs, tests, and committed generator
outputs are unchanged by this lane. No unrelated repair was attempted.

Implementation is complete. Spec ambiguities and the conservative choices are
numbered in `QUESTIONS.md`: skip nonexistent calendar dates; require three exact
schedule observations and explicit amount tolerance; use explicit opening/range
boundaries and caller-controlled posted/template deduplication; use plain recurrence
data with RDF translation left to persistence adapters. No ambiguity blocks use.

No push, PR, branch switch, remote fetch, or edits to other checkouts were performed.

## Fix round 1 — detection workload

Review finding 1 is addressed in `0e4c65d3 fix(money): stop detection at schedule mismatches`.
Candidate detection now compares each expected occurrence with the next observation
immediately, rejects the first mismatch, and checks the final observation count.
It no longer allocates an expected-date array. Candidate priority and accepted
schedules are unchanged; the scan's ending day is calculated once per candidate.

Three regression cases span years 0001–9999 with missing occurrences, irregular
dates, and duplicate observations. They wrap the real calendar matcher and enforce
a deterministic work bound without elapsed-time assertions. All three fail against
the pre-fix implementation and pass with the fix.

| Exact command | Fix-round result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/money-forecast.test.ts --coverage.include='src/apps/money/lib/forecast/**/*.ts'` | PASS: 28 tests; forecast coverage 100% statements (167/167), branches (83/83), functions (33/33), lines (145/145). |
| `pnpm --filter @jeswr/app-suite exec vitest run test/money-forecast.test.ts --coverage.enabled=false --testNamePattern='stops failed candidates early'` | Regression proof: all three new cases fail against the original detector; the fixed file was restored immediately afterward. |
| `pnpm --filter @jeswr/suite-ui run build` | PASS: app workspace dependency. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS: warnings only. |
| `pnpm --filter @jeswr/app-suite run build` | PASS. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 28 files, 1,205 tests; configured coverage 100% throughout. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=689c82a38fcc296b1904f33a9d3d19e4f3ca27df pnpm run gate` | PASS: 6/6 tasks. |
| `pnpm run gate:full` | FAIL: 229/300 tasks succeeded before the same two pre-existing federation-codegen namespace/fixture failures documented above stopped the run. |
| `git diff --exit-code 689c82a38fcc296b1904f33a9d3d19e4f3ca27df -- tools/federation-codegen packages/solid-federation-vocab` | PASS: failing areas are unchanged from the supplied fix-round starting commit. |
| `git diff --check` | PASS. |

No dependencies or unrelated implementation files changed. The supplied review
finding is fixed; there are no new design questions. `roborev` remains unavailable
in this sandbox, so a new automated per-commit verdict cannot be queued locally.
The final documentation commit records this fix-round validation. No push, PR,
branch switch, fetch, merge, or edits to other checkouts were performed.
