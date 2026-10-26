<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-xgqz — MAI-L6 address lists and recipient autocomplete

Implemented on `lane/sst-xgqz`, 2026-10-26. Base:
`9d38e053caf7381de3b97b5d79075647f55d6a05`.

## Commits

| Commit | Change |
| --- | --- |
| `2e8bfa4f` | `feat(mail): add strict address list utilities` — parsing/formatting, groups, stripped comments, quoted strings, IDN conversion, normalised deduplication, recipient ranking, public barrel, API documentation and conservative interpretations. |
| `42f73d97` | `test(mail): cover address parsing and recipient ranking` — 151 synthetic tests, generated quoting round trips, adversarial inputs and the address coverage glob. |
| `30a011cb` | `chore: merge local main before lane verification` — merged `origin/main` at `67abf7f1d67285756c2e31e6b2ab801d93cea95a`, fetched solely from the permitted local source clone `/home/runner/work/solid-sdk`. |
| Final documentation commit | `docs: record mail address lane verification` — this report. |

## Validation

Node `24.22.1`, pnpm `10.4.1`. Commands ran from this checkout's root. For the
dependency build and workspace gates, the shell first ran
`export PATH="$PWD/node_modules/.bin:$PATH"` so packages without their own
`node_modules` could resolve the workspace TypeScript/Biome tools. The initial
dependency build failed on `suite-vocab`'s missing `tsc` command before this environment fix;
its rerun passed. An early app typecheck before dependency builds likewise lacked workspace
declarations; all final app checks below passed after building dependencies.

| Exact command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS; refreshed links after the prescribed merge, without lifecycle scripts or lockfile edits. Existing unbuilt workspace CLI bin warnings only. |
| `pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4` | PASS; five app dependency builds. |
| `pnpm --filter @jeswr/app-suite exec biome check --write src/apps/mail/lib/address test/mail-address.test.ts` | PASS; new source/test files have no lint warnings. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/mail-address.test.ts --coverage.include='src/apps/mail/lib/address/**/*.ts'` | PASS; 151 tests; 100% statements, branches, functions and lines for every address TypeScript file. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS after the merge; 122 test files, 6,564 tests. Existing lint warnings only. Full configured suite coverage is 100% across all four metrics, including every address file. |
| `pnpm run lint:root` | PASS; workspace/layer/transport/fetch/token/contrast guards, including 74 contrast pairs with zero failures. |
| `TURBO_SCM_BASE=9d38e053caf7381de3b97b5d79075647f55d6a05 pnpm run gate` | FAIL (exit 1); 286 successful tasks, 347 total. Inherited `@jeswr/federation-trust#test` snapshot mismatch described below. |
| `pnpm run gate:full` | FAIL (exit 1); 285 successful tasks, 346 total, 163 cached. Same inherited snapshot mismatch. |
| `git diff --check` | PASS. |
| `roborev status` | Unavailable (exit 127): `roborev` is not installed in this environment; no automated review verdict was available. |

Both workspace gates fail in
`packages/federation-trust/test/characterization.test.ts:196`,
“delegation credential structure is stable”. Its inline snapshot expects the
serialized public `delegateKey` JWK properties in `crv,x,kty` order; this runtime
emits `kty,crv,x`. There is no lane diff against merged main in federation-trust.
The unrelated snapshot was left untouched. These fail-fast gates do not establish
that every remaining workspace task passed. The complete standalone app-suite gate
above passed independently.

Workspace builds generated `clientid.jsonld` and `callback.html` under eight pod-app
`web/public/` directories. Those untracked build artifacts were removed after verification.
No generated build output is included in lane commits.

## Dependencies, scope and questions

- No new dependencies or manifest changes: `check:packages` was not needed. Dependency
  changes inherited through the prescribed main merge are not lane additions.
- Production code is plain synchronous browser-compatible TypeScript under the requested
  `apps/suite/src/apps/mail/lib/address/` directory, with no React/hooks/fetch/I/O.
