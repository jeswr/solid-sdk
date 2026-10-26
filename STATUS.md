<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-xenc — SHT-L3 cell formats

Implementation commit: `1c6b7fcd` — `feat(suite): format and parse typed sheet cells`.
This final documentation commit records verification and lane limits.

Implemented the pure TypeScript formatter/parser in
`apps/suite/src/apps/sheets/lib/format/`, with an index barrel and API documentation.
Supports General, integer/fixed decimal/grouped number, percent, ISO-code currency,
and Gregorian date/time display through Intl; locale-aware typed input parsing;
typed errors for unsupported formats/locales, malformed input and invalid values.
Added the directory's coverage glob and 127 focused unit/property tests.

## Verification

| Exact command | Result |
| --- | --- |
| `pnpm exec biome check --write apps/suite/src/apps/sheets/lib/format apps/suite/test/sheets-format.test.ts` | Pass; formatted new files, no remaining diagnostics in the new code. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-format.test.ts --coverage.include='src/apps/sheets/lib/format/**/*.ts'` | Pass: 127 tests; 100% statements, branches, functions and lines, for every file including the barrel. |
| `pnpm --filter @jeswr/app-suite run typecheck` (initial standalone attempt) | Failed because the clean checkout had no built `@jeswr/suite-ui` declarations; no new library type errors. |
| `pnpm --filter @jeswr/suite-ui run build` | Pass; built the existing workspace dependency. |
| `pnpm --filter @jeswr/app-suite run typecheck` (after dependency build) | Pass. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | Pass: production build and all 1,304 tests across 28 files; 100% coverage for all configured app library files. Lint reports 21 pre-existing non-null assertion warnings outside this change. |
| `pnpm run lint:root` | Pass, including workspace/layer/fetch/token guards and 74 contrast pairs. |
| `git -c commit.gpgsign=false -c user.name='Jesse Wright' -c user.email=63333554+jeswr@users.noreply.github.com merge --no-edit origin/main` | Already up to date. Local `origin/main` is `8865b4b3e01bdb91ab0f102683e0833f786c65cf`, the supplied base; performed before final gates. |
| `TURBO_SCM_BASE=8865b4b3e01bdb91ab0f102683e0833f786c65cf pnpm run gate` | Pass: 7/7 tasks (root checks/tests, dependency build, app lint/build/typecheck/test). |
| `pnpm run gate:full` | Failed outside lane scope: `@jeswr/federation-codegen#test` has 2 failing tests (23 passed); Turbo reports 213 successful tasks of 289 before stopping. Details below. |

No dependencies added; `check:packages` is not applicable. No manifest or lockfile
changes. No UI components built; screenshots, fixture routes, axe and Playwright
are not applicable to this pure library task.

## Limits and questions

The conservative interpretations of currency-code grammar, UTC minute date values,
percent aliases and fail-closed parsing are recorded in `QUESTIONS.md` and the
library README. There are no implementation blockers under those interpretations.

The full-workspace gate remains blocked by existing namespace drift in
`tools/federation-codegen/test/generator.test.ts`: the target-class expectation is
`https://w3id.org/jeswr/sectors/bookmarks#Bookmark`, while the vocabulary now supplies
`https://jeswr.org/ns/sectors/bookmarks#Bookmark`. The committed-output regeneration
test also fails on the corresponding `ontology.ttl` namespace drift. These paths
are unchanged relative to the supplied base; the old expectation is present in
base commit `8865b4b3e01bdb91ab0f102683e0833f786c65cf`. No unrelated files were edited.
Gate logs from this run are `/tmp/sst-xenc-gate.log`,
`/tmp/sst-xenc-gate-full.log`, and `/tmp/sst-xenc-lint-root.log`.

Per-commit roborev could not run: `roborev` is absent from PATH and this checkout has
no post-commit hook. Existing `.roborev.toml` was retained; dispatcher review remains
outstanding. The managed cloud environment status tool is not exposed in this session.

## Review fix round 1

Commit subject: `fix(suite): correct locale input parsing`.

Fixed only the three reported locale parsing defects. Date format hints select
fixed date/time patterns; without a date hint, parsing accepts a unique valid
interpretation and rejects conflicting fixed/locale calendar dates. Group discovery
explicitly enables grouping and handles an absent separator. Locale date literals
accept equivalent Unicode space separators while retaining exact field widths,
punctuation and calendar validation. Added five regression cases (132 focused
tests total), including Intl output and absent-grouping fallback coverage.

