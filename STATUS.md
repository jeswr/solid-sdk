<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-L1 — sst-kyf5 lane report

Implemented on `lane/sst-kyf5`, based on `606c87b7edf73e83f118f95295b0eeda7abb6d92`.

## Commits

- `8ae76346 feat: add pure vCard parsing and serialization` — typed plain objects and barrel;
  FN, N, EMAIL, TEL, ADR, ORG, TITLE, BDAY, NOTE, PHOTO URI, CATEGORIES; mixed/multiple cards;
  escaping, folding and v3 quoted-printable; API documentation and conservative interpretations.
- `3ea290d9 test: cover vCard exports and enforce full coverage` — synthetic Google/Apple/v4/QP
  fixtures, round trips and malformed-input tests; per-file 100% coverage required by default.
- `e0185d47 fix: distinguish quoted-printable headers from note text` — recognize transport
  encoding only in the property header; regression test for literal NOTE text and folded headers.
- Final documentation commit (`docs: record vCard lane verification`) — this report.

## Verification

All commands ran inside this checkout, without changing branches or pushing.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; builds the pre-existing workspace prerequisite. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS on final implementation; 49 tests across 2 files. |
| `pnpm run lint:root` | PASS; workspace, transport, fetch, token and contrast guards; 74 contrast pairs, 0 failures. |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | PASS on final implementation; 7/7 tasks successful. |
| `pnpm run gate:full` | BLOCKED by unchanged `@jeswr/unstorage-solid#build`; exit 1, 19/67 tasks successful before Turbo stopped. Its legacy `build-deps.mjs` cloned fetch-rdf into a temporary directory, then `npm install --no-audit --no-fund --ignore-scripts --prefer-offline` failed with EROFS writing `/home/runner/.npm/_cacache`. No retry of this remote bootstrap under the lane's no-fetch constraint. |
| `git diff --check` | PASS. |

Final vCard coverage: **100% statements (222/222), branches (161/161), functions (28/28),
lines (192/192)**. Coverage includes every TypeScript file in the requested directory, including
the barrel and type declarations. The coverage report is generated in ignored
`apps/suite/coverage/`; no generated output is committed.

Early verification exposed the expected missing suite-ui dist prerequisite and one redundant
unreachable quote check. Building suite-ui and removing the redundant check resolved both;
subsequent app and affected gates pass. The later NOTE regression increased the test count
from 48 to 49 while retaining full coverage.

## Dependencies and scope

No dependencies or manifests changed; no `check:packages` command was needed. Coverage uses
the existing lockfile's Vitest/v8 provider. No lifecycle scripts were enabled.
No React, hooks, fetch, RDF, UI, routes or workspace inventory changes were introduced.
Screenshots and Playwright: not applicable to this pure-library lane; Chromium was not launched.
Fixtures contain only synthetic people, reserved fictional phone numbers and example.org URIs.

## Unfinished verification and questions

- Full-workspace verification remains blocked by the unrelated dependency bootstrap described above.
- Roborev review is unavailable: `command -v roborev` found no CLI, and no post-commit review hook
  exists in this checkout. No review was fabricated and no review tooling was installed.
- The two interpretation questions are recorded in [QUESTIONS.md](QUESTIONS.md). Conservative
  defaults were implemented: supported-field semantic conversion, strict envelope/encoding errors,
  unknown/binary fields ignored, last singular property wins, and v3 export supplies empty N.
  Neither question blocks the requested library. No UI/data-model strategy was changed.
- Bead closure and integration remain with the dispatcher; this dedicated worktree did not alter
  the tracker or other checkouts.

## Fix round 1 — review e9a84cbacef2

- `4092556b fix: preserve vCard value types and escaping` addresses all five findings:
  TEL defaults to text in both versions and requires explicit VALUE=uri for URI handling;
  quoted-printable soft-break detection reads quote-aware parsed parameters; v4 PHOTO/TEL URI
  commas encode/decode without applying other TEXT escapes; optional `bdayValueType` preserves
  explicit birthday types while keeping `bday` a string; caret decoding recognizes lowercase
  `^n` and leaves uppercase/unknown sequences intact. Updated the API documentation accordingly.
