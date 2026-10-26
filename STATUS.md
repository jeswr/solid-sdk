<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# DOC-L3 lane report — sst-cldc

Branch: `lane/sst-cldc`. Base: `8865b4b3e01bdb91ab0f102683e0833f786c65cf`.

Implemented the pure TypeScript library in `apps/suite/src/apps/docs/lib/outline/`:

- `analyzeDocument`, `buildOutline`, `projectPlainText`, and `documentStatistics`, with a barrel
  exporting their result types, typed errors and input limits.
- H1–H3 outline hierarchy, deterministic Unicode heading slugs and collision-safe `-1`/`-2` anchors.
- Text projection with code point spans and preorder ranges back to `content` node paths,
  including explicit generated separators and zero-width empty-node ranges.
- Word-like segment and grapheme counts through `Intl.Segmenter`; whitespace-free character
  counts; exact reading minutes at 230 words/minute.
- Fail-closed schema/JSON validation, typed errors, Unicode validation, bounded traversal,
  and non-mutating extraction. No editor, React, hook, or network dependencies.
- 91 unit/property tests with synthetic fixtures and the directory's explicit coverage glob.

## Commits

- `5b0e7441` — `docs: record DOC-L3 interpretation choices`.
- `b2d9660e` — `feat: derive document outline and statistics` (library, tests, coverage glob).
- The final documentation commit adds this report after all gates finish.

## Validation

The local `origin` is `/home/runner/work/solid-sdk`. `git fetch origin main` succeeded;
`git merge origin/main --no-edit` reported **Already up to date** before the final gates.
`origin/main` remained at the stated base. No network remote was fetched or merged.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; build the existing workspace dependency's declarations before app checks. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/docs-outline.test.ts --coverage.include='src/apps/docs/lib/outline/**/*.ts'` | PASS: 91 tests; outline statements, branches, functions and lines all 100%, per file. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS (exit 0); 21 existing Money budget non-null assertion warnings, no new outline warnings. |
| `pnpm --filter @jeswr/app-suite run build` | PASS (Next.js production build). |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 28 files, 1,268 tests; all configured library coverage metrics 100%. |
| `pnpm run lint:root` | PASS; all workspace, layer, transport, token and contrast guards. |
| `TURBO_SCM_BASE=8865b4b3e01bdb91ab0f102683e0833f786c65cf pnpm run gate` | PASS: 7/7 tasks; 686 root tests and 1,268 suite app tests. |
| `pnpm run gate:full` | FAIL (exit 1): 209 successful tasks / 290 scheduled; stopped at the existing `@jeswr/federation-codegen#test` namespace/snapshot mismatch detailed below. |
| `git diff --check` | PASS. |
| `roborev status` | UNAVAILABLE: exit 127, `roborev: command not found`; automated commit review could not run. |

The initial standalone app typecheck preceded the workspace dependency build and could not
resolve `@jeswr/suite-ui` declarations; building that dependency resolved it. Final validation
above ran on the implementation commit after the prescribed merge.

No dependencies were added; `check:packages` is not applicable and the lockfile is unchanged.
No UI was built: visual fixture routes, Playwright specs, axe checks and screenshots are not
applicable to this pure-library lane. No browser was launched.

## Remaining work and questions

Implementation is complete. Automated roborev review remains unavailable in this sandbox;
the dispatcher can review the lane commits with its installed tooling. The bead is left for
the dispatcher to close on merge; this lane did not mutate tracker state from a worktree.

The full workspace gate cannot be green until the unrelated federation-codegen expectations
are reconciled with the vocabulary already present in the base. Its 25 tests finished with
23 passing and these two failures in `tools/federation-codegen/test/generator.test.ts`:

- `projects the bookmarks node shape into typed cardinalities and RDF term kinds` (line 81):
  expected legacy `https://w3id.org/jeswr/sectors/bookmarks#Bookmark`, received the current
  `https://jeswr.org/ns/sectors/bookmarks#Bookmark`.
- `uses only ontology and SHACL inputs and reproduces every committed output byte` (line 126):
  committed `ontology.ttl` differs from fresh generation (legacy namespaces and modified date).

Neither federation-codegen nor its vocabulary inputs differ from the lane base. Those files
remain unchanged to respect the DOC-L3-only scope. The suite app's 1,268 tests also passed
within the full gate before it stopped. No full-gate success is claimed.

