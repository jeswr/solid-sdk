<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-l4ht — MON-L2 lane report

Implemented on `lane/sst-l4ht`, based on `1683635136063eb147125ded9574527220c16bae`.

## Commits

- `6ac0f31e` — `feat: add exact minor-unit money arithmetic`: supported ISO minor-unit
  subset, exact decimal string parsing/formatting, checked integer arithmetic, grouped
  totals, typed errors, arithmetic/property tests and conservative interpretations.
- `0b0f47dc` — `feat: calculate budget envelopes and grouped reports`: consecutive-month
  cash envelopes, signed rollover/overspend, available-to-budget, category roll-up, net
  worth samples, monthly cash flow, public barrel, documentation and full coverage glob.
- `docs: record budget lane validation` — final documentation commit containing this report.

All library changes are under `apps/suite/src/apps/money/lib/budget/`. Tests are the three
`apps/suite/test/money-budget-*.test.ts` files. No UI, storage model, RDF, React, fetch,
workspace project inventory or dependencies changed.

## Validation

Final commands, run before this report's commit:

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; builds the existing app dependency required for declaration resolution. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS (exit 0); 21 non-blocking Biome `noNonNullAssertion` warnings for validated map/index invariants. |
| `pnpm --filter @jeswr/app-suite run build` | PASS; Next.js production compilation, TypeScript and static generation. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS; 23 files, 748 tests; every configured coverage threshold passes. |
| `pnpm --filter @jeswr/app-suite exec vitest run money-budget --coverage.include='src/apps/money/lib/budget/**/*.ts'` | PASS; 3 files, 34 tests; budget directory 100% statements (264/264), branches (135/135), functions (41/41), lines (236/236), per-file thresholds enforced. |
| `pnpm run lint:root` | PASS, including workspace/layer/transport, fetch, token and contrast checks. |
| `TURBO_SCM_BASE=1683635136063eb147125ded9574527220c16bae pnpm run gate` | PASS; 7/7 tasks. |
| `pnpm run gate:full` | FAIL in unchanged `@jeswr/unstorage-solid#build`; see limitation below. |
| `git diff --check` | PASS. |

Tests exercise exact safe-integer boundaries; 0/2/3-digit currencies; decimal notation and
precision rejection; cross-currency arithmetic rejection; signed cash conservation; consecutive
months, leap/year boundaries; positive and negative envelope rollover; refunds and income
reversals; hierarchy validation and roll-up; transfer exclusion; balance sampling and missing
baselines; duplicates, malformed/sparse inputs and overflow. Frozen synthetic inputs verify
non-mutation. Account URL fixtures use `example.org`; no real financial data is included.

During development, the initial typecheck exposed the unbuilt suite-ui dependency and two
test casts; both were resolved before the final passing commands. An initial test invocation
used a literal wildcard filter and matched no tests; the corrected `money-budget` filter above
ran all 34 tests. No production code bypasses coverage or validation to obtain the result.

## Dependencies, visuals and review

- No dependencies added: `check:packages` is not applicable; manifests/lockfile unchanged.
- Pure-library task: no components/states rendered, no screenshots or E2E specs required.
  Playwright was not launched.
- Applied repository skills: `solid-test-infrastructure` and `roborev-review`.
  `command -v roborev` found no executable, so automated per-commit verdicts could not be
  obtained. No tooling installed or review configuration changed.

## Limitations and open questions

Implementation and app acceptance checks are complete. The full-workspace gate is not green:
`packages/unstorage-solid/scripts/build-deps.mjs` cloned its existing pinned fetch-rdf source,
then its `npm install --no-audit --no-fund --ignore-scripts --prefer-offline` failed with
`EROFS` while opening `/home/runner/.npm/_cacache/tmp/...`. No cache override or retry was
attempted: that unchanged script performs remote-source operations outside this lane's scope.
The unrelated package was not edited. Automated roborev review remains unavailable.

The spec leaves rollover policy, report date/sign conventions, currency subset and incomplete
balance handling open. [QUESTIONS.md](QUESTIONS.md) records the options and conservative
choices: carry negative envelope available in full, inclusive civil dates, refund-adjusted
spending, exclude transfers from spend/cash flow, signed liabilities, eight supported
currencies and explicit balance baselines. None blocks the delivered library.
