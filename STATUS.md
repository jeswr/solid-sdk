<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DOC-00 / sst-f77f lane status

Branch: `lane/sst-f77f`. Base: `606c87b7edf73e83f118f95295b0eeda7abb6d92`.

## Implementation commits

- `1def6c23 feat: add docs RDF model and revision policy` — ported Pod Docs typed RDF model, alias-aware readers/canonical writers, integer word count, document container links, provenance, named revisions, ten-minute auto revisions, 100-auto retention and chain relinking. Added layout/validation helpers and the RDF dependencies already present in the workspace lockfile.
- `ad1fe6f5 feat: add docs persistence and copy seams` — required injected account fetch, private Type Index registration, conditional snapshot saves with fresh-state regeneration and 2/4/8-second retry backoff, structured title conflicts, registered legacy read-only listing, create-only slug collision handling and copy adapters. Added regression/property tests and strict coverage thresholds.
- `01ace9dc fix: prevent docs revision identifier collisions` — exact revision numbering beyond the JavaScript safe integer limit, original creator versus editing author tests, long copy titles/source slugs, and removed obsolete global-fetch tests.
- `d86f1ed4 test: stabilize docs retention property checks` — reduced assertion overhead and added an explicit workload timeout after the default five-second timeout was reached once.

- `9c8c6f63 fix: pass copied asset URLs to state persistence` — passes the identical asset remapping to both snapshot generation and full-state persistence; the copy test checks rewritten references in the persisted update state.

All implementation lives in `apps/suite/src/apps/docs/lib/model/`; tests live in `apps/suite/test/docs/`. No React, hooks, suite SDK, routes, shell or UI was added. Existing Pod Docs code stays available unchanged; the suite ports its model modules instead of changing the legacy application's behavior.

## Validation

Commands run with `export PATH="$PWD/node_modules/.bin:$PATH"` so packages without their own tool dependencies can find the repository's root tools.

- `pnpm run check:packages @jeswr/fetch-rdf @rdfjs/wrapper @solid/object n3 @rdfjs/types @types/n3 @vitest/coverage-v8` — PASS, all seven cleared. These dependencies support the brief's typed RDF I/O and mandated coverage; all resolved versions already existed in the lockfile. `@jeswr/suite-vocab` is an internal `workspace:*` dependency.
- `pnpm install --ignore-scripts` — PASS; lifecycle scripts stayed disabled. Lockfile changes only add the suite app's dependency edges.
- `pnpm --filter @jeswr/suite-vocab run build` and `pnpm --filter @jeswr/suite-ui run build` — PASS; required before the app resolves workspace declarations.
- `pnpm --filter @jeswr/app-suite run test:coverage` — PASS: 9 files / 136 tests; 100% statements (420/420), branches (210/210), functions (113/113), and lines (381/381) across every file in `lib/model`.
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` — PASS on the final implementation: Biome clean, Next production build green, strict typecheck green, 9 test files / 136 tests green.
- `pnpm run lint:root` — PASS, including workspace/lockfile/fetch/token guards and all 74 contrast pairs.
- `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` — PASS on the final implementation: 8/8 tasks successful (2 cached); includes the root test suite (41 tests) and the suite app (136 tests).
- `pnpm run gate:full` — FAILED outside this lane: `@jeswr/unstorage-solid#build` invokes a dependency bootstrap whose `npm install --ignore-scripts` cannot write `/home/runner/.npm/_cacache` (`EROFS`, read-only sandbox). Turbo stopped with 32 successful / 171 total tasks; no full-workspace pass is claimed. This full-workspace attempt preceded the final adapter fix; the observed external failure was left unchanged. The existing bootstrap also clones its upstream dependency to a temporary directory; this lane did not change it or manually fetch/merge any remote, and did not rerun that build.
- `git diff 606c87b7edf73e83f118f95295b0eeda7abb6d92 --check` — PASS.

The generated property test checks 12 seeded sequences of 400 saves each: every predecessor link, uniqueness/acyclicity, the automatic revision cap, and all named revision labels. Its original per-node assertions exceeded Vitest's default five-second timeout once under concurrent work; the final version compares the complete link vector per save and gives this workload a 30-second timeout.

## Boundaries and open questions

