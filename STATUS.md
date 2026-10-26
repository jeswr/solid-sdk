<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-qef — VOC-04 lane report

Implemented on `lane/sst-qef`, based on
`606c87b7edf73e83f118f95295b0eeda7abb6d92` (`suite/integration`).

## Commits

- `1916ba71` — `chore(vocab): wire VOC-04 namespace dependencies`: workspace-only
  suite-vocab dependencies and lockfile entries; regression for the already-present
  read-only pod-money alias; conservative interpretations in `QUESTIONS.md`.
- `443a10ef` — `feat(money): migrate categories to the finance vocabulary`: write
  `fin:BudgetCategory` and `skos:broader`, accept old category/parent resources,
  canonicalize existing finance/core/money vocabulary in memory and on serialization,
  preserve conditional-save preconditions, resource identifiers and literal text.
  Retain `PmClass.Category` as a deprecated API alias. Update metadata and seed bases.
- `54539420` — `feat(chat): remint pc vocabulary with legacy read aliases`: canonical
  pc: constants from suite-vocab in Chat and interop, legacy room/participant/Type Index
  read compatibility, canonical serializers, metadata and seeds; add
  `apps/pod-chat/vocab/pod-chat.ttl` and canonical/legacy regression tests.
- `787c7746` — `fix(chat): canonicalize supplied serializer prefixes`: prevent legacy
  namespace declarations from caller-supplied prefix maps; regression included.
- Final `docs:` commit — this status report, committed after the required checks.

## Verification

Commands ran from this checkout with the following environment setup, because the
suite-vocab package has no local tool binaries and the runner's inherited PATH has
only a relative `node_modules/.bin` entry:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
```

Dependency setup:

```sh
pnpm install --ignore-scripts --offline
pnpm exec turbo run build --filter=@jeswr/solid-chat-interop^...
```

Both passed. Install used the existing offline dependency cache; lifecycle scripts
stayed disabled. Unrelated pnpm peer snapshot rewrites were discarded, leaving only
three new workspace dependency entries. No third-party dependency was added;
`check:packages` results: not applicable (only existing `@jeswr/suite-vocab` workspace
links were added). No project inventory changes were needed.

The following exact sequence passed for each of
`@jeswr/app-pod-money`, `@jeswr/app-pod-chat`, `@jeswr/solid-chat-interop`, and
`@jeswr/suite-vocab`:

```sh
for pkg in @jeswr/app-pod-money @jeswr/app-pod-chat @jeswr/solid-chat-interop @jeswr/suite-vocab; do
  pnpm --filter "$pkg" run lint && pnpm --filter "$pkg" run build && pnpm --filter "$pkg" run typecheck && pnpm --filter "$pkg" run test || exit "$?"
done
```

Unit test totals: Money **148**, Chat **228**, interop **89**, suite-vocab **47**.
After the final prefix fix, the Chat sequence was repeated and passed; the final
workspace affected gate also rechecked final code and its dependents.

```sh
pnpm run lint:root
TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate
pnpm run gate:full
```

- Root lint: **PASS**, including workspace/lockfile guards, fetch checks, tokens and
  all 74 contrast pairs.
- Affected gate: **PASS** initially (65/65 tasks), then **PASS** on final code
  (69/69 tasks, 22 cached). The latter includes the dependent web applications.
- Full gate: **BLOCKED / exit 1**, in untouched
  `@jeswr/unstorage-solid#build`, after 9 successful tasks. Its existing
  `scripts/build-deps.mjs` requires a missing `@jeswr/fetch-rdf` dist, invokes a remote
  clone, and then runs `npm install --no-audit --no-fund --ignore-scripts --prefer-offline`.
  That npm command failed with `EROFS` for `/home/runner/.npm/_cacache/tmp/`.
  The full-gate invocation reached that existing remote clone before the failure;
  no further remote attempt was made. Inspection confirmed the installed dependency
  has neither source nor dist, so it cannot be built locally from installed files.
  Retrying that fallback would conflict with the lane's network and checkout rules.
  No unrelated build script or dependency was changed to bypass the failure.

Regression coverage includes legacy `pm:Category` read → conditional save as
`fin:BudgetCategory` with `skos:broader`, canonical and legacy room/participant fixtures,
Type Index read aliases, mutation/clearing without legacy-value resurrection, named
graph and resource-identity preservation, parseable pc: ontology terms, and grep-style
assertions that normal serialized output contains no `w3id.org/jeswr` namespace.
Vocabulary migration deliberately preserves arbitrary user resource identifiers and
literal contents, including strings containing an old namespace.

