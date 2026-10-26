<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-iv1i — TSK-L3 lane report

Branch: `lane/sst-iv1i`. Base: `8865b4b3e01bdb91ab0f102683e0833f786c65cf`.

## Commits

- `2b5bad65` — `feat: add task board grouping and ordering`: pure status columns,
  WIP counts, fractional-key moves, minimal bulk reorder patches, typed validation,
  barrel/types, coverage glob, operation tests and interpretation questions.
- `9e0da28f` — `feat: encode task board filter and sort state`: closed, versioned,
  canonical URL-safe persistence and round-trip/rejection tests.
- Final `docs: record task board lane validation` commit contains this report.

## Validation

All commands run in this checkout; no dependencies added, so `check:packages` is
not applicable. No manifest or lockfile changes.

- `pnpm --filter @jeswr/suite-ui run build` — PASS (existing workspace dependency).
- `pnpm --filter @jeswr/app-suite exec vitest run test/tasks-board.test.ts test/tasks-board-state.test.ts --coverage.include='src/apps/tasks/lib/board/**/*.ts'`
  — PASS, 89 tests. Board directory: 100% statements, branches, functions and lines.
  The minimal-change oracle checks all 120 permutations of five tasks independently.
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test`
  — PASS, 29 files / 1,266 tests. Existing Money library lint warnings remain.
- `git -c commit.gpgsign=false merge origin/main` — PASS, already up to date;
  local `origin/main` equals the supplied base. No network fetch or merge occurred.
- `pnpm run lint:root` — PASS, including workspace/layer/token/contrast guards.
- `TURBO_SCM_BASE=8865b4b3e01bdb91ab0f102683e0833f786c65cf pnpm run gate`
  — PASS, 7/7 Turbo tasks, after merging local `origin/main`.
- `pnpm run gate:full` — FAIL in the unchanged
  `@jeswr/federation-codegen#test` task (211 successful / 289 total tasks before
  Turbo stopped). Two tests in `tools/federation-codegen/test/generator.test.ts`
  still expect legacy `https://w3id.org/jeswr/…` bookmarks namespaces/generated
  ontology bytes, while the vocabulary inputs use `https://jeswr.org/ns/…`.
  The generator and vocabulary paths have no diff against the supplied base.
  This inherited failure is outside TSK-L3 and was left unchanged.
- `pnpm --filter @jeswr/federation-codegen run test` — FAIL independently with
  the same two failures (23 passed / 2 failed), confirming the full-gate blocker.
- `git diff --check 8865b4b3e01bdb91ab0f102683e0833f786c65cf HEAD` — PASS.

## Scope and remaining items

Implementation is complete; the inherited full-workspace gate failure remains a
dispatcher integration blocker. No UI, routes, hooks, network or RDF code was added;
screenshots, browser/axe checks and dev fixture routes do not apply to this pure
library. Playwright was not launched.

`roborev` is not installed in this environment (`command -v roborev` found no
executable), so automated per-commit review could not run. No review verdicts are
available; dispatcher review remains outstanding.

Conservative interpretations are documented in `QUESTIONS.md`: explicit status
projections and shared string keys take precedence over the older numeric section
board, WIP is a count without workflow-specific limits, and filter persistence uses
a closed schema. These choices do not block the requested library. Reorder patches
require the complete column snapshot; persistence/concurrent-write coordination
remains with callers. Bulk minimisation uses O(n²) time and O(n) memory.