The four nonblocking interpretation questions and conservative choices are recorded in
`QUESTIONS.md`: projection boundaries/code point offsets, Unicode slug/hierarchy rules,
grapheme counts/fractional minutes, and the supported first-cut schema. No blocking question
remains. No other checkout, branch, PR or remote publication was changed.

## Fix round 1 — property-name character budget

`19c023e6` — `fix: count document property names toward character limit` makes property
names and string values consume the same UTF-16 character budget during JSON validation.
Regression tests cover exact-limit acceptance, oversized Unicode metadata keys, nested keys,
and combined key/value overflow through all four public derivation functions. The earlier
string-value boundary fixture now accounts for its property names.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/docs-outline.test.ts --coverage.include='src/apps/docs/lib/outline/**/*.ts'` | PASS: 93 tests; outline statements, branches, functions and lines all 100%. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS after formatting the updated test; 21 existing Money budget warnings. |
| `pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: production build, typecheck, 28 test files and 1,270 tests; configured coverage metrics all 100%. |
| `TURBO_SCM_BASE=901338e2d167a5cb335d62af3ef6a2576e975f46 pnpm run gate` | PASS: 6/6 tasks, including root lint/guards and the suite app checks. |
| `pnpm run gate:full` | FAIL (exit 1): 269 successful tasks / 346 scheduled; the same two existing `@jeswr/federation-codegen#test` failures detailed above (bookmarks namespace and generated ontology drift). |
| `git diff --check` | PASS. |
| `roborev status` | UNAVAILABLE: exit 127, `roborev: command not found`; dispatcher review remains necessary. |

The final documentation commit records these fix-round results. Generated, untracked
`apps/pod-*/web/public/{callback.html,clientid.jsonld}` build artifacts were removed after
the full gate. No dependencies or UI were added, and no tracker state, other checkout,
branch selection, or remote was changed. The review finding is addressed; no new
interpretation questions arose. The unrelated full-gate failures and unavailable roborev
tooling remain the only validation limitations.

## Fix round 2 — bound container expansion

- `7d160a36` — `fix: bound document containers before traversal` checks array length
  before enumerating keys and object cardinality before inspecting descriptors, using
  the remaining value budget. Descriptor inspection and array density validation now
  proceed incrementally with recursive traversal.
- `12035603` — `test: fail fast on oversized array enumeration` makes the maximum-length
  sparse-array regression fixture throw if key enumeration is attempted, so a regression
  fails without performing excessive work.
- The final documentation commit records these results.

Seven added regression cases cover oversized sparse arrays, array/object cardinality
after earlier siblings consume values, exact-limit acceptance, and stopping descriptor
inspection when a nested value exceeds the budget. All four public derivation functions
are checked for typed rejections.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/docs-outline.test.ts --coverage.include='src/apps/docs/lib/outline/**/*.ts'` | PASS: 100 tests; outline statements, branches, functions and lines all 100%. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS: 21 existing Money budget warnings. The final regression-fixture adjustment also passed a focused Biome check. |
| `pnpm --filter @jeswr/suite-ui run build` | PASS. |
| `pnpm --filter @jeswr/app-suite run build` | PASS: Next.js production build. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 28 files, 1,277 tests; all configured coverage metrics 100%. |
| `pnpm run lint:root` | PASS: root lint and all guards. |
| `TURBO_SCM_BASE=dc683d98378750d7524af88c68457af08d3f1947 pnpm run gate` | PASS: 6/6 tasks. |
| `pnpm run gate:full` | FAIL (exit 1): 208 successful tasks / 289 scheduled; the same two existing `@jeswr/federation-codegen#test` failures detailed above (bookmarks namespace and generated ontology drift). |
| `git diff --check` | PASS. |
| `roborev status` | UNAVAILABLE: exit 127, `roborev: command not found`. |

An initial app test run collided with the focused test run's shared coverage directory;
the sequential rerun passed, as did the affected gate. No full-workspace success is claimed.
The unrelated federation-codegen files remain unchanged. The review finding is addressed;
no implementation work or new questions remain. Dispatcher review remains necessary because
roborev is unavailable. No dependencies, UI, tracker state, remotes, other checkouts or
branch selection were changed.