Build-generated untracked `web/public/{callback.html,clientid.jsonld}` artifacts were
removed. No dist output is committed. Screenshots: none; this task changes RDF data
and vocabulary metadata, with no UI behavior or layout changes.

## Remaining checks and questions

Implementation and requested package checks are complete. The unrelated full-workspace
build prerequisite remains blocked as described above. `roborev` is not installed
(`command -v roborev` returned no executable), so per-commit automated review could
not run; no tool installation or reviewer verdict is claimed.

The three conservative interpretations in `QUESTIONS.md` were applied. No unanswered
question blocks this lane. Bead state was not changed: the local tracking skill forbids
running `bd` from a worktree, and this lane is restricted to this checkout. No branch
switch, push, PR, merge, or intentional remote fetch was performed by lane commands;
the existing full-gate prerequisite's clone attempt is disclosed above.

## Fix round 1 — Type Index category compatibility

- `d833e206` — `fix(money): match retired category type registrations`: reuse the
  app's category-class mapping for both stored and requested Type Index classes.
  Discovery accepts retired `pm:Category`; registration reuses the existing
  subject and writes `fin:BudgetCategory`. Add 21 regressions covering all
  legacy/canonical category-class combinations, canonical new registrations,
  discovery without mutation, and distinct locations.
- Final `docs:` commit — record this fix round's validation below.

Commands ran with `export PATH="$PWD/node_modules/.bin:$PATH"`:

```sh
pnpm exec turbo run build --filter=@jeswr/app-pod-money^...
pnpm --filter @jeswr/app-pod-money run lint && pnpm --filter @jeswr/app-pod-money run build && pnpm --filter @jeswr/app-pod-money run typecheck && pnpm --filter @jeswr/app-pod-money run test
TURBO_SCM_BASE=09a2a51092f62f92f9109ef59c093ec4e5944fc0 pnpm run gate
GIT_ALLOW_PROTOCOL=file pnpm run gate:full
```

- Dependency build: **PASS**. Initial tests/build could not resolve suite-vocab's
  missing dist; building that workspace dependency resolved the prerequisite.
- Pod Money lint, build, typecheck, and tests: **PASS**, 169 tests in 10 files
  (31 Type Index tests).
- Affected gate: **PASS**, 6/6 tasks, including root lint and workspace guards.
- Full gate: **FAIL / exit 1**, 235 successful tasks out of 301 scheduled.
  Untouched `@jeswr/federation-codegen#test` has two failures in
  `test/generator.test.ts`: the bookmarks target-class expectation still uses
  w3id, and committed generated `ontology.ttl` differs from freshly generated
  canonical namespaces. Those paths have no changes in this fix round.
- The full gate's existing unstorage-solid dependency fallback ran a remote
  fetch-rdf clone into a temporary directory. The attempted restriction
  `GIT_ALLOW_PROTOCOL=file` did not reach the build subprocess through Turbo's
  environment filtering. This was a lane-rule breach; no further remote command
  was run, and no bypass or unrelated source fix was added.
- `roborev` remains unavailable (`command -v roborev` finds no executable).
  No automated per-commit review is claimed.

Removed only the untracked callback/client metadata files generated by the web
builds. No dependency, UI, tracker, branch, push, PR, or strategy changes.
Screenshots and dependency-policy checks: not applicable. The requested finding
is fixed; the unrelated full-gate failures and unavailable review remain.
No new open questions or conservative design interpretations were needed.

## Fix round 2 — Interop mirror dependency

- `12c39a35` — `fix(interop): inline vocabulary for mirror publishing`: bundle
  the private `@jeswr/suite-vocab` dependency with esbuild and declare it in
  `mirrorPublish.inlined`. Keep other published dependencies external and retain
  module paths, browser-safe root imports, and the Node-only shape entry. Emit
  declarations with tsc. Add three regressions for manifest rewriting without a
  suite-vocab SHA, JavaScript/declarations without suite-vocab imports, and built
  legacy vocabulary conversion plus shape-file access.
- Final `docs:` commit — record this fix round's validation.

Commands ran from this checkout:

```sh
pnpm run check:packages esbuild
pnpm install --ignore-scripts --offline
export PATH="$PWD/node_modules/.bin:$PATH"
pnpm exec turbo run build --filter=@jeswr/solid-chat-interop^...
pnpm --filter @jeswr/solid-chat-interop run lint && pnpm --filter @jeswr/solid-chat-interop run build && pnpm --filter @jeswr/solid-chat-interop run typecheck && pnpm --filter @jeswr/solid-chat-interop run test
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=a691897ba23ace4297dfa7a85bf32dfdb338498c pnpm run gate --env-mode=loose
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
```

