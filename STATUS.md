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

<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 4 — 2026-10-25

Resumed at `35beb020` and addressed the medium redirected-WebID finding.
The referenced `briefs/sst-k9mk.md` is absent from this checkout; the supplied
fix brief and the earlier reports above supplied the lane context.

### Commits

- `c031f558` — `fix: pin connector registration to resolved profiles`: retain
  the final profile document URL returned by Pod Manager's existing profile
  load and pass it into the connector writer from both API and file imports.
  Pin registration's authenticated profile reads and conditional updates to
  that document, preserve the original WebID as the RDF subject, and retain
  exact-document Type Index access within advertised storages. Authenticated
  profile and index operations continue to refuse redirects. Add bootstrap,
  reuse, host propagation, write-redirect, and unsafe-profile regressions;
  update the connector README, skill, and fixture callers.
- The final report-only commit updates this file last.

### Validation

Runtime: Node `24.22.1`, pnpm `10.4.1`. No dependencies, manifests, or lockfiles
changed; lifecycle scripts remained ignored.

```sh
pnpm exec turbo run build --filter=@jeswr/pod-connectors...
pnpm --filter @jeswr/pod-connectors exec vitest run src/core/pod-writer.test.ts
pnpm --filter @jeswr/app-pod-manager exec vitest run src/lib/profile.test.ts
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate --env-mode=loose
pnpm run lint:root
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
```

- Dependency-first build: **PASS**.
- Focused regressions: **PASS, 30 PodWriter tests and 6 profile tests**. The
  canonical-profile regression fails against the previous Type Index write
  implementation with a refused 302 from the WebID. The fixed source was
  restored byte-for-byte, and all 30 PodWriter tests passed again.
- The canonical-document cases cover a different profile origin and a query
  string, bootstrap and idempotent reuse, preservation of the WebID subject,
  conditional profile updates, and no registration request to the redirecting
  WebID. Redirects on profile writes, index creation, and index updates are
  refused even when their destination is inside advertised storage. No
  unauthenticated profile fetch was added.
- Affected gate: **PASS, 11/11 tasks (0 cached)**. Both touched projects pass
  lint, build, typecheck, and tests: connectors **269 tests in 41 files**;
  Pod Manager **916 passed, 1 existing skip, 67 files**. Root tests: **26 passed**.
- Root lint: **PASS**, both within the affected gate and as a separate command.
- Full-workspace gate: **BLOCKED/FAIL**, 23 successful tasks, 132 scheduled,
  5 cached. The unchanged `@jeswr/unstorage-solid#build` helper attempted an
  HTTPS clone of fetch-rdf; `GIT_ALLOW_PROTOCOL=file` refused it with
  `fatal: transport 'https' not allowed`. `--env-mode=loose` propagates that
  restriction to task subprocesses. No remote source was fetched, and no
  unrelated build helper or generated source was changed.

Existing non-fatal Biome and guarded-fetch webpack warnings remain.
`git diff --check` passed. `roborev` and its post-commit hook remain unavailable
in this sandbox; the supplied finding was checked directly against the fix
and regressions.

### Scope and open questions

The requested connector fix is complete. Conservative compatibility choice:
the connector writer requires the host-resolved profile document URL, while
legacy direct `ensureTypeRegistrations` callers retain their existing WebID
document default. Every registration operation is pinned to its selected
profile/index document; advertised-storage validation remains unchanged.
No open implementation questions. Full-workspace green verification remains
blocked by the unrelated remote-cloning helper. All commits remain on
`lane/sst-k9mk` in this checkout; nothing was pushed, published, or merged.

<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 5 — 2026-10-25

Resumed at `4e9143cc` and read the supplied review in full. Addressed its one
medium finding: productivity stores omitted the resolved profile document URL
when registering their containers, so redirected WebIDs could not create items.

### Commits

- `437d81d7` — `fix: pass resolved profiles to productivity stores`: pass the
  session's resolved `profileDocumentUrl` through `useStore`, all eight store
  factories, `createStore`, and `ProductivityStore.ensureRegistered`. Wait for
  the session profile before constructing a store and include the resolved URL
  in memoization dependencies. Preserve authenticated redirect refusal and the
  existing WebID RDF subject. Add 14 regression cases covering creation and
  index reuse for every factory, profile/index read and write redirects, and
  waiting for the session profile.
- The final `docs: record productivity store fix validation` commit updates
  only this report, last.

### Validation

Runtime: Node `24.22.1`, pnpm `10.4.1`. No dependencies, manifests, or lockfiles
changed; `check:packages` was not applicable. Lifecycle scripts remain ignored.

```sh
pnpm exec turbo run build --filter=@jeswr/pod-connectors...
pnpm --filter @jeswr/app-pod-manager exec vitest run src/lib/use-productivity.test.ts
pnpm --filter @jeswr/app-pod-manager run typecheck
pnpm --filter @jeswr/app-pod-manager run lint
GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/app-pod-manager run lint && GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/app-pod-manager run build && pnpm --filter @jeswr/app-pod-manager run typecheck && pnpm --filter @jeswr/app-pod-manager run test
pnpm run lint:root
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate --env-mode=loose
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
git diff --check
```

- Dependency-first build: **PASS**.
- New regression file: **PASS, 14 tests**. Before the fix, creation through each
  factory failed with a refused 302 from the WebID document. The fixed path
  performs conditional profile updates at the resolved URL, registers the
  container under the original WebID subject, and reuses the index without
  another index write. Authenticated profile/index redirects abort before item
  saving and never reach their redirect target.
- Pod Manager lint/production static build/typecheck/tests: **PASS, 930 passed,
  1 existing IndexedDB-dependent skip, 68 files**.
