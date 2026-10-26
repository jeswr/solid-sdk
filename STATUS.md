<!-- AUTHORED-BY Codex GPT-6 -->

# sst-xuud lane report

Implementation complete on `lane/sst-xuud` (2026-10-26).

Commit `d6f334ba` (`test(suite): bound budget and insertion workloads`):

- Reduce inline budget-exhaustion tails to 64 repetitions (128 destination characters for
  the mention case). Each still exhausts the unchanged shared budget and asserts intact
  literal rollback, including the initially formatted prefix. The mention scanner's
  exhaustion branch remains covered.
- Reduce failed-list whitespace to 512 space/tab pairs, retaining every marker, both
  Unicode separators, and the standalone and paragraph-continuation assertions.
- Keep five fractional-order insertion histories with seed `20261025`, reducing each to
  1,000 inserts. Retain all ordering, uniqueness, validity and rebalancing assertions.

The conservative implementation only shortens test fixtures. No production code, timeout,
dependency, coverage configuration or coverage threshold changed. Scanning all suite tests
under coverage found no additional test over 2 seconds locally.

## Verification

Three consecutive successful invocations of `pnpm --filter ./apps/suite run test`, with
verbose and JSON reporters added to capture individual timings. V8 coverage stayed enabled.
Each run passed all 1,398 tests in 29 files, with 100% statements, branches, functions and
lines and the unchanged 100% per-file thresholds.

| Run | Total duration | Slowest individual test |
| --- | --- | --- |
| 1 | 12.53 s | 1,211 ms |
| 2 | 8.33 s | 1,129 ms |
| 3 | 7.58 s | 1,546 ms |

Slowest five distinct tests from Vitest output, taking each test's maximum across those runs:

| Test | Maximum duration |
| --- | --- |
| agrees with the oracle for edits crossing 32-bit word boundaries | 1,546 ms |
| fractional order keys / preserves ordering for arbitrary valid bounds and batches | 1,103 ms |
| budgets cumulative recovery and discards candidates found before exhaustion | 981 ms |
| Markdown-lite inline AST / continues formatting long ordinary inputs within the work budget | 448 ms |
| fractional order keys / preserves every existing key during 1k random inserts per generated history | 398 ms |

The three targeted tests' maxima were 146 ms (inline budget fallback), 77 ms (failed lists),
and 398 ms (insertion histories). No individual test exceeded 2 seconds in any acceptance run.

- `pnpm run lint:root`: passed.
- `pnpm --filter ./apps/suite run lint`: passed (existing warnings only).
- `TURBO_SCM_BASE=6323e7ec0bd7a9dc7cf1a1426db29c8634773044 pnpm run gate`:
  passed all six tasks, including suite build, typecheck, lint and coverage tests.
- Unqualified `pnpm run gate`: failed after Turbo could not resolve a local `main` ref and
  fell back to the whole workspace. `pnpm run gate:full` also failed. Both stopped on the
  same two existing `tools/federation-codegen/test/generator.test.ts` failures: the bookmarks
  target-class expectation and regeneration-byte comparison still expect `w3id.org/jeswr`
  namespaces while the inputs use `jeswr.org/ns`. This lane does not change that tool.
- `git diff --check`: passed.

Automated review could not run: `roborev status` reports that `roborev` is not installed.
No implementation work remains and there are no open questions. The unrelated full-gate
failures and unavailable reviewer remain integration limitations.
