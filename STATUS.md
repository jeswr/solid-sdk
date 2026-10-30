<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-l41u — TSK-L6 Todoist CSV import

Completed 2026-10-27 UTC on `lane/sst-l41u`, based on
`2c99c9d2202c6b18c38c88ed1524fcb3d2efd460`. Implementation and application
acceptance checks pass. The full workspace gate fails in an untouched package,
as detailed below. No push, PR, branch switch or remote fetch was performed.

## Commits

- `b7cb1c24` — `docs: record Todoist import interpretations`: conservative
  interpretations in [QUESTIONS.md](QUESTIONS.md).
- `f17aef38` — `feat(tasks): import Todoist template CSV drafts`: pure importer,
  exported types/error/limits, RFC quoting and line tracking, sections, parent
  references, order keys, comments, labels, zoned dates and duration validation.
- `7dd646c4` — `test(tasks): cover Todoist import behavior and limits`: synthetic
  unit fixtures and the directory coverage glob.
- `13831500` — `fix(tasks): preserve literal dates and Markdown code`: retain
  year-prefixed natural-language dates; preserve fenced/indented code and escapes.
- `a2f569c6` — `fix(tasks): bound Todoist text scanning cost`: remove regex
  backtracking paths and add long decimal/fence regressions.
- The final `docs: record Todoist import lane validation` commit contains this report.

## Validation

Commands below used Node `v24.22.1` and pnpm `10.4.1`; the explicit PATH selects
the installed Node 24 toolchain. Dependency lifecycle scripts remained disabled.

```sh
env PATH=/opt/node24/bin:$PATH pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4
```

PASS: 7 dependency builds. An earlier direct typecheck had reported missing
workspace declarations before these ignored `dist/` outputs were built.

```sh
env PATH=/opt/node24/bin:$PATH bash -c 'pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test'
```

PASS on `7dd646c4`: lint, production build, typecheck and 7,653 tests. Lint reports
54 existing warnings. The final affected gate below reran all four app commands
after both subsequent fixes, passing 7,662 tests across 153 test files.

```sh
env PATH=/opt/node24/bin:$PATH TZ=Pacific/Honolulu pnpm --filter @jeswr/app-suite exec vitest run test/tasks-todoist.test.ts --coverage.include='src/apps/tasks/lib/todoist/**/*.ts'
```

PASS on `a2f569c6`: 155 importer tests; directory statements, branches, functions
and lines all 100% (282 statements, 244 branches, 17 functions, 240 lines).
Tests cover every exported error code and both size limits at bound and bound+1,
including UTF-8 multibyte input and multiline CSV records. The injected timezone
is independent of the host timezone.

```sh
env PATH=/opt/node24/bin:$PATH pnpm run lint:root
git merge --no-edit origin/main
env PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 pnpm run gate
```

PASS: standalone root lint and the final affected gate on `a2f569c6`.
Turbo reports **13 successful / 13 total**, 7 cached, in 2m32.402s. App lint,
build, typecheck and all 7,662 tests pass; root tests pass 879 tests in 12 files.
`origin/main` is already contained in the branch at the supplied base, so the
prescribed merge reports `Already up to date.` A preliminary gate attempt hit
an overlapping Next build lock; subsequent serial runs pass.

```sh
env PATH=/opt/node24/bin:$PATH pnpm run gate:full
```

FAIL on final revision `a2f569c6`: `@jeswr/federation-trust#test`, specifically
`test/characterization.test.ts:196`, “delegation credential structure is stable”.
Its inline snapshot compares serialized `delegateKey` JSON property order:
expected `crv,x,kty`, received `kty,crv,x`. Turbo reports 204 successful / 254 total,
200 cached, before stopping. No federation-trust sources or dependencies were changed.

An earlier full run on `13831500` stopped at two five-second timeouts in
`packages/suite-ui/test/navigation.test.ts:135` and `:159` (300 successful /
362 total). These were checked separately:

```sh
env PATH=/opt/node24/bin:$PATH pnpm --filter @jeswr/suite-ui run test
env PATH=/opt/node24/bin:$PATH pnpm --filter @jeswr/federation-trust run test
```