Conservative interpretations are committed in `QUESTIONS.md`: three retries after the first PUT; captured editor-state adapters for copy; only registered legacy containers are listed; generated copy titles are capped at 200 characters. `docContainerUrls` accepts an absolute resource URL or a slug plus the docs container; `DocsStore.docContainerUrls(slug)` binds the selected storage.

DOC-01/DOC-05 supply hooks, editor/CRDT adapters, HTML sanitization, UI conflict handling, save scheduling/outbox integration and Drive trash semantics. A successful copy waits for asset writes, full-state persistence and the final HTML snapshot; a failed copy propagates its error and may leave newly allocated resources for the caller to recover. It does not copy comments, historical revisions or access grants. Servers without ETags receive `If-Match: *` on snapshot replacement; this guards existence but cannot detect concurrent edits without server ETag support.

Screenshots/Playwright/axe: not applicable because this lane builds no UI; no browser was launched.

`roborev status` could not run (`roborev: command not found`, exit 127); no post-commit review hook is installed in this checkout. Automated per-commit review remains for the dispatcher; this lane did not install tooling or push/open a PR.

Implementation is complete for DOC-00. Final documentation commit: `docs: record DOC-00 lane validation` (this file, committed last after verification). Full-workspace validation and automated review are the only uncompleted checks; neither required changing this lane's model implementation.

<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 1

Starting head: `f66e87fa0c7c86b3ffafbdb3cc55cec0f6597c1c`. All three supplied review findings are addressed on `lane/sst-f77f`:

- `b7411eb1 fix: reserve fresh docs companion containers` — reserve the companion tree with create-only writes before publishing the document. A collision on any companion or the document advances the slug. Regression tests cover orphaned containers/updates, simultaneous creation, copying, and permission failures before document publication.
- `75b81f9a fix: bootstrap missing linked docs type indexes` — recover an explicit linked-index 404 with a create-only write at the advertised URL, then re-read and register using its fresh ETag. Tests cover concurrent bootstrap (412), preservation of other registrations, permission/network failures, bounded recovery, and document creation/copying.
- `5946529a fix: retain format changes in docs revisions` — compare both body and format after the ten-minute interval. Tests cover format-only saves before, at, and after the boundary.

Each regression was observed failing before its fix. The final app suite has 155 passing tests (19 more than the starting head). No dependencies, UI, or unrelated source files changed.

Validation on the final implementation:

- `PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/suite-vocab --filter @jeswr/suite-ui run build` — PASS; fresh-checkout workspace declarations are required before testing the app. The initial test attempt without these build outputs failed module resolution.
- `pnpm --filter @jeswr/app-suite run test:coverage` — PASS: 9 files / 155 tests; 100% statements (424/424), branches (213/213), functions (113/113), and lines (385/385).
- `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` — PASS, including the production build and all 155 tests.
- `pnpm run lint:root` — PASS.
- `PATH="$PWD/node_modules/.bin:$PATH" TURBO_SCM_BASE=f66e87fa0c7c86b3ffafbdb3cc55cec0f6597c1c GIT_ALLOW_PROTOCOL=file pnpm run gate` — PASS: 7/7 tasks successful.
- `PATH="$PWD/node_modules/.bin:$PATH" GIT_ALLOW_PROTOCOL=file pnpm run gate:full` — FAILED outside this lane: `@jeswr/unstorage-solid#build` runs `npm install --ignore-scripts` in its dependency bootstrap and hits `EROFS` writing `/home/runner/.npm/_cacache`. 32 successful / 171 total tasks (4 cached). The Git transport restriction supplied to this command was filtered by Turbo's environment handling: the existing bootstrap cloned its upstream dependency into a temporary directory before the npm failure. This breached the lane's no-fetch restriction despite the attempted guard; no further bootstrap attempt was made. No fetched changes were merged into this branch.
- `git diff f66e87fa0c7c86b3ffafbdb3cc55cec0f6597c1c --check` — PASS.
- `roborev status` — unavailable, exit 127 (`roborev: command not found`). Automated per-commit review remains for the dispatcher.

Conservative collision handling preserves existing resources and leaves any partial companion reservations in place; it never deletes a container that another writer might be using. Missing-index recovery shares the existing three-retry budget and does not rewrite an already-linked profile. No open implementation questions or unfinished fixes remain. Full-workspace validation and automated review remain incomplete for the reasons above. Final fix-round documentation commit: `docs: record docs review fix validation`.