- No UI surfaces were built. Screenshots, fixture routes, axe and Playwright runs are not
  applicable to this pure-library task; no PNGs were produced or committed.
- `QUESTIONS.md` records the three nonblocking conservative interpretations: preserve local
  case, use deterministic frequency/recency ordering, and reject unsupported address syntax.
  The library README specifies the exact supported grammar, limits and API behavior.
- Implementation and app acceptance checks are complete. Remaining verification limitations
  are the inherited workspace snapshot failure and the unavailable roborev review.
- No push, PR, network-remote fetch, branch switch or edits to another checkout occurred.
  Bead closure remains with the dispatcher when the lane lands on main.

## Codex fix round 2 — 2026-10-26

Base: `77047d1785a188e0e0b1d790fa85a1930447335a`. This round addresses only
the review finding about incomplete Unicode case folding in recipient autocomplete.

### Commits and behavior

- `0dd65c68` — `fix(mail): fully fold Unicode recipient prefixes`: reuse the existing
  Unicode 17 default full-fold table for query and candidate keys, normalize the folded
  result to NFC, and document the matching behavior. No dependency or shared-table changes.
- Added 20 regression cases covering sharp S in both directions, expanding ligatures,
  non-Latin and supplementary characters, combining-mark normalization after folding,
  contact/recent names, address prefixes and Unicode domains. Folding changes only search
  keys; returned recipient values keep their existing normalization. Matching remains
  locale-independent and accent-sensitive, with fullwidth distinctions preserved.
  Existing sigma-prefix regressions still pass.
- Final documentation commit — `docs: record Unicode autocomplete fix validation`:
  this round's results and limitations.

### Validation

Node `24.22.1`, pnpm `10.4.1`. Each pnpm command below ran after
`export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"` from this checkout's root.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4` | PASS; five dependency builds. |
| `pnpm --filter @jeswr/app-suite exec biome check src/apps/mail/lib/address/rank.ts test/mail-address.test.ts` | PASS; both changed TypeScript files have no lint diagnostics. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/mail-address.test.ts --coverage.include='src/apps/mail/lib/address/**/*.ts'` | PASS; 183 tests and 100% statements, branches, functions and lines. The new positive regressions reproduced the matching defect before the fix. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; 122 test files, 6,596 tests, 100% configured coverage across all four metrics. Existing app lint warnings only. |
| `pnpm run lint:root` | PASS; all root guards, including 74 contrast pairs with zero failures. |
| `TURBO_SCM_BASE=77047d1785a188e0e0b1d790fa85a1930447335a pnpm run gate` | PASS; 10 successful tasks, five cached. |
| `pnpm run gate:full` | FAIL (exit 1); 58 successful tasks, 220 total, seven cached. Two root timing failures described below. |
| `pnpm exec turbo run test:root --filter=// --concurrency=1` | FAIL (exit 1); isolated root rerun: 744 of 745 tests passed. The dependency-spec performance assertion still failed. |
| `git diff --check` | PASS. |
| `roborev status` | Unavailable (exit 127); roborev is not installed. |

The full workspace gate stopped in root tests: the import-path rejection case in
`test/agent-layers.test.mjs:509` exceeded its 5-second timeout, and the pathological
dependency-spec check in `test/check-sdk-layers.test.mjs:328` took 58.7 ms against a
50 ms limit. Rerunning the root suite without competing Turbo tasks cleared the timeout,
but the performance check still took 59.1 ms. Neither test nor its guarded scripts has
a diff from this round's base. They were left unchanged. The full gate's fail-fast exit
does not establish that all remaining workspace tasks passed; the app and affected gates
passed independently. Automated roborev review remains unavailable.

No new dependencies, UI changes or committed generated artifacts. No branch switches,
git fetches, merges, pushes, PRs or edits to other checkouts. No screenshots apply to this
pure-library fix. The review finding is fixed; no implementation work or open questions remain.
The remaining verification limitations are the root timing failure and unavailable roborev.
