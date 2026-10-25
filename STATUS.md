<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Lane sst-8xm.30 — T-004 fetch-rdf import, fix round 1

Date: 2026-10-25. Branch: `lane/sst-8xm.30`. Resumed from `474c1be6`.

**The four requested fixes are implemented. Touched-package gates pass. The dependent
workspace gate remains red; this lane is not ready to merge.** The explicit consumer
checks pass for 47 of 48 consumers. Pod Money's legacy injected test readers remain
incompatible with the imported result's required `headers`/N3 `Store` types; the
conservative scope choice and dispatcher question are recorded in [QUESTIONS.md](QUESTIONS.md).

## Commits

Existing import/integration commits retained unchanged:

- `c95e3bfb feat: import fetch-rdf history`.
- `99061d3a chore: integrate fetch-rdf workspace package`.
- `474c1be6 docs: record fetch-rdf lane blocker`.

Fix-round commits:

- `37a63a7c fix: contain RDF loading and restore response metadata` — refuse remote
  JSON-LD contexts by default; expose an explicit `documentLoader` seam and
  `createFetchDocumentLoader(fetch, { allow })`; restore `etag`, `url`, `contentType`,
  and `response` alongside `headers`; observe store/pump failures immediately and
  cancel pending source reads on parser errors; add regression tests and API guidance.
- `1454e94c fix: sanitize bundled workspace dependency paths` — label sibling package
  dist files as `<name>/dist/...` and their source-map sources as `<name>/src/...` in
  solid-a2a, federation-registry and solid-odrl. Existing absolute-path guards remain.
- `5b17ce6b fix: reject ancestor paths in bundle sanitizers` — require a package slug,
  preventing `..` from being classified as a sibling dependency; cover ancestor escapes.
- Final report commit: `docs: report fetch-rdf fix validation` — update QUESTIONS.md
  with the resolved metadata decision and remaining type-contract question, and update
  this STATUS.md last.

The default context policy makes no network requests. The helper checks every context
URL before fetching through the supplied transport and refuses redirects. Nested
contexts must also be allowlisted. No contexts were already bundled in this package.
Metadata semantics match the earlier imported contract: verbatim nullable ETag; final
response URL with requested-URL fallback; nullable parameter-free lowercase media type;
original consumed Response. The imported Store/required-headers typing is preserved.

## Touched-package gates

For each row, all commands below ran with `<name>` replaced by the package name:

```sh
pnpm --filter <name> run lint
pnpm --filter <name> run build
pnpm --filter <name> run typecheck
pnpm --filter <name> run test
pnpm --filter <name> run test:coverage
```

| Package | lint | build | typecheck | test | coverage command |
| --- | --- | --- | --- | --- | --- |
| `@jeswr/fetch-rdf` | PASS (0) | PASS (0) | PASS (0) | PASS (0), 47 tests | PASS (0) |
| `@jeswr/solid-a2a` | PASS (0) | PASS (0) | PASS (0) | PASS (0), 256 tests | PASS (0) |
| `@jeswr/federation-registry` | PASS (0) | PASS (0) | PASS (0) | PASS (0), 101 tests | PASS (0) |
| `@jeswr/solid-odrl` | PASS (0) | PASS (0) | PASS (0) | PASS (0), 257 tests | PASS (0) |

Fetch-rdf retains all 26 upstream tests. New tests cover default remote-context refusal,
explicit offline loading, allowlist rejection, injected-fetch use, nested contexts,
context failures, metadata/redirect semantics, source errors without unhandledRejection,
parser-error cancellation of stalled sources, locked streams, non-Error failures, and
large-chunk backpressure. Sanitizer tests cover JS/map labels across checkout paths,
spaces and node_modules ancestors, plus unrelated and ancestor-path rejection.

Coverage percentages (statements / branches / functions / lines):

| Package | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| fetch-rdf | 94.35 | 94.11 | 90.47 | 98.13 |
| solid-a2a | 98.18 | 96.12 | 100 | 98.18 |
| federation-registry | 99.03 | 94.70 | 98.43 | 99.03 |
| solid-odrl | 96.88 | 92.95 | 95.65 | 96.88 |

These commands pass their existing configured thresholds. The pre-existing solid-odrl
coverage configuration does not enforce the charter's 100% security-critical target;
no coverage policy or unrelated application logic was changed in this scoped fix.

Early local runs needed `pnpm --filter @jeswr/rdf-serialize run build` (PASS, 0) because
its dist was absent. Initial sanitizer runs also exposed esbuild following upstream
source maps into sibling `src/` files; handling those paths was necessary for the
requested builds to pass. The table above records final runs after those corrections.

## Workspace consumer typechecks

Every one of the 48 manifests switched to `workspace:*` in `99061d3a` was checked
explicitly, after dependency-first builds, using this command for each name below:

```sh
pnpm -r --filter <name> run typecheck
```

**47 PASS, 1 FAIL.** Pod Money's errors are in `test/store.test.ts`: its injected readers
return the older object shape without `headers`. They also declare DatasetCore rather
than Store. Production metadata property reads no longer report missing `etag`/`url`.
No consumer source or test fixture was changed.

