<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# MON-L6 lane report — sst-3zgu

Branch: `lane/sst-3zgu`. Base: `9d38e053caf7381de3b97b5d79075647f55d6a05`.

Implementation commit: `afe8c1ff` — `feat(suite): add transfer matching and transaction splits`.
Final documentation commit: `docs(suite): record MON-L6 validation` (this report).

Added a pure TypeScript library under
`apps/suite/src/apps/money/lib/transfers/` with an `index.ts` barrel:

- Exact, same-currency transfer suggestions across explicitly scoped owned
  financial accounts, within an inclusive explicit calendar-day window.
  Mutual sole candidates become one-to-one pairs; competing candidates are
  reported without nearest-date or greedy guesses. Independent unique pairs
  remain available alongside ambiguity reports.
- Category splits with signed safe integer minor units and exact BigInt sums.
  Merge/unsplit revalidates parts and restores a copy of the complete original.
- Typed, value-redacted errors for malformed/unsupported inputs. No input
  mutation, React, hooks, fetch, RDF, persistence, new dependencies or UI.
- 96 synthetic unit tests and the required directory coverage glob.

The existing Money rules `MoneyTransaction` DTO is reused as a type; its older
two-account detector is unchanged. Conservative interpretations and their spec
references/options are recorded in `QUESTIONS.md`: explicit day window,
mutual-unique matching with all competing candidates reported, and merge as
the inverse of splitting one original rather than merging unrelated entries.
These questions do not block the implemented pure-library scope.

Validation (2026-10-26, Node v24.22.1):

| Exact command | Result |
| --- | --- |
| `pnpm exec biome check --write apps/suite/src/apps/money/lib/transfers apps/suite/test/money-transfers.test.ts` | PASS; new code/test files have no warnings. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/money-transfers.test.ts --coverage.include='src/apps/money/lib/transfers/**/*.ts'` | PASS; 96 tests; 100% statements, branches, functions and lines across the directory. |
| `pnpm exec turbo run build --filter='@jeswr/app-suite^...'` | PASS; four dependency builds, needed for this clean checkout's generated declarations. |
| `git -c commit.gpgsign=false merge origin/main` | PASS; already up to date. The local ref points to the base commit; no fetch or network merge. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; production build/typecheck green, 72 files and 4,380 tests pass; all configured coverage 100%. Lint reports 40 existing non-null-assertion warnings outside this change. |
| `pnpm run lint:root` | PASS; workspace, layer, transport, fetch, tokens, contrast and agent-layer guards pass. |
| `TURBO_SCM_BASE=9d38e053caf7381de3b97b5d79075647f55d6a05 pnpm run gate` | PASS; 10/10 tasks, four cached; includes 745 root tests and all 4,380 app tests. |
| `pnpm run gate:full` | FAIL outside lane scope: 310 successful / 362 total tasks, nine cached, before Turbo stopped on `@jeswr/federation-trust#test`. Details below. |
| `pnpm --filter @jeswr/federation-trust exec vitest run test/characterization.test.ts` | Reproduces the same unrelated failure: 19 tests pass, one snapshot fails at line 196. |
| `git diff 9d38e053caf7381de3b97b5d79075647f55d6a05 -- packages/federation-trust` | Empty: failing package is unchanged from the lane base. |
| `git diff --check` | PASS. |

The first focused test run exposed two table-driven test fixtures that Vitest
expanded as argument rows; corrected the fixtures before the implementation
commit. Subsequent focused and complete app test runs pass.

Full-workspace gate blocker: `packages/federation-trust/test/characterization.test.ts:196`,
`delegation credential structure is stable`, expects its serialized public
`delegateKey` JWK fields in `crv,x,kty` order; the runtime emits `kty,crv,x`.
The snapshot mismatch reproduces independently and the package is unchanged
from the base. No snapshot or unrelated package code was edited. Turbo aborted
the remaining full-workspace tasks. Build-generated, untracked `clientid.jsonld`
and `callback.html` files in the eight `apps/pod-*/web/public/` directories were
removed after validation; no generated assets are committed.

Dependency policy: no dependencies or manifests changed; no `check:packages`
commands were necessary. No install or lifecycle scripts were enabled.

Screenshots/e2e: none; this task renders no UI or component state, so visual
mockup comparison, fixture routes and browser checks do not apply. Chromium was
not launched.

Review limitation: `roborev status` exits 127 (`roborev: command not found`),
and the checkout has no post-commit hook. Automated review verdicts could not
be obtained; no review tooling was installed. Manual review and the required
app/affected checks are complete. Full-workspace validation is recorded above.

No implementation work is unfinished. No push, PR, branch switch, remote fetch,
other-checkout mutation or dependency addition was performed. Remaining
validation limitations are the unrelated full-gate snapshot failure and the
unavailable roborev executable.