- Dependency policy: **PASS**, esbuild cleared. Add only its build-time dependency
  at the existing workspace version, `0.28.1`. Offline install passed with
  lifecycle scripts disabled; discard unrelated pnpm peer snapshot rewrites.
- Dependency builds: **PASS**, 3/3 tasks.
- Interop lint, build, typecheck, and tests: **PASS**, 92 tests in 8 files.
  Initial lint found formatting in the new files; format them and rerun the full
  package sequence successfully.
- Affected gate, including root lint and dependent package checks: **PASS**,
  23/23 tasks.
- Full gate: **BLOCKED / exit 1**, 9 successful tasks of 63 scheduled before
  failure in untouched `@jeswr/unstorage-solid#build`. Its installed fetch-rdf
  dependency lacks dist, and its existing build fallback invokes a remote clone.
  Git rejected that clone with `fatal: transport 'https' not allowed`, before
  network access. `--env-mode=loose` ensures the protocol restriction reaches
  Turbo subprocesses. No remote source was fetched, and no unrelated source or
  prerequisite was changed to bypass this failure.
- `roborev` is unavailable (`command -v roborev` finds no executable), so no
  automated per-commit review is claimed.

The requested publishing finding is fixed. Conservatively use the review's
bundling option and leave suite-vocab private. No new open questions. No UI,
screenshots, tracker changes, pushes, PRs, branch switches, merges, or dist
commits. Remaining limitations are the unrelated full-gate prerequisite and
unavailable automated review described above.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 3 — Integrate main

- `cc4235e5` — `chore: merge main into vocabulary lane`: fetch from the local
  source clone and merge `origin/main` at
  `809c3c12b59847444c2b83be757b4813c4865579`. Resolve `reconcile.ts` by retaining
  main's pinned ActivityStreams context loader and this lane's pc: vocabulary
  canonicalizer. Preserve the category migration, legacy readers, canonical
  writers, regression tests, and interop bundling from the earlier rounds.
  Adapt the mirror test's SHA fixture and assertion for main's newly imported
  workspace `@jeswr/fetch-rdf` dependency.
- Final `docs:` commit — update this report last.

Main remains authoritative outside the existing VOC-04 files. Comparison against
`origin/main` found no differences outside Pod Chat, Pod Money, chat interop,
suite-vocab, the lane reports, and the regenerated lockfile. No design changes or
new dependencies were introduced in this round.

Start the lockfile from main's version, then regenerate it with pnpm, without
hand-merging entries:

```sh
GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/suite-vocab --filter @jeswr/app-pod-chat --filter @jeswr/app-pod-money --filter @jeswr/solid-chat-interop install --lockfile-only --ignore-scripts --offline --config.dedupe-peer-dependents=false
GIT_ALLOW_PROTOCOL=file pnpm install --frozen-lockfile --ignore-scripts --offline
```

Both commands passed. Earlier unfiltered/default-deduplication attempts tried to
resolve unrelated federation Git dependencies; the protocol restriction refused
them before network access. The successful filtered regeneration retains main's
resolutions, adds the lane's workspace links and existing esbuild entry, and
updates one pnpm-generated Vitest peer snapshot. No pnpm configuration change is
committed.

Validation ran with `PATH="$PWD/node_modules/.bin:$PATH"`:

```sh
GIT_ALLOW_PROTOCOL=file pnpm exec turbo run lint build typecheck test --filter=@jeswr/suite-vocab --filter=@jeswr/solid-chat-interop --filter=@jeswr/app-pod-chat --filter=@jeswr/app-pod-money --filter=@jeswr/pod-chat-web --filter=@jeswr/pod-money-web --env-mode=loose --concurrency=4
GIT_ALLOW_PROTOCOL=file pnpm run test:root
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=origin/main pnpm run gate --env-mode=loose
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
```

- Touched projects and both web dependents: **PASS**, 31/31 tasks. Tests:
  suite-vocab 47, interop 97, Pod Chat 228, Pod Money 169, chat web 177,
  money web 179. The first run exposed the missing fetch-rdf mirror SHA fixture;
  fix that fixture and rerun the scoped checks successfully.
- `pnpm run lint:root`: **PASS**, invoked by the scoped Turbo checks and both
  workspace gates, including the workspace, SDK layer, and agent layer guards.
- Root tests: **PASS**, 745 tests in 9 files.
- Affected gate: **FAIL / exit 1**, 314 successful tasks of 362 scheduled.
  Turbo selected all 98 projects after the lockfile change.
