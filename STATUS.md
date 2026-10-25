<!-- AUTHORED-BY Codex GPT-6 -->

# Lane sst-8xm.30 — T-004, fix round 5

Date: 2026-10-25. Branch: `lane/sst-8xm.30`. Resumed from `91680661`.

The sole finding in `solid-sdk-lane-sst-8xm.30-916806616810.md` is fixed.
Both fetchRdf and the JSON-LD context loader start response cancellation without
awaiting it, then immediately throw the original error. A shared internal helper
bounds cleanup with a one-second Promise.race, swallows cancellation failures,
and clears the timer on completion. Late cancellation rejections stay handled.

## Commits this round

- `c8cf3a78 fix: bound response cancellation without delaying errors` — fix both
  error paths and adjust their regression tests.
- Final report commit: `docs: report fifth fetch-rdf fix validation` — update
  this STATUS.md last, after validation and generated-artifact cleanup.

## Regression coverage

Eight new cases replace the two tests that required awaiting cancellation.
They reproduce non-settling cancellation and rejection after the timeout for
HTTP errors, unsupported/malformed Content-Type errors, and context HTTP errors.
They verify immediate original-error propagation, the one-second cleanup bound,
and absence of unhandled rejections. All eight fail against the prior source
and pass with the fix. Existing rejecting, locked, absent, and normally cancelled
body cases continue to pass.

## Validation

PASS (exit 0):

```sh
pnpm exec turbo run lint build typecheck test --filter=@jeswr/fetch-rdf --concurrency=4 --continue=always
pnpm --filter @jeswr/fetch-rdf run test:coverage
pnpm run lint:root
git diff 91680661 --check
```

Scoped gate: **5/5 tasks successful**, including root lint. Fetch-rdf:
**6 test files / 68 tests pass**. Coverage exceeds the configured 90% thresholds:
statements **95.48%**, branches **95.29%**, functions **91.30%**, lines **98.27%**.
The targeted two-file regression run also passes: **29/29 tests**.

FAIL (exit 1):

```sh
pnpm exec turbo run build typecheck test --filter=...@jeswr/fetch-rdf --concurrency=4
```

The dependant gate reports **86 successful / 134 total tasks**, 3 cached,
and stops at `@jeswr/federation-trust#test`: 53 tests pass and one
characterization snapshot fails at `test/characterization.test.ts:196`.
The serialized `delegateKey` JWK has property order `kty, crv, x`; the snapshot
expects `crv, x, kty`. This is the same failure documented in the previous round.
Unfinished dependant tasks are not claimed to pass. Federation-trust source
and snapshots were left unchanged. The full-workspace gate was not run,
following the original lane brief's explicit instruction to use scoped gates.

## Scope and remaining limitations

No requested implementation work or open questions remain. Changes are limited
to fetch-rdf cancellation handling, its regression tests, and this report.
No dependencies were added or changed; `check:packages` was not applicable.
Roborev is unavailable on PATH; no local automated per-commit verdict was
obtained. Manual review checked original-error preservation, immediate
propagation, bounded cleanup, and handling of late cancellation rejection.

No push, PR, branch switch, remote fetch/merge, or other checkout changes were
made. Generated web public artifacts from dependant builds were removed.
STATUS.md was edited last.