- suite-ui: PASS, all 196 tests across 8 files.
- federation-trust: FAIL, the same snapshot mismatch; 53 pass and 1 fails.

Logs are in `/tmp/sst-l41u-{app-gate,lint-root,gate-final-linear,gate-full,gate-full-final,todoist-tests-final,suite-ui-test,federation-trust-test}.log`.

## Scope, remaining items and questions

- No implementation work remains. Conservative choices are documented in
  [QUESTIONS.md](QUESTIONS.md) and the importer README; no blocking questions.
- Full-workspace validation remains blocked by the unrelated federation-trust
  snapshot failure. No unrelated source fixes or snapshot updates were made.
- Automated commit review is unavailable: `command -v roborev` exits 1, and this
  lane has no installed post-commit review hook. No roborev verdicts were obtained.
- No dependencies were added; `check:packages` is not applicable. No manifest,
  lockfile or suite inventory changes were needed.
- Screenshots, visual fixture routes, axe and Playwright: not applicable to this
  pure-library task. No browser was launched.
- Untracked callback/client-ID files generated by the full gate were removed;
  no generated `dist/`, coverage or image artifacts are committed.
- Bead closure belongs to the dispatcher after integration; no tracker operations
  were performed from this lane checkout.

## Fix round 1 — review of `42319ca5`

Addressed exactly the four supplied findings on `lane/sst-l41u`:

- `0032d9fa` — `fix(tasks): accept absent Todoist durations`: empty DURATION
  with the exact `None` marker is absent; nonempty amounts with `None` and
  unsupported marker spellings still fail. Added regression tests and README copy.
- `1259f6a4` — `fix(tasks): bound Todoist timezone formatters`: case-fold timezone
  keys before formatter construction and retain at most 32 cached formatters per
  import, evicting the oldest. Preserve supplied timezone text in drafts. Tests
  exercise 64 case variants, capacity eviction and date results after eviction.
- `9b4f924a` — `fix(tasks): preserve backtick fenced content`: separate fences
  from inline spans, require line-based matching closers with sufficient width,
  and preserve literal labels inside code. Tests include longer/shorter closers,
  trailing text, indentation, unclosed blocks and LF/CRLF/CR endings.
- `72152283` — `fix(tasks): type boundary date errors`: detect nonfinite timezone
  samples before another formatting call. The conservative choice is to reject
  unsupported samples with `INVALID_DATE`; supported adjacent and explicit-offset
  dates still parse. Added typed-error and accepted-boundary regressions.
- The final `docs: record Todoist review fixes` commit contains this validation
  report and updates the historical duration interpretation in `QUESTIONS.md`.

All commands used Node `v24.22.1`, pnpm `10.4.1`, and disabled dependency lifecycle
scripts. Final checks ran on `72152283` before this documentation-only commit.

```sh
env PATH=/opt/node24/bin:$PATH TZ=Pacific/Honolulu pnpm --filter @jeswr/app-suite exec vitest run test/tasks-todoist.test.ts --coverage.include='src/apps/tasks/lib/todoist/**/*.ts'
```

PASS: 180 importer tests; 100% statements (293), branches (257), functions (19)
and lines (249). Host timezone remains independent of the supplied timezone.

```sh
env PATH=/opt/node24/bin:$PATH pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4
env PATH=/opt/node24/bin:$PATH bash -c 'pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test'
env PATH=/opt/node24/bin:$PATH pnpm run lint:root
env PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=42319ca5f261f54c502a1b3c608dd18747d58d07 pnpm run gate
```

PASS: 7 dependency builds; application lint, production build, typecheck and all
7,687 tests across 153 files; root lint; affected gate **12 successful / 12 total**,
7 cached, in 2m30.705s. All configured application coverage thresholds pass.
Application lint retains the same 54 existing warnings.

```sh
env PATH=/opt/node24/bin:$PATH pnpm run gate:full
```