- Final report commit (`docs: record vCard fix round verification`) records this verification.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/vcard.test.ts --coverage.enabled=false` | Regression check before fixes: 11 failed, 51 passed, reproducing all five findings. |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; workspace prerequisite. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; 63 tests across 2 files. |
| `TURBO_SCM_BASE=e9a84cbacef29715aa68486a8d6bc4ba806ae8aa GIT_ALLOW_PROTOCOL=file pnpm run gate` | PASS; 6/6 tasks, including root lint and guards. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full` | BLOCKED; unchanged `@jeswr/unstorage-solid#build` dependency bootstrap fails during npm install with EROFS writing `/home/runner/.npm/_cacache`; 3/35 tasks successful before Turbo stopped. Remote Git transports were disabled. |
| `git diff --check` | PASS. |

Final per-file vCard coverage remains **100% statements (230/230), branches (164/164),
functions (30/30), lines (199/199)**. Tests cover default/explicit TEL text, v3/v4 URI comma
rules and other URI escapes, quoted encoding lookalikes followed by EMAIL, birthday value
kinds and replacement, and lowercase/uppercase/unknown caret sequences. Birthday type header
injection is rejected. An initial concurrent affected-gate attempt hit Next.js's build lock;
the sequential rerun above passed.

No dependencies, manifests, UI, tracker state, other packages, or other checkouts changed.
No implementation work remains and there are no new open questions. The conservative birthday
API addition retains existing string values and adds only optional type metadata.
Full-workspace verification remains blocked by the unrelated bootstrap failure. Roborev is
still unavailable (`command -v roborev` finds no CLI; no post-commit hook exists); the supplied
review was addressed directly. Integration and bead closure remain with the dispatcher.

## Fix round 2 — review a58472bfdfcb

- `cae0cb1b fix: preserve folded quoted-printable escapes` addresses the sole finding:
  a space/tab continuation completing an `=HH` byte preserves the preceding equals sign.
  The review's `Andr=C3=\r\n A9` example now decodes to `André`. Conservative compatibility:
  complete encoded-byte continuations take precedence over legacy MIME soft breaks;
  existing soft breaks, including those with an extra fold space, remain supported.
- Six regression cases cover space/tab folds, lowercase hex, a fold after the first hex
  digit, and MIME soft breaks with/without a fold space; all assert semantic round trips.
- Final documentation commit (`docs: record vCard folding fix verification`) records these results.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/vcard.test.ts --coverage.enabled=false` | Before the parser fix: 3 failed, 65 passed; the space/tab/lowercase encoded-byte boundary cases reproduce the finding. |
| `pnpm --filter @jeswr/app-suite run test` | PASS; 69 tests across 2 files, per-file 100% vCard coverage. |
| `pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; app gate and workspace build prerequisite, 69 tests. |
| `TURBO_SCM_BASE=a58472bfdfcb9ea8e19a222e3fa1f92583c4f5e5 GIT_ALLOW_PROTOCOL=file pnpm run gate` | PASS; 6/6 tasks, including root lint and guards. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full` | BLOCKED; unchanged `@jeswr/unstorage-solid#build` bootstrap fails during npm install with EROFS writing `/home/runner/.npm/_cacache`; 26/155 tasks successful before Turbo stopped. Remote Git transports were disabled. |
| `git diff --check` | PASS. |

Final per-file vCard coverage: **100% statements (230/230), branches (165/165),
functions (30/30), lines (199/199)**. No dependencies, manifests, UI, tracker state,
other packages, or other checkouts changed. No new open questions or unfinished implementation.
Full-workspace verification remains blocked by the unrelated bootstrap failure. Roborev CLI
remains unavailable; the supplied review was addressed directly without installing tooling.

## Fix round 3 — review 916be5310251

- `26a8566f fix: preserve folded escapes and telephone URIs` addresses both findings:
  quoted-printable soft-break detection inspects the complete unfolded continuation, preserving
  `=HH` escapes split across repeated space/tab folds; TEL parameter keys normalize to uppercase
  before choosing TEXT or URI encoding, preserving telephone URI semicolons and version-specific
  comma escaping without mutating the input object.
- Conservative collision handling: TEL parameter names differing only by case are rejected with
  the library's existing `SyntaxError`, rather than silently discarding or choosing a value.
- Regression tests cover repeated folds, an empty continuation, multiple escaped bytes, a following
  MIME soft break, preservation of the following EMAIL, v3/v4 lowercase/mixed/uppercase VALUE keys,
  unchanged input parameters, and normalization collisions. Existing legacy soft-break tests pass.
