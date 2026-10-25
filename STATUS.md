<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Lane sst-8xm.30 — T-004 fetch-rdf import

Date: 2026-10-25. Branch: `lane/sst-8xm.30`.

**Blocked on the API compatibility decision in [QUESTIONS.md](QUESTIONS.md). Not ready to merge.**
The brief requires stopping when an ADR/API requirement is ambiguous. The conservative
choice here is to preserve the dispatcher-selected upstream API exactly and leave consumer
implementation changes for an explicit decision.

## Commits

- `c95e3bfb feat: import fetch-rdf history`.
- `99061d3a chore: integrate fetch-rdf workspace package`.
- Final report commit: `docs: record fetch-rdf lane blocker` (this file and `QUESTIONS.md`).

The import cloned the supplied local source with `git clone --no-local` into `/tmp`,
filtered history with `git filter-repo --to-subdirectory-filter packages/fetch-rdf`,
fetched that temporary clone, and merged with `--allow-unrelated-histories`. All nine
source commits were retained. Original main tip
`a8359a3764cb6b3c763e09ea211542a5dc7edc33` maps to filtered tip
`1dc0529cd3eabc6be1b21df85e91aaa02c4525b8`. The source clone was not modified.
`git-filter-repo` was absent from PATH, so it was installed under `/tmp` only. No network
Git remote was fetched or pushed.

## Changes

- Imported `packages/fetch-rdf`, retaining its five public exports and all 26 upstream tests.
- Adapted to Node >=24, root TypeScript configuration, TypeScript 6, Biome and Vitest 4.
  Test sources are also typechecked; mocks have typed fetch signatures.
- Removed the imported npm lockfile, standalone CI/review configuration and standalone
  agent standards; lifecycle `prepare` was removed. No dist files are tracked at HEAD.
- Added `mirrorPublish: { inlined: [] }`; mirror tooling derives `jeswr/fetch-rdf` from
  the package name. No mirror publication was attempted.
- Switched 49 dependency entries in 48 package/app manifests to `workspace:*`, preserving
  `packages/create-solid-app/template/package.json` for external projects. Updated the
  root lockfile with `pnpm install --ignore-scripts` (exit 0).
- Added the package to `suite.json`; moved the RDF skill beside the package and corrected
  its example to use `headers.get("etag")`. Updated README skill-layout guidance.

## Validation

The later, lane-specific testing instruction explicitly prohibits `gate:full` and the
whole-workspace gate. Those commands were not run; the dispatcher owns wider validation.

- `pnpm run lint:root`: PASS, exit 0, including transport, app workspace and fetch guards.
- `pnpm run test:root`: PASS, exit 0; 2 files / 26 tests.
- `pnpm --filter @jeswr/fetch-rdf run lint && pnpm --filter @jeswr/fetch-rdf run build && pnpm --filter @jeswr/fetch-rdf run typecheck && pnpm --filter @jeswr/fetch-rdf run test`:
  PASS, exit 0; all 26 original tests pass.
- `pnpm --filter @jeswr/fetch-rdf run test:coverage`: FAIL, exit 1. All 26 tests pass,
  but upstream coverage is below the configured ADR-009 90% thresholds:
  statements 75.72%, branches 74.62%, functions 62.5%, lines 79.77%.
- `pnpm exec turbo run build typecheck test --filter=...@jeswr/fetch-rdf --concurrency=4 --continue=always`:
  FAIL, exit 2; 119 successful / 162 tasks across 51 projects. The initial run overlapped
  exploratory streaming tests that were subsequently removed when this lane stopped;
  the final individual gates below are authoritative for the retained tree.
- Local mirror-manifest smoke check: PASS. `mirrorRepoFor` resolves `jeswr/fetch-rdf`;
  `rewriteManifest` strips development scripts/dependencies/config and retains npm
  dependencies. All five exports resolve from the built entry point.
- Manifest/lockfile assertion: PASS. All 49 changed entries use `workspace:*` and the
  root lockfile contains no `github:jeswr/fetch-rdf` pins. The external-project template
  exception and inert test/build-script string fixtures remain unchanged.
- `git diff --check`: PASS.
- roborev: unavailable on PATH; no automated review verdicts could be obtained.

### Individual package gates

Completed 49 gates: **30 passed, 19 failed**. Each row uses these exact commands
with `<name>` replaced by the row name, stopping at the first failure as requested:

```sh
pnpm --filter <name> run lint && pnpm --filter <name> run build && pnpm --filter <name> run typecheck && pnpm --filter <name> run test
```

`—` means the preceding command failed, so that stage was not run. Numeric failures
are process exit codes. The separate fetch-rdf coverage command is reported above.