FAIL: the same pre-existing `@jeswr/federation-trust#test` snapshot mismatch at
`test/characterization.test.ts:196`, “delegation credential structure is stable”.
Serialized `delegateKey` property order is expected `crv,x,kty`, received
`kty,crv,x`. Turbo reports **311 successful / 365 total**, 10 cached, in
6m38.488s before stopping. Root tests pass all 879 tests in 12 files. No sources
outside the Todoist importer, its tests and lane documentation were changed.

Logs: `/tmp/sst-l41u-round1-{todoist-tests,dependency-build,app-gate,lint-root,gate,gate-full}.log`.

No requested implementation remains; no open questions. Full-workspace validation
remains blocked by the unrelated snapshot failure. `roborev` is still unavailable
(`command -v roborev` exits 1), so no automated per-commit verdict was obtained.
No dependencies, manifests or lockfiles changed. No push, PR, branch switch,
fetch, merge or tracker operation was performed. No UI checks apply. Untracked
callback/client-ID files generated by the full gate were removed.

## Timezone follow-up — review of `09d1c57e`

Addressed exactly the two supplied timezone findings on `lane/sst-l41u`:

- `d9da3caa` — `fix(tasks): bound Todoist formatter construction`: export
  `MAX_TODOIST_TIME_ZONES` (32), include the default zone in the per-import
  construction budget, and reject additional zones with `INVALID_TIMEZONE`
  before constructing another formatter. Keep cached zones usable at capacity.
  Tests cover the exact bound, a cycling 20,000-row input, constructor counts,
  and an independent budget for the next import. The conservative choice is to
  reuse the previous cache capacity and existing typed timezone error.
- `28acc9d3` — `fix(tasks): normalize Todoist zones with ASCII case`: share
  ASCII-only normalization between the cache, timezone allowlist and native
  formatter configuration. Reject Unicode lookalikes in defaults and rows,
  including cache collisions with `Asia/Kolkata` and `Kwajalein`; cover absent,
  local and explicit-offset dates. Preserve supplied valid timezone spellings.
- The final `docs: record Todoist timezone fix validation` commit contains this
  report.

All checks use Node `v24.22.1`, pnpm `10.4.1`, and disabled dependency lifecycle
scripts. Each regression failed against its previous implementation before the
corresponding fix.

```sh
env PATH=/opt/node24/bin:$PATH TZ=Pacific/Honolulu pnpm --filter @jeswr/app-suite exec vitest run test/tasks-todoist.test.ts --coverage.include='src/apps/tasks/lib/todoist/**/*.ts'
```

PASS: 183 importer tests; 100% statements (297), branches (258), functions (20)
and lines (251). Targeted Biome checks and `git diff --check` also pass.

```sh
env PATH=/opt/node24/bin:$PATH pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4
env PATH=/opt/node24/bin:$PATH bash -c 'pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test'
env PATH=/opt/node24/bin:$PATH pnpm run lint:root
env PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=09d1c57ec106f5b9b717644db9b14054ec33533c pnpm run gate
```

PASS: 7 dependency builds; app lint, production build, typecheck and all 7,690
tests across 153 files; root lint; affected gate **13 successful / 13 total**,
7 cached, in 2m33.829s. All configured app coverage thresholds pass. App lint
retains the same 54 existing warnings. Root tests pass all 879 tests in 12 files.

```sh
env PATH=/opt/node24/bin:$PATH pnpm run gate:full
```

FAIL: the same pre-existing `@jeswr/federation-trust#test` snapshot mismatch at
`test/characterization.test.ts:196`, “delegation credential structure is stable”.
Turbo reports **287 successful / 351 total**, 10 cached, in 5m1.219s before
stopping. No unrelated source or snapshot changes were made.

Logs: `/tmp/sst-l41u-fix2-{budget-red,budget-tests,ascii-red,todoist-tests,dependency-build,app-gate,lint-root,gate,gate-full}.log`.

