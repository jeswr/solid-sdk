<!-- AUTHORED-BY Codex GPT-6 -->

# Lane sst-8xm.30 — T-004, fix round 4

Date: 2026-10-25. Branch: `lane/sst-8xm.30`. Resumed from `ee3012b5`.

The sole finding in `solid-sdk-lane-sst-8xm.30-ee3012b5dfe7.md` is fixed.
Unsuccessful JSON-LD context responses now have their unread bodies cancelled
before the document loader rejects. Cleanup is awaited and best-effort; its
failure preserves the original typed HTTP error, status, URL, and message.

## Commits this round

- `83b9da89 fix: cancel rejected context response bodies` — add guarded
  cancellation and six regression cases for unsuccessful context responses.
- Final report commit: `docs: report fourth fetch-rdf fix validation` — update
  this STATUS.md after implementation, validation, and generated-artifact cleanup.

## Regression coverage

Tests record underlying stream cancellation for HTTP 404 and 503, prove the
loader waits for delayed cleanup, and preserve the HTTP error when cancellation
rejects, the body is locked, or the response has no body. Existing successful
context parsing, allowlist, redirect policy, and injected-transport cases pass.

## Validation

PASS (exit 0):

```sh
pnpm exec turbo run lint build typecheck test --filter=@jeswr/fetch-rdf --concurrency=4 --continue=always
pnpm --filter @jeswr/fetch-rdf run test:coverage
pnpm run lint:root
git diff ee3012b5 --check
```

Scoped gate: **5/5 tasks successful**, including root lint. Fetch-rdf:
**6 test files / 62 tests pass**, including six new regression cases.
Coverage passes the configured 90% thresholds: statements **95.41%**,
branches **95.29%**, functions **90.47%**, lines **98.24%**.
The initial gate found formatting issues in the two edited files; formatting
was corrected and the complete scoped gate then passed.

FAIL (exit 1):

```sh
pnpm exec turbo run build typecheck test --filter=...@jeswr/fetch-rdf --concurrency=4
```

The dependant gate reports **90 successful / 136 total tasks**, 3 cached,
and stops at `@jeswr/federation-trust#test`: 53 tests pass and one
characterization snapshot fails at `test/characterization.test.ts:196`.
The serialized `delegateKey` JWK has property order `kty, crv, x`; the snapshot
expects `crv, x, kty`. This is the same failure recorded at the previous lane
head. Unfinished dependant tasks are not claimed to pass. Federation-trust
source and snapshots were left unchanged. The full-workspace gate was not run,
following the original lane brief's explicit instruction to use scoped gates.

## Scope and remaining limitations

No requested implementation work or open questions remain. The only code and
test changes are in fetch-rdf's context loader and its existing test file.
No dependencies were added or changed, so `check:packages` was not applicable.
Roborev is unavailable on PATH; no local automated per-commit verdict was
obtained. Manual review checked cleanup ordering and HTTP-error preservation.

No push, PR, branch switch, remote fetch/merge, or other checkout changes were
made. Generated web public artifacts from dependant builds were removed.
STATUS.md was edited last.