| Consumer | Typecheck |
| --- | --- |
| `@jeswr/app-access-manager` | PASS (0) |
| `@jeswr/solid-app-store-web` | PASS (0) |
| `@jeswr/app-coeliac` | PASS (0) |
| `@jeswr/app-issues` | PASS (0) |
| `@jeswr/app-pod-chat` | PASS (0) |
| `@jeswr/pod-chat-web` | PASS (0) |
| `@jeswr/app-pod-docs` | PASS (0) |
| `@jeswr/pod-docs-web` | PASS (0) |
| `@jeswr/app-pod-drive` | PASS (0) |
| `@jeswr/pod-drive-web` | PASS (0) |
| `@jeswr/app-pod-health` | PASS (0) |
| `@jeswr/pod-health-web` | PASS (0) |
| `@jeswr/app-pod-mail` | PASS (0) |
| `@jeswr/pod-mail-web` | PASS (0) |
| `@jeswr/app-pod-manager` | PASS (0) |
| `@jeswr/app-pod-money` | FAIL (2) |
| `@jeswr/pod-money-web` | PASS (0) |
| `@jeswr/app-pod-music` | PASS (0) |
| `@jeswr/pod-music-web` | PASS (0) |
| `@jeswr/app-pod-photos` | PASS (0) |
| `@jeswr/pod-photos-web` | PASS (0) |
| `@jeswr/federation-client` | PASS (0) |
| `@jeswr/federation-registry` | PASS (0) |
| `@jeswr/federation-trust` | PASS (0) |
| `@jeswr/matrix-chat-to-pod` | PASS (0) |
| `n8n-nodes-solid` | PASS (0) |
| `@jeswr/rxdb-solid` | PASS (0) |
| `@jeswr/solid-a2a` | PASS (0) |
| `@jeswr/solid-agent-card` | PASS (0) |
| `solid-agent-notify` | PASS (0) |
| `@jeswr/solid-api-auth` | PASS (0) |
| `@jeswr/solid-auth-core` | PASS (0) |
| `@jeswr/solid-bookmark` | PASS (0) |
| `@jeswr/solid-chat-interop` | PASS (0) |
| `@jeswr/solid-components` | PASS (0) |
| `@jeswr/solid-dav-bridge` | PASS (0) |
| `@jeswr/solid-drawing` | PASS (0) |
| `@jeswr/solid-elements` | PASS (0) |
| `@jeswr/solid-granary` | PASS (0) |
| `@jeswr/solid-health-diary` | PASS (0) |
| `@jeswr/solid-mcp` | PASS (0) |
| `@jeswr/solid-memory` | PASS (0) |
| `@jeswr/solid-odrl` | PASS (0) |
| `@jeswr/solid-pod-guard` | PASS (0) |
| `@jeswr/solid-task-model` | PASS (0) |
| `@jeswr/solid-vc` | PASS (0) |
| `@jeswr/unstorage-solid` | PASS (0) |
| `@jeswr/y-solid` | PASS (0) |

## Root and dependent checks

- `pnpm run lint:root`: PASS (0), including final rerun after code changes.
- `pnpm run test:root`: PASS (0), 2 files / 26 tests.
- `git diff --check`: PASS (0).
- Dependency policy: no dependencies added; `check:packages` was not needed in this
  round. No manifests or lockfiles changed. The original workspace conversions remain.
- `pnpm exec turbo run build typecheck test --filter=...@jeswr/fetch-rdf --concurrency=4 --continue=always`:
  FAIL (2), 156 successful / 162 tasks. Repeated on the final code with
  `npm_config_cache=/tmp/sst-8xm.30-npm-cache`: same six failing tasks, 91 cached tasks.
  Turbo's strict environment filtering did not pass that cache setting through.
- `npm_config_cache=/tmp/sst-8xm.30-npm-cache pnpm --filter create-solid-demo run test`:
  PASS (0), 32 tests passed / 1 skipped, confirming the packed-bin failure below is
  avoided with a writable npm cache.
- `gate:full` / whole-workspace gate: not run, as explicitly prohibited by the lane
  brief; the dispatcher owns wider validation.
- roborev: unavailable on PATH. No automated review verdict could be obtained.
  Manual review caught and fixed the sanitizer ancestor escape in `5b17ce6b`.

Dependent-gate failures on final code:

| Task | Finding |
| --- | --- |
| `@jeswr/app-pod-money#typecheck` | Legacy injected test readers lack required headers and use DatasetCore; metadata field restoration alone does not adapt that contract. |
| `@jeswr/solid-vc#test` | JSON-LD round-trip tests load the remote credentials/v2 context; the requested default policy now refuses it. |
| `@jeswr/solid-chat-interop#test` | JSON-LD reconciliation loads a remote ActivityStreams context; the requested default policy now refuses it. |
| `@jeswr/federation-trust#test` | Characterization snapshot differs in delegateKey JWK property order; also reported at the previous lane head. |
| `@jeswr/solid-components#test` | 39 component tests fail, primarily while displaying Loading; related failures were reported at the previous lane head. No unrelated component changes attempted. |
| `create-solid-demo#test` | npm pack fails with EROFS against /home/runner/.npm; standalone rerun with a writable cache passes. |

## Remaining work and open question

The import's wider acceptance remains incomplete. The dispatcher retains follow-up
tracking and bead closure; no tracker state was changed from this dedicated checkout.

- Resolve the Pod Money injected-reader compatibility choice in QUESTIONS.md: adapt
  its contracts/test doubles or explicitly relax the additional public result types.
  This round conservatively restores the requested fields and preserves the imported
  Store/headers type requirements.
- VC and chat parsing callers need an explicit safe context policy/offline loader to
  support their existing remote-context documents under the new default. Expanding
  those packages or bundling new contexts was outside this fix brief.
- Diagnose the snapshot/component failures and run the dispatcher-owned wider gate.
  The known failures above prevent calling the lane merge-ready.
- Obtain the required roborev review when its executable/service is available.

All work and commits stayed on lane/sst-8xm.30. No push, PR, branch switch, network Git
fetch/merge, dependency addition, or mirror publication. Generated apps/*/web/public
build outputs were removed. Dist remains untracked/ignored. The report is committed
last and the tracked/untracked working tree is clean at handoff.
