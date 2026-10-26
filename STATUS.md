<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-esit — MON-L1 lane report

Implemented on `lane/sst-esit`, based on `606c87b7edf73e83f118f95295b0eeda7abb6d92`. No branch switches, pushes, PRs, dependency additions or changes to other checkouts.

## Commits

- `4a519fc9` — `docs: record bank import interpretations`: numbered specification questions and conservative defaults.
- `e54ec44d` — `feat: add pure bank statement import and categorisation`: dependency-free CSV and OFX/QFX parsing, exact decimal/date utilities, duplicate candidates with hash-collision verification, literal categorisation rules, public types/barrel and usage documentation.
- `8e79daf5` — `test: enforce complete bank import coverage`: synthetic fixtures, 136 import tests, and ordinary app-test enforcement of 100% per-file coverage for the import directory. Together with the existing fixture-access test, the app runs 137 tests.
- Final `docs: record bank import lane validation` commit — this report.

## Validation

All commands ran inside this checkout. No browser was launched.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; builds the existing workspace dependency needed for app declarations/fonts. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS (exit 0). Biome: 22 files; Next.js production build and strict TypeScript: green; 137 tests passed. |
| `pnpm run lint:root` | PASS (exit 0). Includes workspace/lockfile/fetch/token guards and 74 contrast pairs with 0 failures. |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | PASS (exit 0), 7/7 tasks. Log: `/tmp/sst-esit-gate.log`. |
| `pnpm run gate:full` | FAIL (exit 1), 13 successful tasks before interruption; failed task: `@jeswr/unstorage-solid#build`. Its unchanged dependency-build script invokes a temporary external clone/install, then npm fails with `EROFS` opening `/home/runner/.npm/_cacache/tmp/...`. No retry or change to this unrelated package. Log: `/tmp/sst-esit-gate-full.log`. |
| `git diff --check` | PASS. |
| `command -v roborev` | Unavailable; no automatic review verdicts could be requested/read. |

Coverage from the app's normal `test` command: **302/302 statements, 307/307 branches, 37/37 functions, 257/257 lines (100% each)** across `src/apps/money/lib/import/**/*.ts`. Every executable source file is individually at 100%; the barrel and type-only file have no instrumentable statements. No coverage ignore directives or exclusions. Machine-readable reports are generated in the ignored `apps/suite/coverage/` directory. Coverage uses the Vitest V8 provider already resolved in the workspace lockfile; no manifests or lockfile changed.

Early development runs identified two incorrect test expectations (an ambiguous headerless delimiter needs an explicit choice; duplicate candidates preserve the original amount text) and missing negative-path coverage; corrected before the successful checks above. A preliminary app-only typecheck before dependency build failed on missing `@jeswr/suite-ui` declarations; building that existing dependency resolved it. No remaining app failures.

## Scope, dependencies and fixtures

- All implementation is plain synchronous TypeScript under the requested directory; tests/fixtures live under `apps/suite/test/`, with coverage enforcement in the app's existing Vitest config.
- CSV supports mapped headers/indices, headerless input, delimiters/date-format sniffing, quoting, signed amounts or debit/credit columns, explicit decimal separators and optional currency.
- OFX/QFX supports 1.x SGML and 2.x XML bank/credit-card records, statement metadata, posting dates, entities and CDATA; rejects malformed input and DTD/custom entity declarations without I/O.
- Duplicate detection returns review candidates; rules use ordered literal description matchers and inclusive exact amount ranges without mutation.
- Fixtures contain fictional merchants/people/accounts and `example.org` URLs only. Includes 100-row CSV import, round-trip composition of parsing/deduplication/rules, malformed input and a real synthetic FNV hash collision.
- `check:packages`: not applicable; no new third-party dependency added. No lifecycle scripts enabled.
- Screenshots / axe / Playwright specs: not applicable; this pure-library task renders no UI. No screenshots taken and no fixture routes added. Mockup screenshot instructions therefore have no rendered component to check.
- New source files carry the required provenance marker; commits use the required author identity and trailer. No `dist/`, credentials or generated build artifacts committed. The project inventory is unchanged.

## Unfinished and questions

Implementation and app acceptance checks are complete. Full-workspace validation remains blocked by the unrelated `unstorage-solid` build/cache restriction, and roborev review is unavailable in this environment.

The nonblocking specification questions and implemented conservative choices are in `QUESTIONS.md`: explicit selection for ambiguous dates, account/currency-scoped duplicate candidates, first matching rule with existing categories preserved, exact decimal strings and no invented currency default. There are no unanswered questions blocking this lane.

## Fix round 1 — review of f0f1d7cdfd46

Scope: exactly the four OFX/QFX review findings, regression tests, importer documentation and this required validation report. No dependencies or manifests changed.

Commits:

- `cfd42bd7` — `fix: validate OFX amounts and unsupported records`: validate OFX numeric syntax before canonicalising decimal commas/points; reject grouping and accounting notation; reject transaction `CURRENCY` overrides and either correction marker atomically; keep `ORIGCURRENCY` amounts in statement currency; accept dotted QFX extension tags in opening/closing patterns. Adds 24 regression cases and synthetic QFX institution metadata fixtures.
- Final `docs: record OFX review fix validation` commit — this fix-round report.

Conservative choices explicitly allowed by the review: transaction currency overrides and correction records reject the entire import until supported. Empty markers also reject. No transaction schema or duplicate-handling policy changes.

