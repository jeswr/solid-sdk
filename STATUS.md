<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-kw9b — MON-00 Money model

Branch: `lane/sst-kw9b`. Base: `67abf7f1d67285756c2e31e6b2ab801d93cea95a`.

Implemented only `apps/suite/src/apps/money/lib/model/`, its tests and coverage inclusion. No React/hooks, suite-sdk, shell, routes or UI. No new dependencies, manifest or lockfile changes. No pushes, PRs, branch switches or remote fetches/merges.

Commits:

- `a4895b90 feat: add typed money model and ledger helpers` — typed RDF accessors; canonical/legacy read convergence; account and balance snapshots; exact decimal ledger calculations; inclusive UTC month routing; category hierarchy validation; transfer pairs; pure tests.
- `88927fa1 feat: add conditional money storage and statement imports` — injected, scoped fetch; account listing/latest balances; monthly ledger reads and conditional mutations; one-shard transfer writes; original statement storage and provenance; mapped CSV/OFX and injected PDF adapter; protocol/import tests; 100% model coverage enforced in app configuration; API documentation and QUESTIONS.md.
- `docs: record money model lane validation` — final commit records this report after verification.

Verification environment: Node `v24.22.1`, pnpm `10.4.1`. Commands below ran from the checkout root with `export PATH="$PWD/node_modules/.bin:$PATH"` so Turbo-spawned package scripts could find the root TypeScript binary. Lifecycle scripts remained disabled.

Preparation:

- `pnpm install --frozen-lockfile --offline` — PASS, locked dependencies only; no tracked changes. Warned about not-yet-built unrelated workspace CLI binaries.
- `pnpm exec turbo run build --filter '@jeswr/app-suite^...' --concurrency=4` — PASS, all five existing app prerequisite packages built. Before adding the root `.bin` to PATH, suite-vocab's build reported `tsc: not found`; fixed through the command environment, without repository changes. An early app typecheck before prerequisite builds likewise reported missing workspace dist declarations; resolved by building prerequisites.

Commands and results:

- `pnpm exec biome check --write apps/suite/src/apps/money/lib/model apps/suite/test/money-model*.ts apps/suite/vitest.config.ts` — PASS, no new warnings.
- `pnpm --filter @jeswr/app-suite exec vitest run test/money-model.test.ts test/money-model-io.test.ts --coverage.include='src/apps/money/lib/model/**/*.ts'` — PASS, 21 tests. Model coverage: 100% statements (349/349), branches (152/152), functions (96/96), lines (317/317), including the barrel. No coverage exclusions or ignore markers.
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` — PASS. Lint exits 0 with 54 existing warnings in other library directories. Next production build and TypeScript passed. 123 test files, 6,434 tests passed; app coverage 100% in all four metrics.
- `pnpm run lint:root` — PASS, including workspace, dependency layers, token and contrast checks (74 contrast pairs, zero failures).
- `TURBO_SCM_BASE=67abf7f1d67285756c2e31e6b2ab801d93cea95a pnpm run gate` — PASS, 11/11 Turbo tasks successful (5 cached), including 745 root tests and the app tests. An initial overlapping invocation hit Next's build lock while the direct app build was running; the required gate was restarted after the direct command completed.
- `pnpm run gate:full` — FAIL outside this lane: 282 tasks successful of 345 total before Turbo stopped on `@jeswr/federation-trust#test`. `test/characterization.test.ts:196` expects serialized delegateKey JWK properties in `crv,x,kty` order but receives `kty,crv,x`; 53 tests passed and that single snapshot failed. The concurrent untouched Coeliac build emitted a dynamic-import warning, compiled successfully, then reported EPIPE and a segmentation fault during shutdown. Neither package was modified; the failure was not patched outside the lane scope. App and affected gates passed separately. Generated untracked pod-* web callback/client-ID files were removed after this check to restore the clean lane tree.
- `git diff --check` — PASS.

Tests exercise synthetic CSV, SGML OFX and XML OFX fixtures, arbitrary decimal precision, shard boundaries/year rollover/leap day/December 9999, deterministic running balances and filtered opening rows, latest dated/undated balance selection, legacy categories and parents including named graphs, blank-node amounts, transfer symmetry, guarded scope/redirects, missing resources, strong validators, 412/403/network failures, preserving unrelated/shared RDF, and statement upload ordering/provenance/partial failures.