<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 2

Starting head: `9e9f7ffbb1da2e4e2484e11192e7c00ecfcad165`. All four supplied findings are addressed on `lane/sst-f77f`:

- `df4e9fbc fix: preserve document format when copying` — carries the source format into the reservation, final snapshot and fresh revision. HTML/Markdown tests verify persisted and reopened content. The Markdown regression failed with `text/html` before the fix.
- `e8a33b1b fix: scope docs type index requests and redirects` — uses the shared `@jeswr/guarded-fetch` pod-scope guard for profile-derived index URLs, registration destinations, discovery, bootstrap and every index redirect hop. Discovery requires the selected storage root and filters foreign registered destinations. Profile I/O refuses redirects. Adds only the existing guard package as a `workspace:*` dependency; no third-party dependency versions changed.
- `c57175cd fix: retry concurrent private index profile linking` — retries profile-link 412s at most three times after the initial attempt, re-reading the profile and its ETag, preserving concurrent RDF changes and reusing a newly established link. Non-conflict failures propagate. Uses `If-Match: *` when the profile has no ETag.
- `7b6719b3 fix: verify private type index access before registration` — verifies direct or nearest inherited owner-only WAC access before linking an index and before private registration attempts. Checks all applicable authorization targets and principals, requires the owner's Read/Write/Control, and rejects public, other-agent, group or origin grants. Policy discovery and redirects stay within the selected pod. Tests also exercise simultaneous first-use document creation: one profile PUT succeeds, the other gets 412, and both documents persist.

The conservative privacy choice is verification without rewriting existing grants. Unreadable, absent, malformed, ACP or hybrid policies fail closed with an error; this lane does not implement ACP evaluation or replace access-control documents. An empty bootstrap index may remain after verification fails, but no profile link or private registration is written. This follows the existing Pod Manager's WAC-only, ACP-rejection approach. `solid:UnlistedDocument` is never treated as proof of privacy.

Validation on the final implementation:

- `PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/suite-vocab --filter @jeswr/suite-ui run build` and `PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/guarded-fetch run build` — PASS; built existing workspace dependencies for app resolution.
- `pnpm run check:packages @jeswr/guarded-fetch` — the registry-only name lookup failed because this internal package is unpublished. `pnpm run check:packages --mode policy @jeswr/guarded-fetch` — PASS. `pnpm run check:packages --scan apps/suite/package.json` — PASS, all 21 registry dependencies cleared; the scanner correctly excludes `workspace:*` edges from npm existence checks.
- `pnpm install --offline --ignore-scripts` — PASS. Removed unrelated pnpm peer-snapshot normalization from the lockfile diff; its only committed change is the app's workspace guard edge.
- `pnpm --filter @jeswr/app-suite run test:coverage` — PASS: 11 files / 209 tests; 100% statements (495/495), branches (275/275), functions (119/119), and lines (444/444) across `lib/model`. Added 54 tests relative to the starting head.
- `PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/app-suite run lint && PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/app-suite run build && PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/app-suite run typecheck && PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/app-suite run test` — PASS, including the Next production build and all 209 tests.
- `pnpm run lint:root` — PASS, including all workspace/transport/fetch/token guards and 74 contrast pairs.
- `PATH="$PWD/node_modules/.bin:$PATH" TURBO_SCM_BASE=9e9f7ffbb1da2e4e2484e11192e7c00ecfcad165 GIT_ALLOW_PROTOCOL=file pnpm run gate --env-mode=loose` — PASS: 9/9 tasks successful; includes the 41 root tests and 209 app tests.
- `PATH="$PWD/node_modules/.bin:$PATH" GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` — BLOCKED outside this lane: `@jeswr/unstorage-solid#build` invokes an existing upstream dependency bootstrap. Git rejected its HTTPS clone with `fatal: transport 'https' not allowed` before network transport. Turbo stopped with 32 successful / 169 total tasks (6 cached). The explicit loose environment mode preserves `GIT_ALLOW_PROTOCOL` in child tasks. No remote fetch or merge occurred.
- `git diff 9e9f7ffbb1da2e4e2484e11192e7c00ecfcad165 --check` — PASS.
- `roborev status` — unavailable (`roborev: command not found`, exit 127). The mandated automated review remains for the dispatcher; no tooling was installed.