- Final documentation commit (`docs: record vCard final fix verification`) records these results;
  STATUS.md is committed last.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/vcard.test.ts --coverage.enabled=false` | Before fixes: 8 failed, 68 passed; reproduces both review findings and the ambiguous-key collision. |
| `pnpm --filter @jeswr/app-suite run test` | PASS; 77 tests across 2 files, per-file 100% vCard coverage. |
| `pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; prerequisite build and full app gate, 77 tests. |
| `pnpm run lint:root` | PASS; workspace, transport, fetch, token and contrast checks; 74 contrast pairs, 0 failures. |
| `TURBO_SCM_BASE=a58472bfdfcb9ea8e19a222e3fa1f92583c4f5e5 GIT_ALLOW_PROTOCOL=file pnpm run gate` | PASS; 7/7 tasks, including root checks. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full` | BLOCKED; unchanged `@jeswr/unstorage-solid#build` bootstrap fails during npm install with EROFS writing `/home/runner/.npm/_cacache`; 25/145 tasks successful before Turbo stopped. Remote Git transports were disabled. |
| `git diff --check` | PASS. |

Final per-file vCard coverage: **100% statements (244/244), branches (171/171),
functions (30/30), lines (211/211)**. No dependencies, manifests, UI, tracker state,
other packages, or other checkouts changed. No new open questions or unfinished implementation.
Full-workspace verification remains blocked by the unrelated bootstrap failure. Roborev CLI and
the post-commit hook remain unavailable; the supplied review was addressed directly without
installing tooling. Integration and bead closure remain with the dispatcher.

<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 4 — review 39dc42009ed1

- `2d3c45ca fix: bound quoted-printable continuation scanning` addresses the sole finding:
  one forward index consumes physical lines, without copying/slicing the remaining line array.
  Only quoted-printable properties inspect continuations, and only until there are enough
  characters to classify an encoded byte. Empty folds advance that same index. Existing folded
  escapes, quoted headers and MIME soft breaks retain their behavior.
- Three 50,000-line regressions cover ordinary properties ending in equals signs, QP soft
  breaks, and empty QP folds preceding a split hex escape. They assert decoded values and
  preservation of the following EMAIL property, with a four-second parsing budget.
- `6c233963 test: allow gate overhead in large-input checks` increases the initial two-second
  budget after the affected gate measured 2.04 seconds for the largest QP input under coverage.
  The old ordinary-property implementation took 5.37 seconds, exceeding both budgets.
- Final documentation commit (`docs: record vCard round four verification`) updates this file last.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/vcard.test.ts --coverage.enabled=false -t 'large inputs with ordinary properties'` | Before the fix: FAIL; 5.37 seconds reproduces the resource regression. |
| `pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; workspace prerequisite and app gate; 80 tests across 2 files. |
| `pnpm run lint:root` | PASS; all workspace guards, including 74 contrast pairs. |
| `TURBO_SCM_BASE=a58472bfdfcb9ea8e19a222e3fa1f92583c4f5e5 GIT_ALLOW_PROTOCOL= pnpm run gate` | Final run PASS; 7/7 tasks, 80 tests and 100% vCard coverage. First run failed only on the initial timing budget described above. |
| `GIT_ALLOW_PROTOCOL= pnpm run gate:full` | Interrupted (exit 130): Turbo's strict environment stripped the transport restriction; the unchanged unstorage-solid bootstrap cloned fetch-rdf into a temporary directory and started npm install. This unintended remote operation violated the lane's no-fetch constraint. The gate was stopped on discovery and rerun with explicit environment passthrough below. |
| `GIT_ALLOW_PROTOCOL=none npm_config_offline=true pnpm run gate:full --env-mode=loose` | FAIL outside lane scope; 213/283 tasks successful before Turbo stopped at `@jeswr/federation-codegen#test`. Two unchanged tests expect `https://w3id.org/jeswr/sectors/bookmarks#`, while inputs/fresh generation use `https://jeswr.org/ns/sectors/bookmarks#`. No clone occurred in this restricted rerun. |
| `git diff --check` | PASS. |

Final per-file vCard coverage remains **100% statements, branches, functions and lines**.
Only the vCard parser, its regression tests, and this report changed. No dependencies or manifests
were added or changed; `check:packages` was unnecessary. No UI changes or screenshots apply.
There are no new interpretation questions or unfinished implementation changes. Full-workspace
verification remains blocked by the unrelated generator tests. Roborev CLI and the post-commit
hook are unavailable; the supplied review was addressed directly without installing tooling.
