<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-ef15 — TSK-00 lane report

Branch: `lane/sst-ef15`. Base: `606c87b7edf73e83f118f95295b0eeda7abb6d92`.

## Changes by commit

- `145a987a` — `feat: add typed tasks and scheduling models`: local `TaskTracker` / `TaskItem` extensions of the shared task model; typed RDF access, parse/serialize, validation, category and member helpers, recurrence expansion/export/humanisation, reminder calculation, pure recurring-completion plans, and initial tests. Required RDF and coverage dependencies are declared in the app and root lockfile. Conservative boundary choices are recorded in `QUESTIONS.md`.
- `3324bd6a` — `feat: add conditional tasks store and discovery`: injected-fetch transport, structured errors and `classifyError`, container + Type Index discovery, private-index bootstrap, unique project slugs, Inbox bootstrap, task CRUD, project updates, and conditional-write/concurrency tests. Ports the Pod Manager productivity-store and typed Type Index patterns without importing another app.
- `dc09a642` — `fix: preserve task scheduling invariants`: typed all-day markers paired with local midnight, stable reminder identities across statement reordering, retained explicit reminder identifiers, bounded Inbox race retries, and 40 static recurrence fixtures independently generated with rrule.js 2.8.1.
- Final documentation commit — `docs: record tasks model lane verification`: this report, committed last.

Implementation is confined to `apps/suite/src/apps/tasks/lib/model/`, app test/config/dependency wiring, the shared lockfile, and the two requested root reports. No React, hooks, SDK façade, routes, components, notification side effects, or browser persistence were added. No push, PR, branch switch, or source merge was performed.

## Verification

All commands ran in this checkout with lifecycle scripts disabled. Workspace dependency declarations were built before app checks. The dependency-free suite-vocab package needed the root tool directory in PATH in this environment:

```sh
pnpm --filter @jeswr/solid-task-model... run build
export PATH="$PWD/node_modules/.bin:$PATH"
pnpm --filter @jeswr/suite-vocab run build
pnpm --filter @jeswr/suite-ui run build
```

Passed:

```sh
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
pnpm run lint:root
TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate
pnpm install --frozen-lockfile --offline --ignore-scripts
```

- App lint: 27 files, no findings. Next.js production build and strict typecheck passed.
- Vitest: **82 tests passed** across four files. `lib/model` coverage is enforced at **100% statements (614/614), branches (425/425), functions (138/138), and lines (535/535)**. No model files or branches are excluded.
- Coverage includes §5.2/§5.3 prefix-insensitive graph round-trips compared as sorted n3 N-Triples, foreign metadata preservation, description interoperability, slug races, idempotent registrations, private-index races, every conditional mutation, stale/missing validators, and failure propagation.
- Scheduling tests include 40 rrule.js reference cases with ten occurrences each, calendar edge cases, count/until exhaustion, London daily/weekly DST boundaries, reminder deduplication, and recurring completion roll-forward.
- Root guards passed, including 74 contrast pairs with zero failures.
- Affected gate: **10 successful tasks / 10 total**, zero cached at the verification run.
- Frozen offline install passed; the lockfile is current and no resolution was needed. An initial non-frozen offline install lacked cached package metadata; `pnpm install --ignore-scripts` then succeeded. Unrelated pnpm peer-snapshot rewrites were omitted from the committed lockfile; only the app importer changes remain.

Full-workspace check attempted:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
pnpm run gate:full
```

**Failed outside this lane** at `@jeswr/unstorage-solid#build`: its existing `scripts/build-deps.mjs` invokes `npm install --no-audit --no-fund --ignore-scripts --prefer-offline`, which failed with `EROFS` opening the read-only `/home/runner/.npm/_cacache/tmp/` cache. Turbo stopped with 9 successful tasks / 44 scheduled tasks. This package and its build scripts are unchanged from the base; the full-workspace gate is not green.

## Dependency policy

```sh
pnpm run check:packages @jeswr/fetch-rdf @rdfjs/wrapper @rdfjs/types n3 @types/n3 @vitest/coverage-v8
```

PASS: all six third-party packages cleared the policy. Existing workspace packages `@jeswr/solid-task-model` and `@jeswr/suite-vocab` supply the model and canonical vocabulary required by the brief.

