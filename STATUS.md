<!-- AUTHORED-BY Codex GPT-6 -->

# Lane sst-8xm.30 — T-004, PR CI loading fix

Date: 2026-10-26. Branch: `lane/sst-8xm.30`.

## Integration and commits

The requested `git merge --no-edit sdk/t-004-fetch-rdf` failed because that local
branch name is absent. Merged the already-stored local ref
`origin/sdk/t-004-fetch-rdf` instead, using signing-disabled git: fast-forward
from `c53be0b1` to `63c34f6e`. This includes the integrator's main merge and
deletion of the obsolete rdf-engine scaffold test. No fetch or network merge ran.
The referenced `lanes/briefs/` directory is absent in this checkout; the supplied
brief, previous STATUS.md and repository history supplied the context.

- `e147733e fix: restore buffered RDF parsing completion` — restore the published
  synchronous N3 parser path for strings, add regression coverage and document
  the distinction between buffered and streamed bodies.
- Final report commit: `docs: report RDF loading fix validation` — this file,
  edited last after validation.

## Cause and fix

The six suites named in the brief live in `packages/solid-components`, rather
than solid-elements. Their injected fetch reads reach `parseToStore`, which
buffers the Response body and calls `parseRdf` with a string. The published
implementation used `N3.Parser.parse` for N3-family strings; the imported version
used `StreamParser`, whose completion needs an event-loop turn beyond the
consumer's promise-based render flush. The reads eventually finish, but only
after the test helper exhausts its microtask loop and reports Loading.

Conservatively restored the prior parsing behavior for already-buffered Turtle,
N-Triples, N-Quads and TriG strings. Response streams still use incremental
parsing. Structured parse errors, base IRI resolution and graph preservation
remain covered. JSON-LD and its refused-by-default remote context policy are
unchanged. No consumer tests, timeouts, dependencies or manifests were changed.

Before the fix, the six named suites had **22 failures / 48 tests**, including
the reported Loading symptoms. Four focused buffered-format regressions also
failed against the previous source. All pass with the fix.

## Validation

PASS (exit 0):

```sh
pnpm exec turbo run lint build typecheck test --filter=@jeswr/fetch-rdf --concurrency=4
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-components --concurrency=4
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-elements --concurrency=4
git diff 63c34f6e --check
```

- Fetch-rdf: **5/5 tasks**, **7 files / 73 tests**, including context refusal,
  streaming teardown and response cancellation tests.
- Solid-components: **11/11 tasks**, **21 files / 204 tests**, including all six
  named suites and packaged-output checks.
- Solid-elements: **7/7 tasks**, **15 files / 324 tests**, manifest checks pass.

FAIL (exit 1), both run before the final commit:

```sh
pnpm run gate
pnpm run gate:full
```

The affected gate completed **206 successful / 258 total tasks** (98 cached).
The full gate completed **116 successful / 251 total tasks** (88 cached).
Both stop at `@jeswr/federation-codegen#test`: generator.test.ts expects legacy
`https://w3id.org/jeswr/sectors/bookmarks#Bookmark`, but the ontology now uses
`https://jeswr.org/ns/sectors/bookmarks#Bookmark`; committed generator output
also differs from fresh generation. Both failures reproduced before this fix.
Root lint passed. Cancelled or unrun workspace tasks are not claimed to pass.
These vocabulary/generator changes are outside the brief and were left alone.

Roborev is unavailable on PATH, so no automated per-commit review verdict was
obtained. Manual review checked string/stream dispatch, error metadata and
unchanged JSON-LD context handling.

## Remaining work

The requested loading fix is complete. The integrator must resolve the existing
federation-codegen vocabulary/output mismatch to obtain a green workspace gate.
No open implementation questions. No push, PR, branch switch, other-checkout
change or dependency addition was made. STATUS.md was edited last.
