<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-uxd8 — MUS-00 lane report

Implemented the pure music model in `apps/suite/src/apps/music/lib/model/` on
`lane/sst-uxd8`, based on `606c87b7edf73e83f118f95295b0eeda7abb6d92`.
No React, hooks, SDK façade, routes, UI, connector changes or new workspace projects.

## Commits

- `55b28ed9 feat: add pure music data models`: alias-aware typed readers for Music
  Ontology, schema.org and media records; canonical schema/media writers; tracks,
  albums, artists and ordered playlists; liked interop playlist; history and stats;
  artwork preferences; injected-fetch RDF I/O; three-model fixtures and initial tests.
- `a6c76486 fix: preserve music metadata during edits`: collect unreferenced blank
  ListItems without deleting shared/named entries, clear legacy ISRC values, ignore
  empty artist literals, test history and I/O boundaries, enforce 100% coverage per
  model file.
- Final documentation commit (`docs: record MUS-00 lane validation`): this report.

## Validation

The sandbox did not expose the root tool binaries to dependency-only workspace
packages. Commands below ran after this checkout-local environment adjustment:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
```

| Exact command | Result |
| --- | --- |
| `pnpm install --ignore-scripts` | PASS; lockfile changed only in the suite app importer; existing unrelated peer warnings remain. |
| `pnpm --filter @jeswr/app-suite... run build` | PASS after the PATH adjustment; builds the four workspace dependencies and Next app. Initial attempt without the PATH adjustment failed because suite-vocab could not find `tsc`. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; 4 test files, 38 tests (37 music tests and the existing fixture-access test). |
| `pnpm --filter @jeswr/app-suite run coverage:music` | PASS; all 10 model TypeScript files included, 100% statements (339/339), branches (206/206), functions (105/105) and lines (292/292); thresholds enforced per file. |
| `pnpm run lint:root` | PASS; workspace, transport, fetch, token and contrast guards pass (74 contrast pairs, 0 failures). An initial token-check false positive on RDF fragment `#bad` was fixed by renaming the fixture fragment to `#malformed`. |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | PASS; 10/10 tasks, including the final suite lint/build/typecheck/test and root tests (41 tests). |
| `pnpm run gate:full` | FAILED outside this lane in unchanged `@jeswr/unstorage-solid#build`: npm attempted to write `/home/runner/.npm/_cacache/tmp/…` and received `EROFS`. Turbo reported 7 successful tasks before stopping. |
| `git diff --check` | PASS. |

The full gate also invoked the existing unstorage-solid dependency build's remote
clone into a temporary directory, before its npm-cache failure. That build script
cleans up its temporary checkout in `finally`. It was not rerun because its remote
clone conflicts with the lane's network-git restriction; no unrelated package or
build script was modified. Logs are in `/tmp/sst-uxd8-gate.log` and
`/tmp/sst-uxd8-gate-full.log` for this sandbox session.

Tests exercise three-model convergence, literal/linked artist and album values,
legacy vocabulary aliases, malformed RDF fallbacks, Turtle/JSON-LD parsing,
serialization, field validation and clearing, dense playlist positions and duplicate
tracks, liked flags and mirror playlist, UTC month/year edges, Today/1W/1M/1Y
boundaries, recent plays, artwork opt-in, scoped listings, typed read errors,
conditional writes, denied reads, absent history shards, idempotent event IDs and
conflict propagation without overwrite.

## Dependency policy

The brief requires typed RDF access, sanctioned parsing/serialization and vocabulary
constants. All external additions already existed elsewhere in the lockfile; no new
resolved third-party versions were introduced. Each command passed before adding
the external dependency to the suite manifest:

- `pnpm run check:packages @jeswr/fetch-rdf` — PASS.
- `pnpm run check:packages @rdfjs/wrapper` — PASS.
- `pnpm run check:packages @solid/object` — PASS.
- `pnpm run check:packages n3` — PASS.
- `pnpm run check:packages @rdfjs/types` — PASS.
- `pnpm run check:packages @types/n3` — PASS.
- `pnpm run check:packages @vitest/coverage-v8` — PASS.

Workspace dependencies use `workspace:*`: suite-vocab, rdf-serialize and guarded-fetch
(the shared pod-scope guard). Lifecycle scripts remained disabled.

## Remaining limits and questions

- MUS-00 implementation and affected validation are complete. The full workspace
  gate remains blocked by the unrelated build/environment failure above.
- `roborev` is not installed (`command -v roborev` returned no executable), so no
  automated per-commit review verdict was available. No review tools or hooks were
  installed or reconfigured.
- Screenshots and Playwright specs: not applicable; this model-only lane renders no
  components or states. Chromium was not launched.
- `QUESTIONS.md` records conservative defaults: artwork off until opt-in; Today uses
  UTC midnight and 1W/1M/1Y use inclusive rolling 7/30/365-day windows; liked flags are
  authoritative and cross-document playlist persistence/recovery is left to MUS-01.
- Hook integration, preferences persistence, Type Index discovery, caching/outbox,
  live subscriptions and UI remain in the later MUS-01/UI lanes as specified.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 1

Addressed exactly the three review findings against `a025663eb656`:

