<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MUS-L1 — sst-ne8m lane report

Branch: `lane/sst-ne8m`. Base: `606c87b7edf73e83f118f95295b0eeda7abb6d92`.

Implementation is complete. No push, PR, branch switch or remote git fetch/merge
was performed. Only this checkout was changed.

## Commits

- `0feaac67` — `feat: extract audio metadata in memory`: browser-compatible
  `music-metadata` wrapper and barrel under
  `apps/suite/src/apps/music/lib/metadata/`; typed eight-field result; dependency
  and lockfile entries; conservative API interpretation in `QUESTIONS.md`.
- `f0383431` — `test: cover audio metadata formats and edge cases`: generated
  synthetic fixtures, 22 metadata tests, and automatic per-file 100% coverage
  thresholds for the entire metadata directory, including the barrel.
- Final documentation commit — `docs: record MUS-L1 lane validation` (this file).

## Dependency policy and installation

Both checks ran before adding the corresponding dependency:

| Command | Result |
| --- | --- |
| `pnpm run check:packages music-metadata` | PASS, full npm policy mode |
| `pnpm run check:packages @vitest/coverage-v8` | PASS, full npm policy mode |

Added `music-metadata@12.3.2` and the already-lockfile-present
`@vitest/coverage-v8@4.1.10`. Lifecycle scripts remained disabled.

The initial add could not write the preconfigured read-only pnpm store. A
temporary store under `/tmp` was used for installation; only ignored local
node_modules metadata changed to select that store. Unrelated GitHub pin and
peer-resolution churn from the initial resolver attempt was discarded.

Successful manifest/lock consistency check and dependency installation:

```sh
XDG_CACHE_HOME=/tmp/sst-ne8m-cache pnpm install --frozen-lockfile --store-dir /tmp/sst-ne8m-pnpm-store --filter @jeswr/app-suite --ignore-scripts
```

Exit 0; resolution skipped, 11 npm packages downloaded. An additional unfiltered
offline lockfile-only installation attempt could not find an existing unrelated
`agent-authz-verifier` GitHub tarball in the temporary store; it did not change
the final manifest/lockfile contents.

## Validation

Built the existing workspace dependency first:
`pnpm --filter @jeswr/suite-ui run build` — PASS. No suite-ui source changed.

Required app checks, run as one sequential command — PASS, exit 0:

```sh
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
```

Next.js production build passed. Two test files / 23 tests passed (22 metadata
tests plus the existing fixture-access test). Metadata directory coverage:
**100% statements, branches, functions and lines**, enforced per file on every
test run. `apps/suite/coverage/coverage-summary.json` is generated and ignored.

Coverage includes ID3v2.3/2.4 text and APIC, all four ID3 text encodings with
non-ASCII text, ID3v1.0/1.1, ID3v2 precedence, FLAC comments/STREAMINFO/PICTURE,
Ogg comments/granule duration/base64 artwork, MP4 text/track/disc/date/duration/
cover atoms, absent metadata/artwork/duration, repeated reads without input
mutation or detachment, no fetch, invalid input and truncated containers.

Additional browser compatibility verification — PASS: bundled the public barrel
with the installed esbuild 0.28.1 API using `platform: 'browser'`, `bundle: true`,
`format: 'iife'`. Checked its input graph selected `music-metadata/lib/core.js`
and excluded the Node entry point. Executed the bundle and generated fixtures in
an isolated Node VM containing browser text/stream APIs and no `Buffer`,
`process`, `require` or `fetch`. All six format variants parsed their title,
artist and positive duration. No browser binary or Playwright was launched.

| Required command | Result |
| --- | --- |
| `pnpm run lint:root` | PASS, including all 74 contrast pairs |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | PASS, 7/7 tasks |
| `pnpm run gate:full` | FAIL in unrelated `@jeswr/unstorage-solid#build`; 23 tasks completed successfully before cancellation |
| `npm_config_cache=/tmp/sst-ne8m-npm XDG_CACHE_HOME=/tmp/sst-ne8m-cache pnpm run gate:full` | FAIL at the same unrelated bootstrap; 27 tasks completed successfully before cancellation |

Full gate failure: `packages/unstorage-solid/scripts/build-deps.mjs` invokes
`npm install --no-audit --no-fund --ignore-scripts --prefer-offline`; npm receives
`EROFS` writing `/home/runner/.npm/_cacache/tmp/`. The temporary-cache retry did
not propagate those overrides through Turbo's task environment. No unrelated
build infrastructure was edited. Local logs are `/tmp/sst-ne8m-gate.log`,
`/tmp/sst-ne8m-gate-full.log` and `/tmp/sst-ne8m-gate-full-cache.log`.

## Limitations and questions

- `roborev status` returned exit 127 (`roborev: command not found`). No automated
  per-commit verdicts are available in this environment; review remains pending.
- No UI, components, routes or styles were built. Screenshots and UI axe checks
  are inapplicable to this pure-library task; no PNGs were generated or committed.
- No implementation work remains. Full-workspace verification and automated
  review have the environment limitations above.
- No blocking questions. `QUESTIONS.md` records the unspecified output contract:
  duration in seconds, missing fields as null, track/disc without totals, first
  tagged artist/picture MIME, and upstream partial-result/error semantics.

<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 2 — metadata normalization

- `c86a971a` — `fix: normalize metadata year and first artist`: reject non-finite
  parsed years and fall back to the native ID3v1 year; use the first parsed
  `common.artists` entry with `common.artist` as fallback. Extend synthetic
  fixtures and tests for both ID3v2 versions, invalid/missing legacy years, and
  repeated FLAC `ARTIST`/`ARTISTS` comments.
- Final documentation commit — `docs: record metadata normalization validation`.

Regression verification: the updated tests failed against the original
`fb563b151d1a` implementation on invalid years and plural artists, then passed
with the fixes. The temporary original-source substitution was restored before
running the gates.

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; generated the existing workspace dependency output |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; 33 tests, 100% metadata statements/branches/functions/lines |
| `pnpm run lint:root` | PASS |
| `TURBO_SCM_BASE=fb563b151d1a4f20412812343b5046fa2827ac3e pnpm run gate` | PASS; 6/6 tasks |
| `pnpm run gate:full` | FAIL; unrelated `@jeswr/unstorage-solid#build` npm bootstrap hits `EROFS` in `/home/runner/.npm/_cacache/tmp/`; 16 tasks succeeded before cancellation |
| `roborev status` | Unavailable; command not found (exit 127) |

The first direct app gate attempt failed because `suite-ui` had no generated
output in this checkout; the dependency build and complete rerun above passed.
Full gate logs: `/tmp/sst-ne8m-round2-gate.log` and
`/tmp/sst-ne8m-round2-gate-full.log`. No dependencies or UI changed. Both review
findings are resolved; no implementation work or open questions remain.
