<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Lane report — sst-jge7 / MON-L3

Implemented on `lane/sst-jge7`, based on `302faf455f37e31ba6855975ad8dc34eb7ad06d0`.

## Commits

- `35949636 docs: record money rule interpretations` — records the conservative interpretations and maintainer questions before implementation.
- `9f5bea02 feat: add money rules and reconciliation` — pure TypeScript library in `apps/suite/src/apps/money/lib/rules/`, index barrel, public DTOs, typed errors, API documentation, 132 unit tests and its own coverage glob.
- Final `docs: record money lane validation` commit — this status report, committed last.

## Delivered

- Categorisation: case-sensitive payee/memo literal contains and regex-free whole-field glob (`*`, `?`, Unicode code points), inclusive signed amount ranges, exact account conditions, AND semantics, first match by ascending numeric priority with stable ties, category assignment and payee rename.
- Transfers: two explicit accounts, equal opposite nonzero minor-unit amounts, same currency and inclusive calendar-day tolerance; unique one-to-one pairs; ambiguity throws rather than guesses.
- Reconciliation: explicit opening balance and statement cutoff; cleared/reconciled balance, statement-minus-cleared difference, and cleared IDs to mark only when balanced. Exact integer summation and typed overflow rejection.
- Fail-closed validation of every supplied transaction/rule, strict dates and safe integer amounts, unknown fields/unsupported glob rejection, duplicate IDs rejected, error messages without private input values, immutable inputs and synthetic example.org fixtures.

## Validation

All commands ran from this checkout. No lifecycle scripts were enabled.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; builds the existing workspace dependency's ignored dist for type resolution. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; 15 test files, 519 tests, including 132 money tests. |
| `pnpm run lint:root` | PASS; workspace/transport/layer/fetch/token guards and all 74 contrast pairs pass. |
| `TURBO_SCM_BASE=302faf455f37e31ba6855975ad8dc34eb7ad06d0 pnpm run gate` | PASS; 7/7 Turbo tasks; app tests above plus 341 root tests. |
| `pnpm run gate:full` | FAIL outside changed code: `@jeswr/unstorage-solid#build` invokes its existing external fetch-rdf build helper, which clones into a temporary directory and runs `npm install --no-audit --no-fund --ignore-scripts --prefer-offline`. npm fails with `EROFS` writing `/home/runner/.npm/_cacache/tmp/`. Turbo stops with 16 successful / 58 scheduled tasks. No retry of this external-cloning helper or unrelated changes were made. |
| `git diff --check` | PASS. |

Coverage: money rules directory has **100% statements, branches, functions and lines**,
enforced per executable file by the existing V8 coverage thresholds. The coverage summary
reports 154/154 statements, 101/101 branches, 23/23 functions and 138/138 lines for this
directory; the barrel and type-only file have no executable counters.

Initial exploratory test runs exposed a test error-code expectation that was corrected;
an early typecheck required building the existing suite-ui dependency first. Final checks
above pass. A manual algorithm review also found and fixed wildcard handling when the
input text itself contains `*`, with regression tests committed.

No dependencies or manifests changed, so `check:packages` and lockfile changes are not
applicable. No projects were added; suite.json is unchanged. No UI was built, so dev routes,
Playwright specs, axe UI checks and screenshots are not applicable; Chromium was not launched.

Local diagnostic logs (uncommitted): `/tmp/sst-jge7-lint-root.log`,
`/tmp/sst-jge7-gate.log`, `/tmp/sst-jge7-gate-full.log`, `/tmp/sst-jge7-app-test.log`.

## Unfinished / open questions

- Implementation and acceptance checks for the changed app are complete.
- Full workspace gate remains unverified because of the unrelated sandbox failure above.
- Roborev review remains outstanding: `roborev` is not installed (`command -v roborev` found no executable). No review tool was installed and no review verdict is claimed.
- `QUESTIONS.md` records the unspecified priority/text defaults, ambiguity rejection, and opening-balance/marking convention. Conservative interpretations are implemented and documented; none blocks use of the pure library.
- No push, PR, branch switch, merge, or changes to other checkouts were made.