- Full gate: **FAIL / exit 1**, 337 successful tasks of 375 scheduled.
  Both gates stop in unchanged `@jeswr/federation-trust#test`,
  `test/characterization.test.ts:196`: the delegation credential snapshot expects
  the embedded JWK fields in `crv,x,kty` order and receives `kty,crv,x` order.
  Leave this unrelated package and its snapshot identical to main, as required.
  The earlier unstorage-solid prerequisite blocker no longer occurs with main's
  workspace fetch-rdf wiring.
- `roborev` remains unavailable; no new automated per-commit review is claimed.

Remove the 16 untracked callback/client metadata files generated by web builds.
No dist output, tracker state, unrelated fixes, network Git fetches, branch
switches, pushes, or PRs. Integration is complete; the workspace gate failure
and unavailable review remain the validation limitations. No new open questions
or conservative design interpretations were needed.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 4 — Pod Chat offline client registration

- `5f72ed63` — `chore: merge main into vocabulary lane`: fetch from the local
  source clone and merge authoritative `origin/main` at
  `93217230`. Resolve the chat interop manifest conflict by retaining main's
  existing `@solid/object` dependency and the lane's suite-vocab dependency.
  Start `pnpm-lock.yaml` from main and regenerate it with pnpm; no hand-merged
  lockfile entries or new dependencies.
- `3f2d1257` — `fix: validate canonical pod chat registration offline`: retain
  the canonical federation context and qualify access values as `acl:Read`,
  `acl:Write`, and `acl:Append` so verification accepts actual ACL mode IRIs.
  Update only Pod Chat's offline extraction expectations to the canonical social
  sector and ChatRoom IRIs. Assert valid verification, no issues, the unchanged
  access modes, and consumed types through both body and fetch entry points.
- Final `docs:` commit — update this report last.

Lockfile regeneration and frozen offline installation both passed:

```sh
GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/suite-vocab --filter @jeswr/app-pod-chat --filter @jeswr/app-pod-money --filter @jeswr/solid-chat-interop install --lockfile-only --ignore-scripts --offline --config.dedupe-peer-dependents=false
GIT_ALLOW_PROTOCOL=file pnpm install --frozen-lockfile --ignore-scripts --offline
```

Validation ran with `PATH="$PWD/node_modules/.bin:$PATH"`:

```sh
GIT_ALLOW_PROTOCOL=file pnpm exec turbo run build --filter=@jeswr/federation-client... --env-mode=loose --concurrency=4
GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/federation-client exec vitest run test/offline-contexts.test.ts
GIT_ALLOW_PROTOCOL=file pnpm exec turbo run lint typecheck test --filter=@jeswr/federation-client --filter=@jeswr/app-pod-chat --env-mode=loose --concurrency=4
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=origin/main pnpm run gate --env-mode=loose
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
```

- Dependency build: **PASS**, 5/5 tasks. Before building the workspace
  prerequisite, the package test script refused to run because fetch-rdf had no
  dist; building it locally resolved that prerequisite without a remote clone.
- Reproduction before the fix: the offline test **FAILS** on exactly the stale
  sector and ChatRoom expectations (17 passed, 1 failed).
- Focused lint, typecheck, and tests after the fix: **PASS**, 14/14 tasks,
  including all 239 federation-client tests and 228 Pod Chat tests. Both offline
  entry points verify the shipped registration successfully without global fetch.
- Root lint and guards: **PASS**. Root tests: **PASS**, 745 tests in 9 files.
- Affected gate: **FAIL / exit 1**, 285 successful tasks of 345 scheduled.
- Full gate, rerun sequentially: **FAIL / exit 1**, 220 successful tasks of 359
  scheduled. An initial overlapping full-gate attempt encountered Next.js's
  concurrent-build lock; the sequential rerun resolves that invocation issue.
- Both final gate runs stop at unchanged `@jeswr/federation-trust#test`,
  `test/characterization.test.ts:196`: the delegation credential snapshot expects
  JWK fields in `crv,x,kty` order and receives `kty,crv,x`. The package is identical
  to main and remains outside this brief.
- `roborev` is unavailable, so no new automated per-commit review is claimed.
  The supplied review's personal-agent / agentic-legacy-bridge findings remain
  with A-002F / sst-kvnf as directed; both packages are identical to main.

Remove all 16 web-build-generated callback/client metadata files before the last
report edit. No dist, tracker state, dependency additions, network remote fetches,
branch switches, pushes, or PRs. The requested CI regression is fixed; validation
remains limited by the unrelated federation-trust snapshot failure and unavailable
roborev. No open questions or additional design changes.