```sh
pnpm run check:packages rrule
```

PASS. rrule.js 2.8.1 was unpacked only as a temporary fixture-generation tool, using `npm --cache /tmp/sst-ef15-rrule/cache pack rrule@2.8.1 --ignore-scripts --pack-destination /tmp/sst-ef15-rrule`. It is **not** an app/workspace dependency. Only its generated expected-date fixtures are committed.

## Remaining limitations and questions

- `roborev` is unavailable (`command -v roborev` found no executable), so automated per-commit verdicts could not be read. No review service was installed.
- `QUESTIONS.md` records three conservative integration choices: a local structural error classifier, browser-local recurrence arithmetic plus a supplied completed-copy count, and the ported private Type Index bootstrap. None blocks this model lane.
- The caller must supply a scope-guarded authenticated fetch for authorized pod/shared locations and redirects. Missing strong ETags prevent updates/deletes. Cross-resource orchestration, undo persistence, outbox handling, ACL grants, IndexedDB fired-key storage, and hooks remain with the later tasks that own them.
- Screenshots taken: **none**. This lane renders no UI; Playwright, visual fixtures, and axe screens are not applicable and were not run.
- No requested model implementation remains unfinished. External verification limitations are the failed unrelated full-workspace build and unavailable roborev tooling above.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 2 — review of `061de204d402`

This round fixes only the four supplied findings on `lane/sst-ef15`:

- `530b6f06` — `fix: validate task IRIs and preserve category identities`: use the existing workspace `@jeswr/rdf-serialize` safety helpers to reject unsafe HTTP IRIs before extension writes and reject unsafe named terms/datatype IRIs during serialization. Preserve safe lexical identities. Reuse exact category names and allocate deterministic suffixes for distinct names with colliding slugs, including identifiers occupied by foreign metadata.
- `da933ab6` — `fix: recover project creation and redirected reads`: conditionally delete the tracker and any task container newly reserved by an unsuccessful creation attempt. Retain failed compensation in the store and finish it before reserving another identity; stale validators preserve concurrent changes. Use the final RDF response URL for resource identities and task/project/container wrappers, including later conditional edits and deletes.
- Final report commit — `docs: record tasks review fix verification`: this verification record.

Regression tests exercise all forbidden C0/space/symbol characters, unsafe extension inputs and serialization bypasses, category collisions and preserved task assignments, container/registration failures with successful slug reuse, failed cleanup and concurrent edits, and redirected reads/listings followed by conditional mutations.

### Verification for this round

