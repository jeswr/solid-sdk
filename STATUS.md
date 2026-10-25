<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# sst-k9mk — CON-01 lane report

Implemented DESIGN §2 D1–D2 on `lane/sst-k9mk`, based on
`61048c43eb845a6d244fb90ec9b10ee0b0a7d1f4`.

## Commits

- `3f8fb029` — `chore: move integrations into pod-connectors`: unmodified `git mv`
  of integrations and their tests, preserving history before implementation changes.
- `40c54c98` — `feat: inject connector ports and host config`: private experimental
  `@jeswr/pod-connectors` 0.1.0, security-critical package layout and subpaths, explicit
  PodWriter/SourceAuth ports, fetch-backed writer, isolated configured registries, shared
  Type Index helpers, Pod Manager shims and host config, workspace manifest/lock inventory.
- `841e20b1` — `fix: preserve connector credential and write boundaries`: retain read
  preconditions for the next write, forward explicit conditions for file imports, and bind
  bearer credentials to fixed API origins while refusing redirects.
- `1dc7e0fe` — `fix: require HTTPS for source authentication`: reject insecure source
  origins and requests before attaching credentials.
- The commit containing this report records final verification and is the last lane commit.

## Validation

Final gate runtime: Node 24.12.0, pnpm 10.4.1. Tool binaries were made available with:

```sh
export PATH="$PWD/node_modules/.bin:/Users/jesght/Library/pnpm:/Users/jesght/.nvm/versions/node/v24.12.0/bin:$PATH"
```

These filtered checks passed during implementation; the final affected gate repeated all
four scripts on the final code after the review fixes:

```sh
pnpm --filter @jeswr/pod-connectors run lint && pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test
pnpm --filter @jeswr/app-pod-manager run lint && pnpm --filter @jeswr/app-pod-manager run build && pnpm --filter @jeswr/app-pod-manager run typecheck && pnpm --filter @jeswr/app-pod-manager run test
pnpm run lint:root
TURBO_SCM_BASE=61048c43eb845a6d244fb90ec9b10ee0b0a7d1f4 pnpm run gate
```

Final affected gate: **PASS, 11/11 tasks**. A final refresh after generated-file cleanup
also passed all 11 tasks (10 cached) before this report commit. Package: **250 tests in 41 files**. Pod Manager:
**914 tests passed, 1 skipped, 66 files**; its existing IndexedDB-dependent test skips in Node.
Production static build and typecheck passed. The package's source-environment guard passed.
All concrete package export subpaths also imported successfully in Node. The focused port,
conditional-write, origin and redirect regression file passed all 9 tests.

Biome has non-fatal style/non-null-assertion warnings. Pod Manager builds with webpack's
non-fatal dynamic-dependency warnings from the existing guarded-fetch bundle.

### Full workspace gate

`pnpm run gate:full` was run before this report. Initial execution hit an unchanged root
mirror-test cleanup hook timeout (10 seconds). Retrying got past that test but the existing
unstorage-solid dependency builder tried to write to the sandbox's unwritable global npm
cache. No files in those unrelated projects/tests were changed.

The cache was redirected without enabling lifecycle scripts:

```sh
export npm_config_cache=/tmp/con01-npm-cache
export npm_config_ignore_scripts=true
pnpm run gate:full --env-mode=loose
```

This completed 150 tasks, then Pod Money's Vitest pool timed out starting two workers
(`useAccountsLedger.test.tsx` and `AccountsView.test.tsx`). Its completed test files passed.
The same full task set was then run with one Turbo task at a time:

```sh
pnpm exec turbo run lint lint:root build typecheck test test:root --concurrency=1 --env-mode=loose
```