Dependencies / check:packages: not applicable; no dependencies added. Screenshots, fixture routes, Playwright and axe: not applicable; this lane renders no UI, and no browser was launched.

Limitations and questions:

- `QUESTIONS.md` records conservative readings for PDF extraction, explicit currency and transfer-pair representation. The existing PM statement adapter implements CSV/OFX, not PDF; this lane delivers a tested injected PDF adapter contract, not a new layout/OCR engine.
- Account selection/currency and the opening balance before the first loaded month are explicit caller inputs. The model does not infer them. The caller provisions the money container and child containers/access controls; hooks and Type Index wiring belong to MON-01.
- Multi-month imports are conditional per shard, not globally atomic. A later failure leaves the stored original and any earlier successful shards intact for explicit recovery; deterministic row IDs allow inspection. Single-leg transfer edits/deletions are rejected. Paired transfer editing and implicit cross-month moves are outside this brief.
- `roborev` is not installed (`command -v roborev` returned no executable). Automated per-commit review could not run and remains an integrator/environment follow-up; no verdicts are claimed. Code and protocol edge cases were reviewed locally and exercised in the tests.

## Fix round 2 — sst-kw9b

Review head: `ffa8273b633ddc5c4d748e65db8f3a1f84c1a76a`. Fixed only the four supplied data-integrity findings, their regression tests and the related model documentation.

Commits:

- `db129ab3 fix: isolate money amount nodes from ledger records` — allocate blank monetary nodes without overlapping record IRIs or existing blank labels; reuse exclusively owned amounts; preserve shared amounts on edits and legacy monetary data on deletion. Tests cover named/blank sharing, balance isolation, suffix-keyed transactions, deletion in both orders, and existing mixed transaction/amount subjects.
- `52699008 fix: qualify imported money rows by statement format` — derive row IDs from statement key, format and index. A shared-shard CSV/OFX/PDF regression preserves all five rows, account associations, currencies and provenance; IDs remain deterministic and accept the full statement-key length.
- `f3552b2b fix: reject named graphs before writing money Turtle` — keep the existing Turtle API and `.ttl` layout, conservatively rejecting named graphs before serialization or any PUT. Tests read TriG with named/blank graph labels and JSON-LD named graphs, then verify rejection without changing the original resource or in-memory dataset. The API documentation states this write restriction.
- `7902ac2f test: verify amount cleanup across RDF parses` — count remaining monetary subjects after deletion, so the assertion does not depend on blank node labels surviving separate parses.
- `docs: record money review fix validation` — final report commit, after the checks below.

Commands ran from this checkout with `export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"` (Node `v24.22.1`, pnpm `10.4.1`). No dependencies were added or installed, and lifecycle scripts stayed disabled.

Validation:

- `pnpm exec turbo run build --filter '@jeswr/app-suite^...' --concurrency=4` — PASS, five prerequisite packages. The first targeted test invocation, before these dist outputs existed, could not resolve workspace entries; building prerequisites resolved it.
- `pnpm exec biome check apps/suite/src/apps/money/lib/model apps/suite/test/money-model*.ts` — PASS, no warnings in the changed model/tests.
- `pnpm --filter @jeswr/app-suite exec vitest run test/money-model.test.ts test/money-model-io.test.ts --coverage.include='src/apps/money/lib/model/**/*.ts'` — PASS, 34 tests; 100% statements (362/362), branches (174/174), functions (99/99), lines (328/328). No coverage thresholds or exclusions changed. The import and named-graph regressions failed against the preceding implementations before their fixes.
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` — PASS; 123 files and 6,447 tests, 100% app coverage in all four metrics. Lint exits zero with the same 54 existing warnings in unrelated files.
- `pnpm run lint:root` — PASS, including workspace/layer guards, tokens and all 74 contrast checks.
- `TURBO_SCM_BASE=ffa8273b633ddc5c4d748e65db8f3a1f84c1a76a pnpm run gate` — PASS after the final test adjustment, 10/10 tasks (five cached), including lint, build, typecheck and all 6,447 app tests.
- `pnpm run gate:full` — FAIL outside the changed paths: `test/check-sdk-layers.test.mjs:328`, “validates pathological specs in under 50 ms each,” measured 119.674918 ms against its 50 ms bound. Root tests had 744 passes and one failure; Turbo reported 53 successful tasks of 217 before stopping. No unrelated code or timing threshold was changed.
- `pnpm run test:root` — PASS on an isolated rerun after the full gate stopped: nine files, all 745 tests, including the timing check. This does not change the failed full-gate result above.
- `git diff --check` — PASS.

All four requested fixes are complete. The conservative named-graph rejection is intentional; graph-capable writing was not added. No new open questions, UI changes, screenshots or dependency-policy checks apply. The full-workspace timing failure remains recorded above. `roborev` is still unavailable (`command -v roborev` returns no executable); no automated review verdict is claimed. Work stayed on `lane/sst-kw9b` in this checkout, with no pushes, PRs, branch switches or remote fetches/merges.

## Fix round 3 — sst-kw9b

Review head and gate base: `0defc110014a43f691aca15a6d29e39e6501d7cb`. Fixed only the two supplied findings, with regression tests and the corresponding API documentation.

Commits:

- `ef815387 fix: reject money imports with multiple source accounts` — reject rows with different source account IDs before any request. Conservatively reject known IDs mixed with unidentified rows too. SGML OFX, QFX and XML fixtures exercise rejection and verify that repeated sections for the same source account remain accepted. No source-account mapping API was added.
- `37a7bb06 fix: accept generated money IDs for deletion` — separate bounded caller keys from generated transaction fragments. Deletion accepts complete format/index suffixes while preserving the fragment character restrictions and the 128-character statement-key limit. Regressions import and delete every CSV/OFX/PDF row using a maximum-length key, including a two-digit PDF row index, and preserve unrelated ledger rows and the stored original. Malformed deletion fragments and oversized statement keys fail before any request.
- `docs: record money round three validation` — final report commit after the checks below.

Commands ran from this checkout with `export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"` (Node `v24.22.1`, pnpm `10.4.1`). No dependencies were added or installed; lifecycle scripts remained disabled.

Validation:

- `pnpm exec turbo run build --filter '@jeswr/app-suite^...' --concurrency=4` — PASS, five prerequisite packages.
- `pnpm --filter @jeswr/app-suite exec vitest run test/money-model-io.test.ts --coverage.enabled=false -t 'OFX/QFX source accounts'` — expected FAIL before the account fix, three regressions demonstrating that different accounts were silently combined.
- `pnpm --filter @jeswr/app-suite exec vitest run test/money-model-io.test.ts --coverage.enabled=false -t 'maximum-length statement key'` — expected FAIL before the deletion fix, all three formats failing deletion with `Invalid money ID` after successful import.
- `pnpm exec biome check --write apps/suite/src/apps/money/lib/model apps/suite/test/money-model-io.test.ts` — PASS.
- `pnpm --filter @jeswr/app-suite exec vitest run test/money-model.test.ts test/money-model-io.test.ts --coverage.include='src/apps/money/lib/model/**/*.ts'` — PASS, 45 tests; 100% statements (368/368), branches (178/178), functions (101/101), lines (332/332). Coverage thresholds and exclusions are unchanged.
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` — PASS, all 123 files and 6,458 tests; 100% app coverage in all four metrics. Lint exits zero with the same 54 existing warnings in unrelated files.
- `pnpm run lint:root` — PASS, including workspace/layer guards and all 74 contrast checks.
- `TURBO_SCM_BASE=0defc110014a43f691aca15a6d29e39e6501d7cb pnpm run gate` — PASS, 10/10 tasks (five cached), including the app build, typecheck and tests.
- `pnpm run gate:full` — FAIL outside this lane after 284 successful tasks of 347 total (nine cached). `@jeswr/federation-trust#test` fails `test/characterization.test.ts:196`: the delegateKey snapshot expects JWK properties in `crv,x,kty` order but receives `kty,crv,x`; 53 tests pass and one fails. This is the same failure recorded in the original lane validation. All 745 root tests pass in this run. No unrelated snapshot or code was changed. The generated untracked pod-* public callback/client-ID files were removed after the check.
- `git diff --check` — PASS.