| Exact command | Result |
| --- | --- |
| `pnpm exec biome check --write apps/suite/src/apps/sheets/lib/format apps/suite/test/sheets-format.test.ts` | Pass. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-format.test.ts --coverage.include='src/apps/sheets/lib/format/**/*.ts'` | Pass: 132 tests; 100% statements, branches, functions and lines. |
| `pnpm --filter @jeswr/suite-ui run build` | Pass; prepared existing workspace dependency. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | Pass: 1,309 tests across 28 files; 100% configured coverage. Lint retains 21 pre-existing warnings outside the fix. |
| `pnpm run lint:root` | Pass. |
| `TURBO_SCM_BASE=effb18e1488a5775efd8a13dc13edb9f7be0b306 pnpm run gate` | Pass: 6/6 tasks. |
| `pnpm run gate:full` | Failed at the same two pre-existing `@jeswr/federation-codegen#test` namespace tests documented above (23 passed); 286/347 tasks succeeded before Turbo stopped. |

No dependencies added or remote operations performed. All three review findings
are addressed; no new open questions. Per-commit roborev remains unavailable
because its executable is absent. Review-fix logs use the prefix
`/tmp/sst-xenc-fix-` (`lint`, `build`, `typecheck`, `test`, `lint-root`, `gate`,
and `gate-full`, all with `.log` extension).

## Review fix round 2

Implementation commit: `81d2c5ec` — `fix(suite): preserve numeric markers in text labels`.

Addressed the single text-parsing finding. Numeric candidate detection now precedes
strict percent/currency validation, and nonfinite keywords match complete inputs.
Ordinary labels such as `Growth %`, `Budget $`, and `Infinity pool` retain their
original text and whitespace, including under numeric format hints. Numeric-leading
inputs and numeric prefixes still undergo strict validation; malformed percent,
currency, grouping, precision and nonfinite inputs remain typed errors. Added 20
regression cases across four locales; no dependencies or unrelated code changed.

| Exact command | Result |
| --- | --- |
| `pnpm exec biome check apps/suite/src/apps/sheets/lib/format/parse.ts apps/suite/test/sheets-format.test.ts` | Pass. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-format.test.ts --coverage.include='src/apps/sheets/lib/format/**/*.ts'` | Pass: 152 tests; 100% statements, branches, functions and lines. |
| `pnpm --filter @jeswr/suite-ui run build` | Pass; prepared the existing workspace dependency. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | Pass: 1,329 tests across 28 files; 100% configured coverage. Lint retains 21 pre-existing warnings outside the fix. |
| `pnpm run lint:root` | Pass. |
| `TURBO_SCM_BASE=0e5ca1e02e768c7a5a7f78c96324d1784001b21d pnpm run gate` | Pass: 6/6 tasks. |
| `pnpm run gate:full` | Failed at the same two pre-existing `@jeswr/federation-codegen#test` namespace tests documented above (23 passed); 214/290 tasks succeeded before Turbo stopped. The generator test and committed ontology remain unchanged from this round's base. |

No remote operations performed. No UI changes or dependency checks required. The
finding is addressed with no new open questions. Per-commit roborev remains
unavailable because its executable is absent; the supplied review was read and
addressed. Validation logs use `/tmp/sst-xenc-fix2-` with the suffixes
`dependency-build`, `lint`, `build`, `typecheck`, `test`, `lint-root`, `gate` and
`gate-full` (each ending in `.log`).

## Review fix round 3

Implementation commit: `b917fc04` — `fix(suite): parse signed currencies and preserve labels`.

Addressed both findings from `solid-sdk-lane-sst-xenc-62ed55515029.md`.
Currency candidate detection accepts signs after ISO codes while the existing Intl
affix templates still validate placement, grouping and signs. Digit normalization
is separate from mixed-digit validation: ordinary labels preserve their original
text, while numeric and date candidates reject mixed ASCII/native digits.
Added 13 regression cases covering Dutch and Frisian currency displays, explicit
positive signs, negative zero, malformed currencies, mixed-digit labels and typed
values, and text such as `USD + EUR` (165 focused tests total).