- `33835b72 fix: reject unsafe music subject IRIs`: reject named subjects requiring
  escaping before mutation, including direct field writes and album membership.
  Preserve imported RDF identities. Test string and NamedNode inputs with all
  forbidden IRIREF symbols, controls and an injection payload; verify a safe,
  lexically non-normalized IRI survives serialization unchanged.
- `830d322e fix: preserve linked playback instants`: follow `core:atTime` references
  to `time:inXSDDateTime`; create stable instant IRIs and reuse imported instant
  IRIs on edits. Write `time:Instant` and typed `xsd:dateTime` values, retaining
  instant metadata. Replace the media fixture's literal timestamp with the sector
  structure. Test new events, imported events, repeated edits, malformed values,
  clearing and round trips. Keep literal timestamp reads for compatibility.
- `43b0e146 fix: synchronize music track titles`: write `schema:name` and
  `dcterms:title` together for tracks, clearing previous values on explicit edits.
  Test creation and repeated renames across mo, schema and media imports.
- Final documentation commit (`docs: record music review fixes`): this report.

Validation used `export PATH="$PWD/node_modules/.bin:$PATH"`:

| Exact command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS; build the four workspace dependencies before model tests. The first focused test attempt before this build could not resolve the unbuilt `@jeswr/rdf-serialize` entry; rerunning after the build passed. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; 4 test files, 44 tests. |
| `pnpm --filter @jeswr/app-suite run coverage:music` | PASS; 100% statements (369/369), branches (224/224), functions (108/108), lines (319/319), with per-file thresholds. |
| `pnpm run lint:root` | PASS; all root guards, including 74 contrast checks. |
| `TURBO_SCM_BASE=a025663eb6563a26fff917edbd01dd288c804696 pnpm run gate` | PASS; 9/9 tasks, including final app lint/build/typecheck/test. Log: `/tmp/sst-uxd8-fix-round-1-gate.log`. |
| `git diff --check` | PASS. |

No dependencies, configuration, UI or unrelated implementation changed. No remote
git operations ran. The full workspace gate was not rerun: the unchanged
`packages/unstorage-solid/scripts/build-deps.mjs` invokes a remote `git clone`,
which this lane explicitly forbids. `roborev` remains unavailable, so per-commit
automated reviews could not run. No fixes remain unfinished; no open questions.

## Fix round 3

Addressed exactly the four findings in
`solid-sdk-lane-sst-uxd8-9f7771e9ea61.md`, starting from `9f7771e9ea61`:

- `c1ecdc32 fix: avoid collisions for every new playback instant`: apply the
  allocation collision checks whenever there is no reusable private named instant.
  Regression tests cover absent, literal and blank timestamp links, subject-only
  collisions, incoming references, preserved timestamps/metadata and repeated edits.
- `afcfa881 fix: synchronize artist album and playlist labels`: add entity-specific
  title setters for schema names plus artist `foaf:name` and album/playlist
  `dcterms:title`. Test creation, imported labels, repeated renames, legacy schema
  aliases, invalid edits, preserved metadata and serialization.
- `ded0160c fix: reject named graphs before music Turtle writes`: choose the review's
  conservative option of rejecting named graphs with `InvalidMusicError`, keeping
  the existing Turtle write contract. Test JSON-LD named and blank graph names,
  unchanged datasets and refusal before any PUT; default-graph writes still pass.
- `e70a9355 fix: deduplicate aliased playlist entries`: deduplicate ListItem terms
  before reading positions, retaining distinct entries for the same track. Test
  named and blank aliased entries through reorder, append and round trips. Extend
  the rename regression setup to include a previous schema-only edit.
- Final documentation commit (`docs: record music fix round three validation`):
  this report, committed last.

Validation used `export PATH="$PWD/node_modules/.bin:$PATH"`:

| Exact command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS; built the four workspace dependencies. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/music/history.test.ts` | PASS; 23 tests. New collision tests failed before the fix. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/music/model.test.ts` | PASS; 23 tests. New label and alias tests failed before their fixes. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/music/io.test.ts` | PASS; 16 tests. Both new named-graph tests failed before the fix. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; 4 test files, 63 tests. |
| `pnpm --filter @jeswr/app-suite run coverage:music` | PASS; 100% statements (421/421), branches (242/242), functions (120/120) and lines (368/368), with per-file thresholds. |
| `pnpm run lint:root` | PASS; all workspace, transport, fetch, token and contrast guards; 74 contrast pairs, 0 failures. |
| `TURBO_SCM_BASE=36a5d720c16092434e92f07bc73f14e4784f65ce pnpm run gate` | PASS; 9/9 tasks. Log: `/tmp/sst-uxd8-fix-round-3-gate.log`. |
| `git diff --check` | PASS. |

No dependencies, configuration, UI or unrelated implementation changed. No remote
git operations ran. As previously recorded, `gate:full` was not rerun because the
unchanged unstorage-solid dependency build invokes a remote `git clone`, which
conflicts with this lane's restrictions. `roborev` remains unavailable
(`command -v roborev` returned no executable), so no per-commit automated verdicts
were available. All four requested fixes are complete; no open questions.