No UI changed; screenshots/Playwright/axe are not applicable. No open implementation questions remain. Full-workspace validation and automated review remain incomplete for the external reasons above. Final documentation commit: `docs: record second docs review fix validation` (this file, committed last after the gates).


<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 3

Starting head: `d44f22bba23fd6377b4642b0410eb96f7190cbd7`. All three findings in the supplied round-three review are addressed on `lane/sst-f77f`:

- `7f41535d fix: refuse redirects in docs store requests` — wraps the injected account fetch with the shared redirect-refusal wrapper. Document reads/saves, container creation/listing, copied asset reads/writes, copy finalization, profile reads in `list()`, and the fetch passed to full-state persistence all force manual redirects and reject redirect responses. Fifteen regressions cover these paths and verify that no redirect destination is fetched; listing still isolates an unreadable child.
- `8505b9f2 fix: fall back from weak docs write validators` — weak ETags cannot satisfy strong `If-Match` comparison, so RDF replacement writes use the existing existence fallback (`If-Match: *`). Strong validators retain conflict detection; create-only writes use only `If-None-Match: *`. Regressions exercise saves, copy finalization, profile linking and index registration against a transport that rejects weak `If-Match`, and verify that successful weak-ETag operations do not enter conflict retries. Updated older assertions that expected weak validators to be forwarded.
- `5ddbe0b4 fix: capture docs snapshot format during retries` — requires `format` alongside `body` in regenerated and copied snapshots, and captures the initial save format with its body. Updated every local adapter fixture. HTML/Markdown conflict regressions check persisted/reopened body, format, word count and revision history, including regeneration that supersedes the initial input format.

The reported failures were reproduced before their fixes. The final app suite has 232 passing tests, 23 more than the starting head. No dependencies, UI or unrelated source files changed.

Validation on the final implementation:

- `PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/suite-vocab --filter @jeswr/suite-ui --filter @jeswr/guarded-fetch run build` — PASS; builds the existing workspace dependencies required by the app.
- `PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/app-suite run test:coverage` — PASS: 11 files / 232 tests; 100% statements (496/496), branches (281/281), functions (119/119), and lines (446/446) across `lib/model`.
- `PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/app-suite run lint && PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/app-suite run build && PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/app-suite run typecheck && PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter @jeswr/app-suite run test` — PASS, including the Next production build and all 232 tests.
- `pnpm run lint:root` — PASS, including workspace/transport/fetch/token guards and all 74 contrast pairs.
- `PATH="$PWD/node_modules/.bin:$PATH" TURBO_SCM_BASE=9e9f7ffbb1da2e4e2484e11192e7c00ecfcad165 GIT_ALLOW_PROTOCOL=file pnpm run gate --env-mode=loose` — PASS: 9/9 tasks successful (0 cached); includes 41 root tests and 232 app tests. Log: `/tmp/sst-f77f-round3-gate.log`.
- `PATH="$PWD/node_modules/.bin:$PATH" GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` — BLOCKED outside this lane: `@jeswr/unstorage-solid#build` invokes its existing dependency bootstrap, and Git refuses its HTTPS clone with `fatal: transport 'https' not allowed` before network transport. Turbo stopped with 12 successful / 124 total tasks (5 cached). No remote fetch or merge occurred. Log: `/tmp/sst-f77f-round3-full-gate.log`.
- `git diff d44f22bba23fd6377b4642b0410eb96f7190cbd7 --check` — PASS.
- `roborev status` — unavailable, exit 127 (`roborev: command not found`); automated per-commit review remains for the dispatcher.

Conservative choices: store account requests refuse every redirect, and weak validators use the existing no-validator existence policy. `If-Match: *` prevents replacement of a missing resource but cannot detect concurrent edits. Snapshot adapters must now return their captured body's format explicitly. No open implementation questions or unfinished fixes remain. Full-workspace validation and automated review remain incomplete for the external reasons above. No UI changed, so screenshots/Playwright/axe are not applicable. Final documentation commit: `docs: record third docs review fix validation` (this file, committed last after the gates).