Both requested fixes are complete. No new open questions, UI work, screenshots or dependency-policy checks apply. The full-workspace failure remains outside the lane scope. `roborev` is still unavailable (`command -v roborev` returns no executable), so no automated commit review verdict is claimed. Work stayed on `lane/sst-kw9b` in this checkout, with no pushes, PRs, branch switches or remote fetches/merges.

## Fix round 4 — sst-kw9b

Review head and affected-gate base: `33a3a5d7b3f72a6fb723a23dced9e6b9ca12a678`. Fixed only the two supplied RDF reader/allocation findings and added regression tests.

Commits:

- `5b7a01dd fix: normalize legacy money numeric literals` — expand typed double/float exponent notation and normalize supported decimal/integer lexical forms using string operations, preserving every significand digit. Canonical and legacy amount predicates share this reader. Tests cover transaction/balance reads, positive/negative and tiny/large exponents, precision beyond JavaScript numbers, unchanged RDF literals, round trips and invalid/non-finite forms. String-valued amounts retain decimal-only validation.
- `8d4c6d4e fix: reuse document money blank node allocator` — reserve existing subject/object/graph blank labels once per document and allocate monotonically, with indexed candidate checks protecting labels introduced through the public dataset/accessors after construction. Tests preserve existing labels and records, exercise both construction timings, and append 250 transactions without a full-dataset traversal.
- `docs: record money round four validation` — final report commit after the checks below.

Commands ran from this checkout with `export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"` (Node `v24.22.1`, pnpm `10.4.1`). No dependencies were added or installed; lifecycle scripts remained disabled.

Validation:

- `pnpm exec turbo run build --filter '@jeswr/app-suite^...' --concurrency=4` — PASS, five prerequisite packages.
- `pnpm --filter @jeswr/app-suite exec vitest run test/money-model.test.ts --coverage.enabled=false -t 'exact decimal for transactions and balances'` — expected FAIL before the numeric fix, all 11 regression cases rejected by decimal validation.
- `pnpm --filter @jeswr/app-suite exec vitest run test/money-model.test.ts --coverage.enabled=false -t 'without traversing the full dataset'` — expected FAIL before the allocator fix, observing 250 complete dataset traversals for 250 appends.
- `pnpm exec biome check --write apps/suite/src/apps/money/lib/model/rdf.ts apps/suite/test/money-model.test.ts` — PASS.
- `pnpm --filter @jeswr/app-suite exec vitest run test/money-model.test.ts test/money-model-io.test.ts --coverage.include='src/apps/money/lib/model/**/*.ts'` — PASS, all 68 tests; 100% statements (397/397), branches (200/200), functions (103/103), lines (356/356). Coverage thresholds and exclusions are unchanged.
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` — PASS, all 123 files and 6,481 tests; 100% app coverage in all four metrics. Lint exits zero with the same 54 existing warnings in unrelated files.
- `pnpm run lint:root` — PASS, including workspace/layer guards and all 74 contrast checks.
- `TURBO_SCM_BASE=33a3a5d7b3f72a6fb723a23dced9e6b9ca12a678 pnpm run gate` — PASS, 10/10 tasks (five cached), including the app build, typecheck and tests.
- `pnpm run gate:full` — FAIL outside this lane after 65 successful tasks of 243 total (seven cached). `test/check-sdk-layers.test.mjs:328`, “validates pathological specs in under 50 ms each,” measured 275.97329099999934 ms against its 50 ms bound; the other 744 root tests passed. This timing check also failed during fix round 2. No unrelated code or timing threshold was changed.
- `pnpm run test:root` — PASS in isolation after the full gate stopped: all nine files and 745 tests, including the timing check. This does not change the failed full-gate result above.
- `git diff --check` — PASS. The gates produced no untracked files requiring cleanup.

Both requested fixes are complete. No new open questions, UI work, screenshots or dependency-policy checks apply. The full-workspace timing failure remains recorded above. `roborev` is still unavailable, so no automated commit review verdict is claimed. Work stayed on `lane/sst-kw9b` in this checkout, with no pushes, PRs, branch switches or remote fetches/merges.
