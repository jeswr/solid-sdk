<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Lane sst-uqvt — SHT-L6

Implemented the pure conditional formatting evaluator under
`apps/suite/src/apps/sheets/lib/condformat/`, its public barrel and API documentation,
123 synthetic unit tests, and the directory's coverage include. All requested rule
kinds, ordered property precedence, per-cell stopping, scale fill composition,
typed validation errors, and both inclusive input limits are covered.

Commits on `lane/sst-uqvt`:

- `3b5964cf` — document conservative interpretations in `QUESTIONS.md`.
- `2b06340c` — implement evaluator, runtime validation, colours, tests and coverage glob.
- `c6572f41` — rename the interpolation helper to avoid the token scanner's CSS-pattern match.
- `91c76294` — narrow comparison variants and validated anchor tuples for strict TypeScript.
- Final documentation commit — this lane report, committed after the required gates.

Validation uses Node v24.22.1 and pnpm 10.4.1 with `PATH=/opt/node24/bin:$PATH`.
The final app sequence runs lint, then build, then typecheck, then test.

| Exact command (under the PATH above) | Result |
| --- | --- |
| `git merge origin/main` | Already up to date; executed before final gates. The local tracking ref is the base `2c99c9d2202c6b18c38c88ed1524fcb3d2efd460`; no fetch or network merge. |
| `pnpm exec turbo run build --filter='@jeswr/app-suite^...'` | PASS: seven dependency builds, required for fresh workspace dist output. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS: 604 files; 54 pre-existing warnings outside this lane. |
| `pnpm --filter @jeswr/app-suite run build` | PASS: Next.js production compilation, type validation and static generation. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 153 files / 7,630 tests; 100% statements, branches, functions and lines, including every condformat source file. |
| `pnpm run lint:root` | PASS, including zero raw colours and 74 contrast pairs. |
| `TURBO_SCM_BASE=2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 pnpm run gate` | PASS: 13/13 tasks (seven cached), including 879 root tests and all app checks; 3m25s. |
| `pnpm run gate:full` | FAIL: five existing `test/agent-layers.test.mjs:509` cases timed out at 5,000ms; 52 tasks succeeded before Turbo stopped (224 total), seven cached; 3m20s. |
| `pnpm exec turbo run test:root --filter=//` | FAIL on standalone retry: two of the same root agent-layer cases timed out at 5,000ms; 877/879 root tests passed; 2m15s. |
| `git diff --check` | PASS. |

Earlier validation found missing dependency dist output, the token helper collision,
and two TypeScript narrowing errors; these were resolved before the final checks.
The focused evaluator run also passed all 123 tests at 100% directory coverage:
`pnpm --filter @jeswr/app-suite exec vitest run test/sheets-condformat.test.ts --coverage --coverage.include='src/apps/sheets/lib/condformat/**/*.ts'`.

The full-workspace check remains incomplete because of those root test timeouts.
The failing cases exercise disallowed path characters for module load forms; the
standalone retry failed on `module.require(TARGET)` and `module["require"](TARGET)`.
The same 879 root tests passed in the affected gate with the identical implementation.
These tests and their timeout settings are outside this lane and were not changed.

No dependencies or manifests changed, so no package-policy checks or lockfile updates
were needed. No UI was built, so screenshots, visual fixtures and Playwright specs
are not applicable. No secrets, generated dist or PNGs are committed.

The charter's roborev workflow could not run: `command -v roborev` found no binary
and this checkout has no review hook. No review tool was installed. Bead updates
remain with the dispatcher; the beads skill prohibits tracker operations from a
lane worktree, and this lane is restricted to this checkout.

Open semantic questions and the implemented conservative choices are numbered in
`QUESTIONS.md`; none blocks this implementation. No implementation work remains;
full-workspace verification and automated review have the limitations recorded above.

## Fix round 1 — numerical review findings

Commit `4a281834` (`fix(sheets): preserve conditional format precision`) addresses
all three findings against `32d40b11229dd4eae0332c75dccf3bcd2fbe5a6b`:

- Equal interpolation endpoints remain exact and interpolated anchors clamp to
  their endpoints, including percent and percentile anchors on constant ranges.
- Averages use compensated summation directly, with the existing normalized
  calculation retained only as an overflow fallback. Cells equal to the average
  no longer match or stop subsequent rules incorrectly.