Serialized full task set: **FAIL**, 249 tasks succeeded (149 cached), then
`n8n-nodes-solid#test` stopped the run. In unchanged `test/api-surface.test.ts:90`,
"n8n INodeType description (resource/operation/parameter tree)" exceeded its existing
30,000 ms test timeout while loading the shipped node API. The package had 85 tests pass
and 1 time out. This was a timeout, not a snapshot mismatch. Its source and tests are
unchanged relative to the lane base. Full-workspace verification therefore remains
**not green in this sandbox**; no unrelated timeout/test configuration was patched.

An initial Node 25 dependency-bundler run was interrupted after stalling; the same build
completed under Node 24. Installation used frozen, existing lockfile versions and writable temporary stores;
`.npmrc` remained unchanged and dependency lifecycle scripts stayed disabled throughout.

## Dependency policy

```sh
pnpm run check:packages @jeswr/fetch-rdf @rdfjs/wrapper @solid/object n3 @rdfjs/types @types/n3
pnpm run check:packages @jeswr/guarded-fetch --mode policy
pnpm run check:packages @biomejs/biome typescript vitest
```

All passed: 6 runtime/type packages in full mode, the internal guarded-fetch edge in policy
mode, and 3 existing build/test tools in full mode. No new third-party package or version was
introduced to the workspace. Internal edges use `workspace:*`; frozen pnpm installation
validated the manifest/lock changes with scripts ignored.

## Review and scope

Roborev reviewed each code commit. Findings on the mechanical move were resolved by the
package setup. Subsequent ETag/origin and HTTPS findings were fixed in the two fix commits.
Latest normal review (job 5821) and Claude security review (job 5822) found no issues;
the preceding boundary fix also passed Codex and Claude security review. The report commit
is queued for the repository's asynchronous per-commit review.

No CON-01 implementation remains unfinished. Full-workspace green verification is blocked
by the unrelated timeout above; the requested affected gate and lane acceptance checks pass. Conservative choices are recorded in
`QUESTIONS.md`; none blocks this lane. The Node CLI and fixture recorder remain assigned to
CON-03 and CON-02 respectively. Nothing was pushed, published, or merged; no other checkout
or unrelated source was modified.

## Fix round 1 — 2026-10-25

Resumed the existing history-preserving move at `9772b3d9` on `lane/sst-k9mk`.
This round addresses both high findings in the Codex review of that commit; it
adds no packages, dependencies, or strategy changes.

### Fix commits

- `745a6730` — `fix: confine connector redirects to document scope`: bind document
  reads/writes and every redirect hop to the connector container, including
  rejecting the container document itself. Keep Type Index access separate: check
  the selected profile-linked index (or the existing bootstrap target) against
  the active Pod, restrict access to that document, and refuse redirects from
  both the profile and index. Preserve conditional writes and index bootstrap.
- `907fdca9` — `fix: isolate connector source and Pod transports`: capture a
  pristine source fetch before SessionProvider initializes authentication; expose
  the auth manager's fetch directly through the session for connector Pod I/O.
  Inject source fetch into SourceAuth and the OAuth popup/token-exchange path;
  inject Pod fetch into both import hooks' PodWriter. Document the transport
  contract and add a regression using the real reactive auth manager.
- The final `docs: record connector fix-round validation` commit updates only
  this report, after all implementation and verification work.

### Validation for this round

Runtime: Node `24.22.1`, pnpm `10.4.1`. Dependency lifecycle scripts remained
ignored. No manifest or lockfile changed, so no dependency-policy additions were
needed (`check:packages`: not applicable).

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@jeswr/pod-connectors...
pnpm --filter @jeswr/pod-connectors run lint && pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test
pnpm --filter @jeswr/app-pod-manager run lint
pnpm --filter @jeswr/app-pod-manager run build && pnpm --filter @jeswr/app-pod-manager run typecheck
pnpm --filter @jeswr/app-pod-manager run test
pnpm run lint:root
TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate
pnpm run gate:full
```

- Frozen install and dependency-first build: **PASS**.
- Pod connectors lint/build/typecheck/tests: **PASS**, **257 tests in 41 files**.
- Pod Manager lint/production static build/typecheck/tests: **PASS**, **915 tests
  passed, 1 existing IndexedDB-dependent skip, 67 files**.
- Root lint: **PASS**.
- Affected gate against the dispatcher-specified base: **PASS, 11/11 tasks**
  (1 cached), including 26 root tests, both projects' tests, and their builds.
- Full-workspace gate: **FAIL** after 2 successful tasks (23 scheduled), in the
  unchanged `@jeswr/unstorage-solid#build` helper. Its dependency bootstrap invokes
  `npm install --no-audit --no-fund --ignore-scripts --prefer-offline` and fails
  with `EROFS` opening `/home/runner/.npm/_cacache/tmp/…`. The helper also clones
  upstream source; it was not retried because this lane forbids remote fetches.
  No unrelated build script or cache policy was changed.

