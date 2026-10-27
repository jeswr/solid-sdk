<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# MON-L7 lane report — sst-gu8i

Branch: `lane/sst-gu8i`. Base: `2c99c9d2202c6b18c38c88ed1524fcb3d2efd460`.

## Commits

- `b4e6dd03` — `feat: compute investment lots and cost basis`: pure holdings API,
  BigInt-scaled quantities and exact fractional minor-unit basis, FIFO/average cost,
  sale gains, valuation, buy/sell fees, splits, cash-event reporting, typed errors,
  exported limits, 40 unit tests, coverage glob, API documentation and scope questions.
- `c89defa2` — `fix: reject non-index array properties in holdings`: reject numeric
  properties outside the array-index range; add the regression fixture.
- `docs: record MON-L7 lane results` — this final reporting commit.

## Validation

Commands ran from this checkout. Node 24 and pnpm 10.4.1 were selected with:

```sh
export PATH=/opt/node24/bin:$PATH
export COREPACK_HOME=/tmp/sst-gu8i-corepack
```

No dependency lifecycle scripts were enabled. No dependencies, manifests, lockfiles,
SDK packages, UI components, routes or other checkouts were changed.

| Command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS: build the seven workspace dependencies needed by the app. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/money-holdings.test.ts --coverage --coverage.include='src/apps/money/lib/holdings/**/*.ts'` | PASS: 40 tests; every holdings file has 100% statements, branches, functions and lines. Reran after the array validation fix. |
| `git merge --no-edit origin/main` | PASS: already up to date, local `origin/main` is the base SHA above. Ran before both final repository gates. No fetch, push or branch switch. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS (exit 0). Existing warning policy retained. |
| `pnpm --filter @jeswr/app-suite run build` | FAIL (exit 1): unchanged `packages/suite-ui/dist/fonts.js` triggers a `next/font` Google-loader error, `Cannot read properties of null (reading '1')`, at its font URL extension extraction. No holdings import is involved in the UI. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS (exit 0), after workspace dependencies were built. |
| `pnpm --filter @jeswr/app-suite run test` | PASS (exit 0): 153 files, 7,547 tests; 100% statements, branches, functions and lines across configured coverage, including each holdings file. |
| `pnpm run lint:root` | PASS (exit 0), including workspace, layer, token and contrast guards. |
| `TURBO_SCM_BASE=2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 pnpm run gate` | FAIL (exit 1): root `test/agent-layers.test.mjs` has two 5,000 ms timeouts; 877/879 root tests passed. Other outstanding tasks were stopped by Turbo. |
| `pnpm run gate:full` | FAIL (exit 1): root `test/agent-layers.test.mjs` has one 5,000 ms timeout; 878/879 root tests passed. Other outstanding tasks were stopped by Turbo. |
| `pnpm exec vitest run test/agent-layers.test.mjs --maxWorkers=1` | PASS (exit 0): all 343 tests pass in isolation at the unchanged timeout. This suggests load/timing sensitivity in the failed gate runs. |
| `git diff --check` | PASS. |

The app checks were executed sequentially in lint/build/typecheck/test order;
typecheck and test were still run after the build failed. An initial exploratory
typecheck failed because this fresh checkout lacked workspace `dist` declarations;
building the workspace dependencies resolved those errors without source changes.

The affected gate timed out in the seeded `daemon-send` fixture test at line 108
and the `await import(TARGET)` disallowed-path test at line 509. The full gate timed
out in the `type Value = import(TARGET).Value` disallowed-path test at line 509.
These root guard tests and the font code are unchanged by this lane. The recorded
gate results are failures; standalone app test/typecheck success does not replace them.

Logs are local artifacts under `/tmp/sst-gu8i-*`; no logs or generated `dist` files
are committed. `check:packages`: not applicable, no dependencies added. Screenshots,
Playwright and axe: not applicable, this lane builds a pure library with no UI states.
Chromium was not launched.

## Unfinished validation and questions

Implementation is complete. Normal production build and repository gates remain
blocked by the failures above. `roborev` is unavailable in this sandbox, so no
automated per-commit verdicts could be collected. The dispatcher retains bead
merge/close ownership; no tracker was initialised in this checkout.

[QUESTIONS.md](QUESTIONS.md) records conservative readings of underspecified cash
events, split fields/precision, final lot-basis remainder allocation, date/API shapes
and currency exponent bounds. Cash dividends and standalone fees leave capital
basis unchanged; unrepresentable post-split quantities fail with `INVALID_SPLIT`;
exact costs survive every operation and only reported money values are rounded.
No implementation decision is waiting for user input.

## Fix round 1 — arithmetic resource bound

This section supersedes the initial validation status above for this fix round.
Starting head: `c20366d84a80422f4b0222681989535e9590a01c`.

- `439f49de` — `fix: bound holdings arithmetic work`: add one arithmetic budget per
  call, shared by replay, split traversal and final valuation; add six regression
  cases and document the limits.
- `docs: record arithmetic guard validation` — final report commit.

Conservative internal limits are 4,096 bits per integer and 4,194,304 work units
per call. Guarded additions, products and every GCD remainder step charge the
product of their operands' 64-bit word counts. Operand sizes and available work
are checked before multiplication and GCD; oversized products are rejected before
allocation even when later cancellation could reduce them. Every failure uses
the existing `HoldingsError` with `VALUE_TOO_LARGE`. Budgets reset for each call;
accepted calculations retain exact arithmetic and final-only half-even rounding.
The existing 50,000-transaction boundary remains accepted.

Validation used Node 24 and pnpm 10.4.1 with the environment commands above.

| Command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS: all seven workspace prerequisites built. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/money-holdings.test.ts --coverage --coverage.include='src/apps/money/lib/holdings/**/*.ts'` | PASS: 46 tests; 100% statements, branches, functions and lines in holdings. Includes exact internal size/work boundaries, GCD budget exhaustion, exponential splits, growing average-cost fractions, cumulative split traversal and independent call budgets. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS (exit 0); existing warnings retained. |
| `pnpm --filter @jeswr/app-suite run build` | PASS (exit 0). |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS (exit 0). |
| `pnpm --filter @jeswr/app-suite run test` | PASS (exit 0): 153 files, 7,553 tests, 100% configured coverage. Each holdings file also reports 100% in the coverage JSON. |
| `pnpm run lint:root` | PASS (exit 0). |
| `TURBO_SCM_BASE=c20366d84a80422f4b0222681989535e9590a01c pnpm run gate` | PASS (exit 0): 12 successful tasks; all 7,553 app tests passed again. |
| `pnpm run gate:full` | FAIL (exit 1): unchanged `@jeswr/federation-trust` delegation-credential characterization snapshot differs only in JSON property ordering within `delegateKey` (`test/characterization.test.ts:196`). 292 tasks succeeded before Turbo stopped; that package had 53 passing tests and one failure. All 879 root tests passed. |
| `git diff --check` | PASS. |

The initial package attempt lacked workspace build outputs and failed module
resolution in build, typecheck and tests. Building the prerequisites resolved
those setup failures; the app checks above were then rerun in order and passed.
The original font-loader and root-test timeout failures did not recur this round.
The full-gate snapshot failure is outside this fix: federation-trust and the
lockfile are unchanged relative to the starting head.

No dependencies, manifests, lockfiles, UI or other checkout contents were changed.
No fetch, merge, push, PR or tracker mutation was performed. Untracked public
client-ID/callback assets generated by the full gate were removed. Logs are under
`/tmp/sst-gu8i-fix1-*`; generated build and coverage artifacts are not committed.
`check:packages` and screenshots are not applicable. `roborev` remains unavailable,
so automated per-commit verdicts could not be collected.

The requested arithmetic fix is complete. Full-workspace validation remains red
because of the unrelated snapshot mismatch above. No open implementation questions.