- Root lint: **PASS**.
- Affected gate: **PASS, 11/11 tasks (0 cached)**, including Pod Manager's four
  checks, Pod Connectors' four checks (**269 tests, 41 files**), and 26 root tests.
- Full-workspace gate: **BLOCKED/FAIL**, 2 successful tasks (2 cached), 23
  scheduled. The unchanged `@jeswr/unstorage-solid#build` helper attempted to
  clone fetch-rdf over HTTPS; `GIT_ALLOW_PROTOCOL=file` prevented it with
  `fatal: transport 'https' not allowed`, honoring the lane's remote-fetch ban.
  No remote source was fetched and no unrelated build helper was modified.
- `git diff --check`: **PASS**. Existing guarded-fetch webpack warnings remain
  non-fatal. No generated tracked files changed.

### Scope, review, and open questions

The supplied finding is fixed; no requested implementation remains unfinished.
Conservative compatibility choice: direct store callers may omit the profile
URL and retain the existing WebID-document fallback; the session hook always
passes its resolved profile URL. No open questions or design changes.

`roborev` and its post-commit hook remain unavailable in the sandbox, so no new
automated per-commit verdict was produced. The supplied review was checked
against the implementation and regressions directly. Full-workspace green
verification remains blocked by the unrelated remote-cloning helper above.
All commits stay on `lane/sst-k9mk` in this checkout; nothing was pushed,
published, merged, or changed in another checkout.

<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 6 — 2026-10-26

Resumed at `86ed4adf` and read the supplied review in full. Addressed its one
high finding: JSON-LD context loading bypassed the scoped connector transport
and could reach the host's globally authenticated fetch.

### Commits

- `e81ff145` — `fix: refuse remote connector RDF contexts`: install a refusing
  `documentLoader` on the shared connector RDF read path, covering document,
  profile, registration, and Type Index discovery reads. Reject every context
  URL with the exported `RemoteContextRefusedError` (a `RdfFetchError` subtype),
  without any context fetch fallback. Preserve inline context support, relative
  RDF identifiers, ETags, cache revalidation, and response metadata. Add 13
  regression cases and document the policy in the package README.
- The final `docs: record connector context fix validation` commit updates only
  this report, last.

### Implementation boundary and dependency policy

The installed `@jeswr/fetch-rdf` 0.1 API exposes no `documentLoader` option.
The connector read helper therefore retains its fetch/result/error contract,
uses its `parseRdf` for other RDF formats, and invokes `JsonLdParser` with the
refusing loader for JSON-LD. Its existing transitive `jsonld-streaming-parser`
dependency is now direct (`^5.0.0`, locked to the existing `5.0.1`) so the
required loader can actually be passed to the parser. No new resolved package
or version was introduced. `pnpm run check:packages jsonld-streaming-parser`
passed in full mode before adding that direct edge. Frozen offline installation
passed with lifecycle scripts ignored.

Conservative interpretation of the integrator's design call: the package
contains no bundled context documents, so every context URL is refused;
document-inline context objects continue to work. Context parser wrapping
does not erase the typed policy error exposed to callers.

### Validation

Runtime: Node `24.22.1`, pnpm `10.4.1`.

```sh
pnpm run check:packages jsonld-streaming-parser
GIT_ALLOW_PROTOCOL=file pnpm exec turbo run build --filter=@jeswr/pod-connectors...
pnpm --filter @jeswr/pod-connectors exec vitest run src/pod/rdf-read.test.ts
GIT_ALLOW_PROTOCOL=file pnpm install --frozen-lockfile --offline --ignore-scripts
pnpm --filter @jeswr/pod-connectors exec biome check --write src/pod/rdf-read.ts src/pod/rdf-read.test.ts src/core/errors.ts
GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/pod-connectors run lint && GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test
pnpm run lint:root
GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate --env-mode=loose
GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose
git diff --check
```

- Dependency-first build and frozen offline installation: **PASS**.
- Before implementation, the initial regression suite failed all 10 refusal
  cases and demonstrated global context-fetch calls. The completed suite:
  **PASS, 13 tests**. It covers connector documents, registration profiles and
  indexes, discovery, context arrays, nested and scoped contexts, `@import`,
  same-Pod and relative context URLs, inline JSON-LD parsing and registration,
  and typed malformed-JSON-LD failures. Explicitly injected read paths make
  zero global fetch calls; refusal cases make no extra transport calls or writes.
- Pod Connectors lint/build/typecheck/tests: **PASS, 282 tests in 42 files**.
- Root lint: **PASS**, separately and within the affected gate.
- Affected gate: **PASS, 11/11 tasks (0 cached)**. Pod Manager also passes
  lint, production static build, typecheck, and tests: **930 passed, 1 existing
  skip, 68 files**. Root tests: **26 passed**.
- Full-workspace gate: **BLOCKED/FAIL**, 12 successful tasks, 35 scheduled,
  2 cached. The unchanged `@jeswr/unstorage-solid#build` helper attempted to
  clone fetch-rdf over HTTPS; `GIT_ALLOW_PROTOCOL=file` refused it with
  `fatal: transport 'https' not allowed`. `--env-mode=loose` propagates that
  restriction to subprocesses. No remote source was fetched and no unrelated
  helper or generated tracked file was changed.
- `git diff --check`: **PASS**. Existing non-fatal Biome and guarded-fetch
  webpack warnings remain.

### Scope, review, and open questions

The supplied finding is fixed; no requested implementation remains unfinished
and there are no open questions. `roborev` and its post-commit hook are absent
from this sandbox, so no automated per-commit verdict was produced. The
supplied finding was checked directly against the fix and regressions.
Full-workspace green verification remains blocked by the unrelated remote
clone helper described above. All commits stay on `lane/sst-k9mk` in this
checkout; nothing was pushed, published, merged, or changed in another checkout.