Initial direct checks required building the workspace guarded-fetch dependency
first. Two new regression-test setup/assertion issues were corrected before the
passing checks above: RDF reads wrap the scope exception in `RdfFetchError`, and
the auth package's browser exports require an `HTMLElement` stub under Node.
Existing non-fatal Biome warnings and guarded-fetch webpack dynamic-dependency
warnings remain.

The new tests verify that source API and OAuth token requests carry no Pod
Authorization/DPoP headers even after global auth patching; the same auth manager
successfully upgrades a separate Pod challenge. They also verify rejection of a
second-hop document redirect elsewhere in the same Pod for reads and PUT writes,
continued support for redirects inside the connector container, refusal of
profile/index redirects to unrelated Pod documents, and successful index updates.

### Scope, review, and open questions

Both requested findings are implemented and the history-preserving move was not
repeated. Conservative redirect policy: Type Index/profile requests refuse all
redirects, keeping access limited to the exact selected documents. There are no
open implementation questions or unfinished requested changes.

Full-workspace green verification remains blocked by the unrelated build helper
above. `roborev` and its post-commit hook are unavailable in this sandbox, so no
new automated per-commit verdict was produced; the two supplied findings were
checked against the changes and regressions directly. No review tooling was
installed. All commits remain local to `lane/sst-k9mk`; nothing was pushed,
published, merged, or changed in another checkout.

## Fix round 2 — 2026-10-25

Resumed at `07491f0c` and addressed the medium Type Index multi-storage finding.

### Commits

- `9cab68f2` — `fix: validate Type Index against advertised storages`: validate
  the selected index against the user's WebID-subject `pim:storage` roots, using
  the existing scope guard, independently of the import destination. Retain
  exact-document access, redirect refusal, bootstrap location, and ETag writes.
  Update the package README and skill to describe this boundary.
- The final report-only commit updates this file last.

### Validation

Runtime: Node `24.22.1`, pnpm `10.4.1`. No dependencies, manifests, or lockfiles
changed; `check:packages` was not applicable. Lifecycle scripts remained ignored.

```sh
pnpm exec turbo run build --filter=@jeswr/pod-connectors...
pnpm --filter @jeswr/pod-connectors exec vitest run src/core/pod-writer.test.ts
pnpm --filter @jeswr/pod-connectors run lint && pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test
pnpm run lint:root
TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
```

- Dependency-first build: **PASS**. The first test attempt lacked the built
  guarded-fetch workspace dependency; building it resolved the import failures.
- Focused PodWriter regressions: **PASS, 23 tests**. The new cases import into
  the second advertised storage while registering in the first, for both shared
  and separate origins. They verify conditional index writes and manual redirect
  handling, plus rejection before index I/O for targets outside both roots,
  including sibling paths. Existing redirect-refusal regressions also pass.
- Pod connectors lint/build/typecheck/tests: **PASS, 262 tests in 41 files**.
- Root lint: **PASS**.
- Affected gate: **PASS, 11/11 tasks (2 cached)**, including Pod Manager's lint,
  production build, typecheck and tests (**915 passed, 1 existing skip, 67 files**).