Validation commands below ran before the final report commit; command output is redirected to the listed temporary logs.

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec biome check --write src/apps/money/lib/import/ofx.ts test/money-import.test.ts test/fixtures/money-statements.ts` | PASS; formatted one test file. |
| `pnpm --filter @jeswr/app-suite run test` | PASS; 161 tests. Log: `/tmp/sst-esit-fix-test.log`. |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; existing workspace dependency. Log: `/tmp/sst-esit-fix-dependency-build.log`. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; production build, lint, strict types and 161 tests. Log: `/tmp/sst-esit-fix-package-gate.log`. |
| `pnpm run lint:root` | PASS, including 74 contrast pairs. Log: `/tmp/sst-esit-fix-root-lint.log`. |
| `TURBO_SCM_BASE=f0f1d7cdfd46e65a5d28138520ee0ce498f342d2 pnpm run gate` | PASS; 6/6 tasks. Log: `/tmp/sst-esit-fix-affected-gate.log`. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full` | FAIL; 25 successful tasks; unchanged `@jeswr/unstorage-solid#build` failed with npm `EROFS` at `/home/runner/.npm/_cacache/tmp/...`. Turbo's strict environment filtered the protocol guard, so the dependency script performed its temporary remote clone before failing; its `finally` cleanup removed that temporary checkout. Log: `/tmp/sst-esit-fix-full-gate.log`. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | BLOCKED as intended by the lane's no-remote restriction: the unchanged `unstorage-solid` dependency script attempts `git clone` over HTTPS, rejected with `fatal: transport 'https' not allowed`. No network clone in this retry. Log: `/tmp/sst-esit-fix-full-gate-guarded.log`. |
| `git diff --check` | PASS. |
| `command -v roborev` | Unavailable; automated per-commit review cannot run. |

Coverage remains **100% statements (311/311), branches (315/315), functions (40/40) and lines (264/264)** across the import directory, enforced per executable source file by the ordinary app test command. Regression cases cover both SGML and XML decimal commas, exact precision, grouping rejection, atomic currency/correction rejection after valid records, incomplete correction metadata, `ORIGCURRENCY`, and QFX `INTU.BID` with implicit/explicit closing tags.

All four requested findings are addressed. No UI, screenshots, dependency checks or new specification questions apply. Package and affected gates pass. Full-workspace validation remains blocked by an unrelated dependency build that requires a remote clone and an unwritable npm cache; roborev remains unavailable. No unrelated source changes were made to work around those limitations.

## Fix round 2 — review of 9def91cfea4a

Scope: the single PAYEE description finding and its regression tests. No dependencies, manifests, UI or unrelated source files changed.

Commits:

- `8d94c286` — `fix: preserve OFX payee descriptions`: read and validate the PAYEE aggregate and its NAME field before falling back to MEMO. Reject duplicate aggregates, duplicate/nested NAME fields and scalar PAYEE text. Add 18 SGML/XML regression cases for payees with and without memos, empty-name fallback, malformed records, description precedence, duplicate detection and categorisation.
- Final `docs: record OFX payee fix validation` commit — this required report.

Conservative choice: preserve direct NAME precedence if both alternatives are supplied; otherwise use PAYEE/NAME before MEMO. Empty payee names retain the existing memo fallback and missing-description rejection. Memo remains available separately on the transaction.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite run test` (new regressions before implementation) | Expected FAIL; 11 new regression failures reproduced description loss and missing validation. Log: `/tmp/sst-esit-r2-red.log`. |
| `pnpm --filter @jeswr/app-suite exec biome check --write src/apps/money/lib/import/ofx.ts test/money-import.test.ts` | PASS; formatted the test file. |
| `pnpm --filter @jeswr/app-suite run test` (after fix) | PASS; 179 tests, including all 18 new cases. Log: `/tmp/sst-esit-r2-test.log`. |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; existing workspace dependency. Log: `/tmp/sst-esit-r2-dependency-build.log`. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS (exit 0); lint, Next.js production build, strict typecheck and 179 tests. |
| `pnpm run lint:root` | PASS (exit 0), including 74 contrast pairs with zero failures. Log: `/tmp/sst-esit-r2-root-lint.log`. |
| `TURBO_SCM_BASE=9def91cfea4a68b507f1c1b9e93659bec888a6e5 pnpm run gate` | PASS (exit 0); 6/6 tasks. Log: `/tmp/sst-esit-r2-affected-gate.log`. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | FAIL (exit 1); 12 successful tasks before the unchanged `@jeswr/unstorage-solid#build` failed. Its dependency script attempts an HTTPS clone, blocked by the protocol guard with `fatal: transport 'https' not allowed`; no remote clone completed. Log: `/tmp/sst-esit-r2-full-gate.log`. |
| `git diff --check` | PASS. |
| `command -v roborev` | Unavailable; automated per-commit review cannot run. |

Import-directory coverage remains **100% statements (317/317), branches (322/322), functions (42/42) and lines (268/268)**, enforced by the ordinary app test command. All checks ran in this checkout before the final report commit. No dependency additions, screenshots, browser runs, pushes or branch switches. No generated artifacts committed.

The requested finding is addressed. No implementation work or open questions remain. Package and affected gates pass; full-workspace validation and roborev retain the unrelated environmental limitations above.