- Scale fractions use direct finite differences and reserve normalization for
  overflowing spans, preserving exact midpoint colours.

Added 13 regression cases, bringing conditional-formatting tests to 136, and
updated the average calculation's API documentation. No rule semantics,
dependencies, manifests or other implementation surfaces changed. The final
documentation commit records this fix round's validation.

All commands below used `PATH=/opt/node24/bin:$PATH` (Node v24.22.1, pnpm 10.4.1).

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-condformat.test.ts --coverage --coverage.include='src/apps/sheets/lib/condformat/**/*.ts'` | PASS: 136 tests; 100% statements, branches, functions and lines. Nine regression cases reproduced the review failures before the fix. |
| `pnpm exec turbo run build --filter='@jeswr/app-suite^...'` | PASS: seven dependency builds. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS: 604 files; the same 54 warnings outside this lane. |
| `pnpm --filter @jeswr/app-suite run build` | PASS: production build and static generation. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 153 files / 7,643 tests; 100% statements, branches, functions and lines. |
| `pnpm run lint:root` | PASS, including all workspace guards. |
| `TURBO_SCM_BASE=32d40b11229dd4eae0332c75dccf3bcd2fbe5a6b pnpm run gate` | PASS: 12/12 tasks, seven cached; 2m16.518s. |
| `pnpm run gate:full` | FAIL outside this lane: `@jeswr/federation-trust#test`, delegation credential inline snapshot at `packages/federation-trust/test/characterization.test.ts:196`. 290 tasks succeeded (nine cached) out of 352 total before Turbo stopped; 10m44.694s. All 879 root tests passed. |
| `git diff --check` | PASS. |

The full-workspace failure is JSON property order in the serialized public JWK:
the snapshot expects `crv,x,kty`, while this runtime emits `kty,crv,x`.
`packages/federation-trust` has no changes relative to the supplied starting
commit. Its tests and snapshot were left unchanged to keep this fix round within
the three requested findings. Full-workspace verification therefore remains
incomplete; no requested conditional-formatting fixes remain unfinished.

The full gate generated fourteen untracked callback/client-ID files under seven
pod apps' `web/public/` directories. Those generated files were removed after the
gate; no generated assets are committed. No UI, dependency additions, package
policy checks or screenshots were required. No branches were switched, no remote
operations were run, and no other checkouts were touched.

`roborev` remains unavailable, so automated per-commit review could not run. No
review tool was installed. There are no new semantic questions for this fix
round; the original conservative interpretations remain unchanged. Tracker
updates and review of the unrelated full-workspace failure remain with the
dispatcher.

## Fix round 2 — decimal averages and equivalent scale anchors

Commit `66b47a93` (`fix(sheets): stabilize averages and scale anchors`) addresses
both findings against `c11cf40e994c294fe29143be869d92354717d41e`:

- Divide the compensated sum and its correction separately when calculating an
  average, retaining the normalized overflow fallback. Constant decimal values
  remain equal to their average and do not incorrectly stop subsequent rules.
- Calculate percentage anchor offsets by multiplying before division, using the
  same interpolation helper as percentile anchors. Exact endpoints, clamping and
  weighted overflow fallbacks remain covered. Equivalent anchors are accepted,
  and cell `14` between min and 28% anchors over 0–100 receives `#808080`.

Ten regression cases bring conditional-formatting tests to 146. They cover
positive and negative decimal populations of several sizes, subsequent styles
after `stopIfTrue`, both orders of equivalent percent/percentile anchors,
midpoint rounding, overflowing anchor products/spans and exact endpoints. Eight
cases failed before the implementation change. No rule semantics, dependencies,
manifests or unrelated implementation files changed.