- Full-workspace gate: **BLOCKED/FAIL**, 4 successful tasks, then the unchanged
  `@jeswr/unstorage-solid#build` dependency helper attempted an HTTPS clone of
  fetch-rdf. `GIT_ALLOW_PROTOCOL=file` deliberately blocked it with
  `fatal: transport 'https' not allowed`, honoring the lane's remote-fetch ban.
  `--env-mode=loose` passes that restriction to task subprocesses. No remote source
  was fetched and no unrelated build helper was changed.

Existing non-fatal Biome and guarded-fetch webpack warnings remain. `git diff
--check` passed. `roborev` and its post-commit hook remain unavailable; the supplied
finding was checked directly against the implementation and regressions.

### Scope and open questions

The requested fix is complete. Conservative interpretation: only advertised
`pim:storage` roots grant index scope; there is no fallback to an unadvertised
import destination when the profile advertises none. Bootstrap still targets
the import Pod's existing settings path and must pass the same storage check.
No open implementation questions. Full-workspace green verification remains
blocked by the unrelated remote-cloning helper. All changes and commits stay in
this checkout on `lane/sst-k9mk`; nothing was pushed, published, or merged.

## Fix round 3 — 2026-10-25

Resumed at `6b97c8d5` and addressed the medium storage-predicate finding.

### Commits

- `d9abe0e7` — `fix: accept solid storage for Type Index scope`: use
  `Agent.storageUrls` to validate against both WebID-advertised `pim:storage`
  and `solid:storage` roots. Preserve containment, exact-document access,
  redirect refusal, bootstrap location, and conditional writes. Update the
  README and package skill to describe both predicates.
- The final report-only commit updates this file last.

### Validation

Runtime: Node `24.22.1`, pnpm `10.4.1`. No dependencies, manifests, or lockfiles
changed; `check:packages` was not applicable. Lifecycle scripts remained ignored.

```sh
pnpm exec turbo run build --filter=@jeswr/pod-connectors...
pnpm --filter @jeswr/pod-connectors exec vitest run src/core/pod-writer.test.ts
pnpm --filter @jeswr/pod-connectors run lint && pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test
pnpm --filter @jeswr/app-pod-manager run test
pnpm run lint:root
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate --env-mode=loose
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
```

- Dependency-first build: **PASS**.
- The new solid-only regression failed with `PodScopeError` before the fix.
  After the fix, the complete connector suite passes, including bootstrap and
  reuse with only `solid:storage`, plus the existing containment and redirect
  regressions.
- Pod connectors lint/build/typecheck/tests: **PASS, 263 tests in 41 files**.
- Pod Manager tests: **PASS, 915 passed, 1 existing skip, 67 files**.
- Root lint: **PASS**.
- Affected gate: **PASS, 11/11 tasks (0 cached)**, including Pod Manager's lint,
  production build, typecheck and tests, plus 26 root tests.
- Full-workspace gate: **BLOCKED/FAIL**, 3 successful tasks, 30 scheduled, then
  the unchanged `@jeswr/unstorage-solid#build` helper attempted an HTTPS clone
  of fetch-rdf. `GIT_ALLOW_PROTOCOL=file` blocked it with
  `fatal: transport 'https' not allowed`, honoring the lane's remote-fetch ban.
  No remote source was fetched. The unrelated generated vocabulary file changed
  by the full gate was restored; no unrelated source changes are included.

Existing non-fatal Biome and guarded-fetch webpack warnings remain. `git diff
--check` passed. `roborev` and its post-commit hook remain unavailable in this
sandbox; the supplied finding was verified directly against the fix and tests.

### Scope and open questions

The requested implementation is complete. Both advertised storage predicates now
grant scope through the existing Agent accessor; an unadvertised import destination
still grants no scope. No open questions or design changes. Full-workspace green
verification remains blocked by the unrelated remote-cloning helper. All commits
remain in this checkout on `lane/sst-k9mk`; nothing was pushed, published, or merged.