| Package | lint | build | typecheck | test |
| --- | --- | --- | --- | --- |
| `@jeswr/solid-a2a` | PASS | FAIL (1) | — | — |
| `@jeswr/federation-client` | PASS | FAIL (1) | — | — |
| `@jeswr/federation-registry` | PASS | FAIL (1) | — | — |
| `@jeswr/solid-drawing` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-health-diary` | PASS | PASS | PASS | PASS |
| `@jeswr/matrix-chat-to-pod` | PASS | PASS | PASS | PASS |
| `@jeswr/rxdb-solid` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-bookmark` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-elements` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-agent-card` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-api-auth` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-components` | PASS | PASS | PASS | FAIL (1) |
| `@jeswr/solid-odrl` | PASS | FAIL (1) | — | — |
| `@jeswr/y-solid` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-mcp` | PASS | PASS | PASS | PASS |
| `n8n-nodes-solid` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-granary` | PASS | PASS | PASS | PASS |
| `@jeswr/federation-trust` | PASS | PASS | PASS | FAIL (1) |
| `@jeswr/unstorage-solid` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-pod-guard` | PASS | FAIL (2) | — | — |
| `@jeswr/solid-vc` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-auth-core` | PASS | PASS | PASS | PASS |
| `solid-agent-notify` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-chat-interop` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-memory` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-task-model` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-dav-bridge` | PASS | PASS | PASS | PASS |
| `@jeswr/app-pod-drive` | PASS | FAIL (2) | — | — |
| `@jeswr/app-access-manager` | PASS | FAIL (2) | — | — |
| `@jeswr/app-pod-money` | PASS | FAIL (2) | — | — |
| `@jeswr/app-coeliac` | PASS | FAIL (1) | — | — |
| `@jeswr/app-pod-photos` | PASS | FAIL (1) | — | — |
| `@jeswr/app-pod-manager` | PASS | FAIL (1) | — | — |
| `@jeswr/app-issues` | PASS | FAIL (1) | — | — |
| `@jeswr/app-pod-mail` | PASS | FAIL (2) | — | — |
| `@jeswr/app-pod-health` | PASS | FAIL (2) | — | — |
| `@jeswr/app-pod-chat` | PASS | FAIL (1) | — | — |
| `@jeswr/app-pod-docs` | PASS | FAIL (1) | — | — |
| `@jeswr/app-pod-music` | PASS | FAIL (2) | — | — |
| `@jeswr/pod-drive-web` | PASS | PASS | PASS | PASS |
| `@jeswr/pod-money-web` | PASS | PASS | PASS | PASS |
| `@jeswr/pod-photos-web` | PASS | PASS | PASS | PASS |
| `@jeswr/pod-mail-web` | PASS | PASS | PASS | PASS |
| `@jeswr/pod-health-web` | PASS | PASS | PASS | PASS |
| `@jeswr/pod-chat-web` | PASS | PASS | PASS | PASS |
| `@jeswr/pod-docs-web` | PASS | PASS | PASS | PASS |
| `@jeswr/pod-music-web` | PASS | PASS | PASS | PASS |
| `@jeswr/solid-app-store-web` | PASS | PASS | PASS | PASS |
| `@jeswr/fetch-rdf` | PASS | PASS | PASS | PASS |

## Unfinished work and open question

1. Resolve `QUESTIONS.md`: keep upstream `{ dataset, headers }` and define consumer
   migration/redirect handling, or explicitly restore legacy result metadata fields.
   Current consumers fail on missing `FetchedRdf.etag` / `FetchedRdf.url`; this includes
   `solid-pod-guard` and multiple apps. No public API extension or caller refactor was made.
2. Complete import integration after that decision: bundled consumers such as `solid-a2a`,
   `federation-registry` and `solid-odrl` reject workspace-symlink paths to
   `packages/fetch-rdf/dist/errors.js` in their existing path sanitizers. A direct
   `federation-client` build also cannot resolve the failed registry output.
3. Bring imported coverage to ADR-009's 90% thresholds. Exploratory tests exposed upstream
   source-stream error/unhandled-rejection behavior; no parser behavior changes or those
   exploratory tests are retained in the stopped lane.
4. Review the other reported failures before any merge: `solid-components` collection tests
   fail in the Loading state, and `federation-trust` has a characterization snapshot
   mismatch. The broader dependant run also failed `create-solid-demo` tests. These have
   not been diagnosed as pre-existing or caused by the import.
5. Obtain roborev review and run dispatcher-owned wider gates. Acceptance is incomplete:
   upstream tests pass and workspace consumer pins are converted, but the dependant gate,
   coverage thresholds and `gate:full` acceptance are not green.

No tracker state was changed from this dedicated checkout. The dispatcher retains ownership
of bead closure and follow-up tracking. No push, PR, branch switch or mirror publication.