| Exact command | Result |
| --- | --- |
| `pnpm exec biome check apps/suite/src/apps/sheets/lib/format/parse.ts apps/suite/test/sheets-format.test.ts` | Pass. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-format.test.ts --coverage.include='src/apps/sheets/lib/format/**/*.ts'` | New regressions reproduced both findings before the fix; final run passes all 165 tests with 100% statements, branches, functions and lines. |
| `pnpm --filter @jeswr/suite-ui run build` | Pass; prepared the existing workspace dependency. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | Pass on the final revision: 1,342 tests across 28 files, 100% configured coverage. Lint retains 21 existing warnings outside the fix. |
| `pnpm run lint:root` | Pass. |
| `TURBO_SCM_BASE=0e5ca1e02e768c7a5a7f78c96324d1784001b21d pnpm run gate` (initial run) | Failed: two unchanged `test/agent-layers.test.mjs` cases exceeded their 5-second timeout (684 tests passed); 4/6 tasks succeeded. |
| `pnpm exec turbo run test:root --concurrency=1` | Pass: all 686 root tests across 7 files. |
| `TURBO_SCM_BASE=0e5ca1e02e768c7a5a7f78c96324d1784001b21d pnpm run gate` (final retry) | Pass: 7/7 tasks. |
| `pnpm run gate:full` (final revision) | Failed at the same two existing `@jeswr/federation-codegen#test` namespace tests documented above (23 passed); 191/348 tasks succeeded, 118 cached. The failing codegen files and root agent-layer tests are unchanged from the supplied base. |

No dependencies or UI changes; dependency checks and screenshots are not applicable.
No remote operations performed. Removed only untracked callback/client-ID assets
generated by other apps during the full gate. Both review findings are addressed;
no unfinished implementation work or open questions. Full-workspace verification
remains blocked by the existing federation-codegen failures. Per-commit roborev
remains unavailable because its executable is absent; the supplied review was read
in full and addressed.

Validation logs use `/tmp/sst-xenc-fix3-` with suffixes `regressions-before`,
`focused`, `dependency-build`, `lint`, `build`, `typecheck`, `test`, `lint-root`,
`gate`, `root-retry`, `gate-retry`, `gate-full`, and `gate-full-final`
(each ending in `.log`). This STATUS.md update is committed last.

## Review fix round 4 (final)

Implementation commit: `e2a1fb27` — `fix(suite): parse decimal-leading currency amounts`.

Addressed the single finding from `solid-sdk-lane-sst-xenc-51d53432d490.md`.
Currency candidate detection now recognizes decimal-leading amounts after ISO codes
and optional signs. The existing number parser validates locale separators, signs,
affixes and precision. Added 14 regression cases covering `.50` in en-US, `,50` in
nl-NL, explicit signs, malformed fractions and incorrect locale separators.
The change is limited to the candidate check and its regression tests.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-format.test.ts --coverage.include='src/apps/sheets/lib/format/**/*.ts'` (before fix) | Reproduced the finding: 12 new cases failed, 167 tests passed. |
| `pnpm exec biome check apps/suite/src/apps/sheets/lib/format/parse.ts apps/suite/test/sheets-format.test.ts` | Pass. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/sheets-format.test.ts --coverage.include='src/apps/sheets/lib/format/**/*.ts'` (after fix) | Pass: 179 tests; 100% statements, branches, functions and lines. |
| `pnpm --filter @jeswr/suite-ui run build` | Pass; prepared the existing workspace dependency. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | Pass: 1,356 tests across 28 files; 100% configured coverage. Lint retains 21 existing warnings outside the fix. |
| `pnpm run lint:root` | Pass. |
| `TURBO_SCM_BASE=0e5ca1e02e768c7a5a7f78c96324d1784001b21d pnpm run gate` | Pass: 7/7 tasks, including all 686 root tests. |
| `pnpm run gate:full` | Failed at the same two existing `@jeswr/federation-codegen#test` namespace tests documented above (23 passed); 252/320 tasks succeeded before Turbo stopped. The failing generator tests and committed outputs are unchanged from the supplied base. |

No dependencies or UI changes; dependency checks and screenshots are not applicable.
No remote operations performed. The review finding is addressed with no unfinished
implementation work or open questions. Full-workspace verification remains blocked
by the existing federation-codegen failures. Removed only untracked callback/client-ID
assets generated by other apps during the full gate. Per-commit roborev remains unavailable
because its executable is absent; the supplied review was read in full and addressed.

Validation logs use `/tmp/sst-xenc-fix4-` with suffixes `regressions-before`,
`focused`, `dependency-build`, `lint`, `build`, `typecheck`, `test`, `lint-root`,
`gate`, and `gate-full` (each ending in `.log`). This STATUS.md update is committed last.