Passed, with root tools made available to dependency-free workspace packages:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
pnpm install --frozen-lockfile --offline --ignore-scripts
pnpm --filter @jeswr/app-suite... run build
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
pnpm run lint:root
TURBO_SCM_BASE=061de204d40239031fa73c2d42f281b0fad59803 pnpm run gate
git diff --check
```

- Package lint, Next.js production build, typecheck and tests passed.
- **100 tests passed** across four test files. Model coverage remains **100% statements (658/658), branches (456/456), functions (143/143), and lines (571/571)**, with the existing thresholds unchanged.
- Root guards passed, including all 74 contrast checks.
- Affected gate passed: **10 successful tasks / 10 total**, six cached.
- Frozen offline installation passed. The only dependency change is the existing shared workspace helper required by finding 1; no third-party dependency was added.

The package policy command was also attempted:

```sh
pnpm run check:packages @jeswr/rdf-serialize
```

It failed because this npm-only checker cannot find the unpublished workspace package in npm. The app uses `workspace:*` and the already-present repository package, not an npm installation of that name.

Full-workspace verification was attempted with `pnpm run gate:full`, then **stopped (exit 130)** after its unrelated `@jeswr/unstorage-solid` dependency-build script started a remote clone into a temporary directory. Continuing that build would conflict with this lane's prohibition on remote fetches. Generated, untracked client-ID/callback assets from the broader build were removed; no unrelated source changes are retained. An affected-gate attempt that included those generated files was stopped and rerun after cleanup; the final affected result above is green. The full-workspace gate is not claimed to pass.

`roborev` remains unavailable (`command -v roborev` found no executable), so no per-commit automated verdicts could be read. The supplied review findings were addressed with regression tests. No requested fix remains unfinished, and there are no new open questions. The conservative IRI policy rejects forbidden lexical characters instead of silently changing RDF identities. Failed cleanup retains its original validator in the current store instance and surfaces an error if concurrent changes prevent deletion. No UI or screenshots apply to this round.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 3 — review of `b204bde55298`

Read the complete supplied review at `/home/runner/work/solid-suite-tracker/lanes/reviews/solid-sdk-lane-sst-ef15-b204bde55298.md`, the original lane brief, and both earlier fix briefs. This round addresses exactly its four findings:

- `5375f96d` — `fix: construct monthly recurrence targets directly`: construct the final monthly date with the anchor's wall time in one operation, then check month overflow and DST gaps. Sydney regressions cover September and October 2028 anchors, a genuine October 1 gap, count semantics, next occurrence, and recurring completion.
- `9ad17afe` — `fix: preserve linked scheduling metadata`: clear only recognized reminder/recurrence fields and their owned type. Retain named/blank node identities and foreign annotations when editing exclusive nodes; copy shared nodes before editing and preserve their original data on unlink. Regression tests cover both node kinds, trigger/rule replacement, foreign types and predicates, and shared references.
- `d27c1b53` — `fix: require verified private type index access`: require an injected `ensurePrivateIndexAccess(url, owner)` ACL/ACP verifier for registration. Verify the empty index before linking it, verify raced and already-linked indexes before registration, and reject missing, negative, or failed verification. Tests assert ordering, anonymous denial in the injected policy fixture, policy changes, create races, unreadable policies, and that `solid:UnlistedDocument` alone permits no link or registration.
- `86c5f9a7` — `fix: coordinate inbox adoption and compensation`: conditionally change tracker/container representations when claiming initialization, then conditionally finalize the tracker after registration. Advance modification times even under a frozen clock so content-based validators must change. Tests interleave two stores across failed registration, stale creator finalization, and delayed container cleanup after tracker deletion; successful adopters retain a usable Inbox. Additional regressions cover claim/finalization conflicts and failed container claims.
- Final documentation commit — `docs: record tasks fix round three verification`: this report, committed last.

### Verification for this round

Passed in this checkout:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
pnpm --filter @jeswr/app-suite... run build
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
pnpm run lint:root
TURBO_SCM_BASE=061de204d40239031fa73c2d42f281b0fad59803 pnpm run gate
git diff --check
```

- App lint, Next.js production build, strict typecheck, and **120 tests across four files** passed.
- Model coverage remains **100% statements (702/702), branches (480/480), functions (150/150), and lines (606/606)**. No thresholds or exclusions changed.
- Root lint and workspace guards passed, including **74 contrast pairs, zero failures**.
- Affected gate passed: **10 successful tasks / 10 total**, zero cached.
- No dependency, manifest, lockfile, UI, or unrelated source changes were made. No dependency-policy check or screenshots were needed.

Full-workspace verification was attempted with remote Git transports disabled and npm offline to respect this lane's prohibition on remote fetches:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.allow GIT_CONFIG_VALUE_0=never npm_config_offline=true pnpm run gate:full --env-mode=loose
```

**Failed outside this lane** at `@jeswr/unstorage-solid#build` (exit 1): its existing dependency-build script invokes an HTTPS clone, which Git rejected locally with `fatal: transport 'https' not allowed`. No remote fetch occurred. Turbo reported **13 successful tasks / 53 total** before stopping. The full-workspace gate is not green; no unrelated generated source changes remain.

`roborev` is still unavailable (`command -v roborev` found no executable), so automated per-commit verdicts could not be read. No review tooling was installed.

### Conservative boundary and remaining work

Access-control evaluation remains at the caller's injected boundary: `ensurePrivateIndexAccess` must establish or verify effective owner-only ACL/ACP access, including inherited policy, and return true only after confirmation. Missing/unsupported/unreadable protection fails closed. The model does not select a server policy dialect or assume that an unlisted document is confidential. This is the conservative interpretation of finding 1 within the model-only scope.

All four requested fixes and their regressions are complete. External verification limitations are the unrelated full-workspace build and unavailable roborev above. No open questions, new dependencies, UI work, pushes, PRs, branch switches, or remote fetches apply to this round.