No requested implementation remains; no open questions. Full-workspace validation
remains blocked by the unrelated snapshot failure. `roborev` remains unavailable
(`command -v roborev` exits 1), so no automated per-commit verdict was obtained.
No dependencies, manifests or lockfiles changed. No push, PR, branch switch,
fetch, merge or tracker operation was performed. No UI checks apply. Untracked
callback/client-ID files generated by the full gate were removed. All gate runs
preceded the final documentation-only commit.

## Fix round 2 — review of `c5f88b817e00`

Addressed exactly the three supplied importer findings on `lane/sst-l41u`:

- `6687922f` — `fix(tasks): default empty Todoist priorities to one`: empty
  and absent PRIORITY values now produce 1; explicit 1–4 values stay unchanged.
  Update regression expectations and the importer README. This follows the latest
  review requirement, superseding the original brief's empty-priority default.
- `85d70cf7` — `fix(tasks): preserve Todoist fences in block quotes`: strip
  enclosing quote prefixes for fence detection, track nesting, and end fences
  with their enclosing quote. Preserve extra quote markers inside code. Tests
  cover the reported tilde case, backticks, nested/indented prefixes, LF/CRLF/CR,
  container endings and quoted markers inside existing fences.
- `659e9501` — `fix(tasks): preserve quoted Todoist link titles`: track single
  and double quoted titles independently of structural parentheses. Escapes,
  backticks, other markup and multiline title text remain literal; labels after
  links still import. Regression cases include both opening and closing
  parentheses and apostrophes in destinations.
- The final `docs: record second Todoist review fixes` commit records validation.

All commands use Node `v24.22.1`, pnpm `10.4.1`, and disabled dependency lifecycle
scripts. New regressions reproduced all three findings before their fixes.

```sh
env PATH=/opt/node24/bin:$PATH TZ=Pacific/Honolulu pnpm --filter @jeswr/app-suite exec vitest run test/tasks-todoist.test.ts --coverage.include='src/apps/tasks/lib/todoist/**/*.ts'
```

PASS: 209 importer tests; 100% statements (324), branches (287), functions (20)
and lines (272). Targeted Biome checks and `git diff --check` also pass.

```sh
env PATH=/opt/node24/bin:$PATH pnpm exec turbo run lint build typecheck test --filter=@jeswr/app-suite --concurrency=4
env PATH=/opt/node24/bin:$PATH pnpm run lint:root
env PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=c5f88b817e0032b2cded1c28e991bbdd691e6227 pnpm run gate
```

PASS: package gate **12 successful / 12 total**, no cached tasks, in
3m47.891s. This runs all four package scripts with dependency-first builds and
root lint. Application lint, production build, typecheck and all 7,716 tests
across 153 files pass, including every configured coverage threshold. Application
lint retains the same 54 existing warnings. Standalone root lint passes. The
affected repository gate passes **12 successful / 12 total**, 11 cached, in
18.241s against the supplied starting commit.

```sh
env PATH=/opt/node24/bin:$PATH pnpm run gate:full
```

FAIL: the same pre-existing `@jeswr/federation-trust#test` snapshot mismatch at
`test/characterization.test.ts:196`, “delegation credential structure is stable”.
Serialized `delegateKey` property order is expected `crv,x,kty`, received
`kty,crv,x`. Turbo reports **290 successful / 353 total**, 9 cached, in
7m23.564s before stopping. Root tests pass all 879 tests in 12 files. No unrelated
source or snapshot changes were made.

Logs: `/tmp/sst-l41u-round2-{priority-red,priority-tests,fences-red,fences-tests,links-red,todoist-tests,package-gate,lint-root,gate,gate-full}.log`.

No requested implementation remains; no open questions. Full-workspace validation
remains blocked by the unrelated snapshot failure. `roborev` remains unavailable
(`command -v roborev` exits 1), so no automated per-commit verdict was obtained.
No dependencies, manifests or lockfiles changed. No push, PR, branch switch,
fetch, merge or tracker operation was performed. No UI checks apply. Untracked
callback/client-ID files generated by the full gate were removed. All gate runs
preceded the final documentation-only commit.

## Fix round 3 — review of `f20f39a562be`

Addressed exactly the three supplied Markdown preservation findings on
`lane/sst-l41u`:

