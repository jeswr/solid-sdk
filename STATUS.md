<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-fwm1 lane status

Branch: `lane/sst-fwm1`. Base: `606c87b7edf73e83f118f95295b0eeda7abb6d92`
(`suite/integration`). Verified 2026-10-25. No push, PR, branch switch or
remote fetch/merge was performed.

## Commits

- `42e8972b` — `feat: spike headless Univer workbook conversion`: pinned
  checked dependencies, plain TypeScript barrel, real headless load/save,
  CSV conversions, column inference, SHT-00 projection seam, tests, enforced
  coverage, reproducible esbuild/install measurement and `QUESTIONS.md`.
- `800dc912` — `docs: record Univer feasibility measurements`: licence,
  sizes, API scope, reproducibility, limitations and the SHT-00 gap in
  `apps/suite/src/apps/sheets/lib/univer-spike/REPORT.md`.
- Final commit `docs: record sst-fwm1 lane validation` adds this status file
  after the gates below; its hash is available in the lane's git log.

Every commit uses the requested identity and provenance trailer with signing
disabled. Only this checkout was modified. No generated dist/bundle/coverage
artifacts are committed; no new workspace project was introduced.

## Dependency policy

These exact commands all passed in full registry mode:

```sh
pnpm run check:packages @univerjs/core @univerjs/sheets
pnpm run check:packages rxjs esbuild @vitest/coverage-v8
pnpm run check:packages @univerjs/engine-formula @univerjs/engine-render @univerjs/protocol @univerjs/rpc @univerjs/themes
```

The first two ran before any dependency addition; the third additionally
checked the transitive Univer packages. Details/ages are in REPORT.md. Direct
runtime additions: core/sheets 1.2.0 and rxjs 7.8.2. Development additions:
esbuild 0.28.1 and coverage-v8 4.1.10 (both versions already in the lockfile).
No lifecycle scripts were enabled. Installation used a writable temporary pnpm
store/cache; unrelated refreshed lock resolutions were restored to the base.
The lockfile changes contain only the suite additions and their dependency
closure. Final consistency check passed:

```sh
pnpm install --lockfile-only --offline --frozen-lockfile --store-dir /tmp/sst-fwm1-pnpm-store
```

## Validation

The workspace dependency was built before checking the app:

```sh
pnpm --filter @jeswr/suite-ui build
```

PASS. The following exact app gate then passed end to end:

```sh
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
```

PASS: Biome clean; Next.js production build succeeded; TypeScript strict check
passed; 2 test files / 35 tests passed (34 new spike cases + the existing
fixture-access test). Coverage includes every TypeScript file in
`src/apps/sheets/lib/univer-spike/`, including the barrel, and enforces 100%
statements, branches, functions and lines. Measured totals: 114/114 statements,
80/80 branches, 23/23 functions, 100/100 lines. The barrel has no executable
statements. Tests run in Node against the real engine with no DOM or mocks.

```sh
pnpm run lint:root
TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate
```

PASS: root guards clean, including 74 contrast pairs with zero failures;
base-scoped Turbo gate 7/7 tasks successful (1 cached). An initial overlapping
app/affected run encountered Next.js's build lock; the successful final affected
gate ran after the standalone app gate completed. No source fix was necessary.

```sh
pnpm run gate:full
```

FAIL outside lane scope: `@jeswr/unstorage-solid#build` invokes
`npm install --no-audit --no-fund --ignore-scripts --prefer-offline` from its
`build-deps.mjs`; npm fails with EROFS writing
`/home/runner/.npm/_cacache/tmp/…` in this sandbox. Turbo reported 35 successful /
176 total tasks, 2 cached, before stopping. No unrelated package or build script
was changed. The full workspace is not certified green.

```sh
pnpm --filter @jeswr/app-suite measure:univer
```

PASS: browser ESM 7,757,001 bytes; gzip level 9 1,689,651 bytes; 985 inputs,
zero externals. Runtime dependency/required peer closure: 61 packages,
96,021,170 regular-file bytes. Complete method and caveats are in REPORT.md.

`git diff --check` passed. `roborev status` could not run (exit 127,
`roborev: command not found`); automatic per-commit verdicts are unavailable.
No review tooling was installed or configuration changed.

## Remaining / open questions

`QUESTIONS.md` question 1 records the absent SHT-00 model. Conservative choice:
an in-memory snapshot/CSV/column projection for its eventual typed writers,
without inventing RDF or persistence APIs. Direct conversion against SHT-00's
actual types remains unverified until integration supplies that implementation.

No UI was built; no component fixture route, Playwright spec, axe run or
screenshots apply. Chromium was not launched. Formula recalculation, editor UI
bundle/accessibility, RDF/network persistence and editing subscriptions are
outside this headless spike, as recorded in REPORT.md. The full gate environment
failure and unavailable roborev are the remaining validation limitations.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 2 — 2026-10-26

Starting head: `00431a154dbcd9e8e9d2676d778ea7872bc4fdf8`.
Only the two findings from the supplied round-2 review were addressed.

- `d615cbee` — `fix: preserve Univer cell value semantics`: rich-text content
  takes precedence over scalar values and uses Univer's `getPlainText` helper
  to remove document control markers and the final paragraph terminator.
  Boolean cells use Univer's `getCellValue` helper, correctly handling
  string-valued false/true and numeric representations. Added 17 regression
  cases covering real headless load/save, CSV, storage round-trips and column
  inference, plus scalar fallback for absent rich-text content.
- Final commit `docs: record sst-fwm1 round two validation` records this round's
  results; its hash is available in the lane's git log.

Validation ran before the final commit:

```sh
pnpm --filter @jeswr/suite-ui run build
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
pnpm run lint:root
TURBO_SCM_BASE=00431a154dbcd9e8e9d2676d778ea7872bc4fdf8 pnpm run gate
```

PASS: dependency build, app lint/production build/typecheck/test and root guards.
All 73 tests passed (72 spike tests and the existing fixture-access test).
Spike coverage remains 100%: 126/126 statements, 108/108 branches,
25/25 functions and 112/112 lines. The affected Turbo gate passed 6/6 tasks.
The new tests first reproduced both reported conversion errors before the fix.

```sh
pnpm run gate:full
```

FAIL outside the changed app: `@jeswr/unstorage-solid#build` again invokes
`npm install --no-audit --no-fund --ignore-scripts --prefer-offline` through
`scripts/build-deps.mjs` and fails with `EROFS` opening npm's read-only cache
under `/home/runner/.npm/_cacache/tmp/`. Turbo reported 24 successful / 70 total
tasks, 2 cached, before stopping. This is the same environment limitation
recorded above; no unrelated source or build configuration was changed.

`git diff --check` passed. `roborev status` remains unavailable (exit 127,
`roborev: command not found`), so no automatic per-commit verdict was available.
No dependencies were added; no dependency-policy check was needed. No UI or
screenshots apply. No push, PR, branch switch or remote fetch/merge occurred.
Both requested findings are fixed, with no unfinished implementation or new
open questions. Earlier SHT-00 integration limitations remain outside this
fix round.