All commands below used `PATH=/opt/node24/bin:$PATH`.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-condformat.test.ts --coverage --coverage.include='src/apps/sheets/lib/condformat/**/*.ts'` | PASS: 146 tests; 100% statements, branches, functions and lines. |
| `pnpm exec turbo run build --filter='@jeswr/app-suite^...'` | PASS: seven dependency builds. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS: 604 files; 54 existing warnings outside this lane. An initial formatting error in the new tests was corrected before this pass. |
| `pnpm --filter @jeswr/app-suite run build` | PASS: production build and static generation. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 153 files / 7,653 tests; 100% statements, branches, functions and lines. |
| `pnpm run lint:root` | PASS, including all workspace guards. |
| `TURBO_SCM_BASE=c11cf40e994c294fe29143be869d92354717d41e pnpm run gate` | PASS: 12/12 tasks, seven cached; 1m21.218s. |
| `pnpm run gate:full` | FAIL outside this lane: the existing delegation credential inline snapshot at `packages/federation-trust/test/characterization.test.ts:196`. 289 tasks succeeded (nine cached) out of 352 total before Turbo stopped; 8m39.018s. All 879 root tests passed. |
| `git diff --check` | PASS. |

The full-workspace failure is the same public-JWK JSON property order mismatch
recorded in fix round 1: the snapshot expects `crv,x,kty`, while the runtime emits
`kty,crv,x`. `packages/federation-trust` has no changes relative to this round's
starting commit. Its tests and snapshot remain unchanged. Full-workspace
verification is therefore incomplete; both requested numerical fixes are
complete. Fourteen untracked callback/client-ID files generated under seven pod
apps' `web/public/` directories were removed after the gate.

No dependency additions, package-policy checks, UI changes or screenshots were
required. No branches were switched, no remote operations were run, and no other
checkouts were touched. `roborev` is unavailable in this checkout, so automated
per-commit review could not run; no review tool was installed. Tracker operations
remain with the dispatcher. No new semantic questions arose in this fix round.

## Fix round 3 — percentile, fractional cutoff and overflow precision

Commit `9c3abf6c` (`fix(sheets): correct conditional format arithmetic`) addresses
all three findings against `679e37caf31539c06dd940d064b93315f52b82ce`:

- Preserve the percentile interpolation numerator and its denominator of 100,
  accepting equivalent percent/percentile anchors over two numeric samples.
- Calculate percentage selection counts as exact decimal ratios before rounding
  upward. Both top and bottom 8.8% of 375 distinct numeric cells select 33 cells,
  while genuinely larger percentages still select the additional cell.
- Keep compensated averaging for finite sums and replace the normalized overflow
  fallback with exact binary accumulation and a single rounding step. Small
  residuals survive cancellation of extreme values, preserving average comparisons
  and their `stopIfTrue` behavior, including subnormal rounding ties.

Twelve regression cases bring conditional-formatting tests to 158; eight failed
before the implementation change. Coverage remains 100% for every directory
source file. The API documentation describes the corrected arithmetic. No rule
shapes, dependencies, manifests or unrelated implementation files changed.

All commands below used `PATH=/opt/node24/bin:$PATH` (Node v24.22.1, pnpm 10.4.1).

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-condformat.test.ts --coverage.enabled=false` | Expected regression failure before implementation: eight failed, 150 passed. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-condformat.test.ts --coverage --coverage.include='src/apps/sheets/lib/condformat/**/*.ts'` | PASS: 158 tests; 100% statements, branches, functions and lines. |
| `pnpm exec turbo run build --filter='@jeswr/app-suite^...'` | PASS: seven dependency builds. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS: 604 files; the same 54 existing warnings outside this lane. |
| `pnpm --filter @jeswr/app-suite run build` | PASS: production compilation, type validation and static generation. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 153 files / 7,665 tests; 100% statements, branches, functions and lines. |
| `pnpm run lint:root` | PASS, including all workspace guards. |
| `TURBO_SCM_BASE=679e37caf31539c06dd940d064b93315f52b82ce pnpm run gate` | PASS: 12/12 tasks, seven cached; 3m0.385s. |
| `pnpm run gate:full` | FAIL outside this lane: five existing agent-layer cases timed out at 5,000ms in `test/agent-layers.test.mjs:509`. 67 tasks succeeded (eight cached), 240 total when Turbo stopped; 3m21.274s. Root tests: 874 passed, five failed. |
| `git diff --check` | PASS. |

Supplemental validation bundled the public evaluator into `/tmp` with
`pnpm --filter @jeswr/app-suite exec esbuild src/apps/sheets/lib/condformat/index.ts --bundle --platform=node --format=esm --outfile=/tmp/sst-uqvt-condformat.mjs`.
Both average rule results matched Python `Fraction` means across 1,000 synthetic
fixtures with overflowing partial sums, cancellation, residuals spanning the
finite exponent range, and probes adjacent to the average. No verification
artifacts were added to the checkout.

The full-workspace timeout failures exercise disallowed path characters for
`module.require(TARGET)`, `module["require"](TARGET)`, `require.resolve(TARGET)`,
`module.require.resolve(TARGET)`, and `createRequire(import.meta.url)(TARGET)`.
These are the same existing root-test timeout failures recorded in the original
lane validation. Both `test/agent-layers.test.mjs` and
`scripts/check-agent-layers.mjs` are unchanged relative to this round's starting
commit. Their implementation and timeout settings remain outside this fix round.
Full-workspace verification is incomplete; all three requested fixes are complete.

The final documentation commit records this fix round's validation. No dependency
additions, package-policy checks, UI changes, screenshots or generated source
artifacts were required. No branches were switched, no remote operations were
run, and no other checkouts were touched. `roborev` is unavailable, so automated
per-commit review could not run; no review tool was installed. Tracker operations
remain with the dispatcher. There are no new open questions or semantic choices
for this fix round; the existing conservative interpretations remain unchanged.

## Fix round 4 — finite cancellation and array accessors

Both findings against `409486babe850f7930e0e539d7e93ea13d7bc304` are addressed:

- `3fda0b06` (`fix(sheets): preserve finite average residuals`) uses the existing
  exact binary accumulator for finite sums as well as overflowing partial sums.
  Residuals survive cancellation across multiple magnitudes, preserving strict
  average comparisons and their `stopIfTrue` behavior. The API documentation now
  describes the calculation accurately.
- `bf463241` (`fix(sheets): reject array element accessors`) checks own element
  descriptors before reading cells, rows, rules or scale anchors. Changing and
  throwing getters, and setter-only elements, are rejected without invocation
  with the appropriate `INVALID_RANGE` or `INVALID_RULE` typed error. Existing
  early size-limit checks and sparse-array rejection remain covered.

Nine new regression cases bring conditional-formatting tests to 167. All four
finite-cancellation cases and all five accessor-location cases failed before
their corresponding implementation changes. Each accessor-location case checks
changing getters, throwing getters and setter-only descriptors. No rule shapes,
dependencies, manifests or unrelated implementation files changed.

All commands below used `PATH=/opt/node24/bin:$PATH` (Node v24.22.1, pnpm 10.4.1).

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-condformat.test.ts --coverage.enabled=false` | Expected regression failures before each fix: four average cases, then five accessor cases. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-condformat.test.ts --coverage --coverage.include='src/apps/sheets/lib/condformat/**/*.ts'` | PASS: 167 tests; 100% statements, branches, functions and lines. |
| `pnpm exec turbo run build --filter='@jeswr/app-suite^...'` | PASS: seven dependency builds. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS: 604 files; the same 54 existing warnings outside this lane. |
| `pnpm --filter @jeswr/app-suite run build` | PASS: production compilation, type validation and static generation. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 153 files / 7,674 tests; 100% statements, branches, functions and lines. |
| `pnpm run lint:root` | PASS, including all workspace guards. |
| `TURBO_SCM_BASE=409486babe850f7930e0e539d7e93ea13d7bc304 pnpm run gate` | PASS: 12/12 tasks, seven cached; 2m22.279s. |
| `pnpm run gate:full` | FAIL outside this lane: one existing agent-layer case timed out at 5,000ms in `test/agent-layers.test.mjs:509`. 53 tasks succeeded (eight cached), 222 total when Turbo stopped; 1m58.652s. Root tests: 878 passed, one failed. |
| `git diff --check` | PASS. |

The full-workspace failure exercises disallowed path characters for
`import TARGET;`, in the same group of root-test timeout failures recorded in
earlier rounds. Both `test/agent-layers.test.mjs` and
`scripts/check-agent-layers.mjs` are unchanged relative to this round's starting
commit. Their implementation and timeout settings remain outside this fix round.
Full-workspace verification is incomplete; both requested fixes are complete.

The final documentation commit records this fix round's validation. No dependency
additions, package-policy checks, UI changes or screenshots were required. No
branches were switched, no remote operations were run, and no other checkouts
were touched. `roborev` remains unavailable, so automated per-commit review could
not run; no review tool was installed. Tracker operations remain with the
dispatcher. There are no new open questions or semantic choices for this round.