- `f58d835b` — `fix(tasks): preserve angle-delimited Todoist destinations`:
  suspend structural parenthesis tracking inside angle-delimited destinations.
  Regression cases cover unbalanced opening/closing parentheses, both title
  quote styles, links without titles and escaped angle brackets.
- `146a805b` — `fix(tasks): measure Todoist code indentation with tab stops`:
  recognize mixed spaces and tabs reaching four indentation columns and retain
  ordinary labels below the threshold.
- `c70ba5fa` — `fix(tasks): preserve Todoist fences in list containers`:
  track enclosing list/quote containers, normalize tab stops in a detection copy,
  and stop fences when their enclosing container ends. Preserve the original
  Markdown. Tests cover bullet/ordered/nested/quoted lists, continuation fences,
  sibling items, blank lines, literal markers inside code, partial tab stops,
  and LF/CRLF/CR. Treat CRLF as one boundary to retain container state.
- The final `docs: record third Todoist review fixes` commit records validation.

All commands use Node `v24.22.1`, pnpm `10.4.1`, and disabled dependency lifecycle
scripts. New regressions reproduced each finding before its fix.

```sh
env PATH=/opt/node24/bin:$PATH TZ=Pacific/Honolulu pnpm --filter @jeswr/app-suite exec vitest run test/tasks-todoist.test.ts --coverage.include='src/apps/tasks/lib/todoist/**/*.ts'
```

PASS: 250 importer tests; 100% statements (351), branches (298), functions (21)
and lines (296). Targeted Biome checks and `git diff --check` pass.

```sh
env PATH=/opt/node24/bin:$PATH pnpm exec turbo run lint build typecheck test --filter=@jeswr/app-suite --concurrency=4
env PATH=/opt/node24/bin:$PATH pnpm run lint:root
env PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=f20f39a562be732cadca9c94aa809137a18f9365 pnpm run gate
```

PASS: package gate **12 successful / 12 total**, no cached tasks, in
4m15.104s. Application lint, dependency-first production build, typecheck and all
7,757 tests across 153 files pass, including every configured coverage threshold.
Application lint retains the same 54 existing warnings. Standalone root lint
passes. The affected repository gate passes **12 successful / 12 total**,
11 cached, in 29.933s against the supplied starting commit.

```sh
env PATH=/opt/node24/bin:$PATH pnpm run gate:full
env PATH=/opt/node24/bin:$PATH pnpm exec turbo run test:root --concurrency=1
env PATH=/opt/node24/bin:$PATH pnpm run gate:full
```

The first full-workspace attempt stopped on three unrelated 5-second timeouts in
`test/agent-layers.test.mjs:509` (disallowed path character fixture loops):
**50 successful / 215 total**, 7 cached, in 2m7.151s. A separate root test run
passes all **879 tests in 12 files**, **1 successful / 1 total**, in 33.1s.
The full-workspace retry reuses that passing root test result.

FAIL: the full-workspace retry reaches the same pre-existing
`@jeswr/federation-trust#test` snapshot mismatch at
`test/characterization.test.ts:196`, “delegation credential structure is stable”.
Serialized `delegateKey` property order is expected `crv,x,kty`, received
`kty,crv,x`. Turbo reports **337 successful / 377 total**, 53 cached, in
3m56.021s before stopping. No unrelated source or snapshot changes were made.

Logs: `/tmp/sst-l41u-round3-{angles-red,angles-tests,tabs-red,tabs-tests,lists-red,lists-tests,list-continuation-red,todoist-tests,package-gate,lint-root,gate,root-tests,gate-full,gate-full-retry}.log`.

No requested implementation remains; no open questions. Full-workspace validation
remains blocked by the unrelated snapshot failure. `roborev` remains unavailable
(`command -v roborev` exits 1), so no automated per-commit verdict was obtained.
No dependencies, manifests or lockfiles changed. No push, PR, branch switch,
fetch, merge or tracker operation was performed. No UI checks apply. Untracked
callback/client-ID files generated by the full gate were removed. All gate runs
preceded the final documentation-only commit.
