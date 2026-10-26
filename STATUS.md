<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-c871 — SH-L2 client-side search index

Implemented on `lane/sst-c871`, based on
`8c73e21f266896914a67b6434814b8bb567e1ba7`.

## Commits

- `50e4e0e0` — `feat(suite): add client search index`: pure TypeScript inverted
  index, Unicode tokenization/folding, title/body weighting, last-term prefix
  matching, BM25 ranking, strict atomic add/update, idempotent remove, versioned
  JSON serialization/restore, grapheme-safe snippets and UTF-16 highlight ranges.
  Includes the barrel, 80 synthetic-fixture search tests, the search coverage glob,
  and conservative defaults in `QUESTIONS.md`.
- `docs(suite): record search lane validation` — this final status-only commit.

## Validation

All commands ran inside this checkout. No new dependencies or manifest/lockfile
changes; `check:packages` is therefore not applicable. No UI was built, and no
Playwright runs or screenshots were required or taken.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; builds the existing dependency's declarations and CSS output. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; Next.js production build, strict typecheck, lint and all 332 tests across 11 files. |
| `pnpm run lint:root` | PASS; workspace/layer/transport guards, fetch check, token check, all 74 contrast pairs. |
| `TURBO_SCM_BASE=8c73e21f266896914a67b6434814b8bb567e1ba7 pnpm run gate` | PASS; 7/7 tasks, no cache hits. |
| `pnpm run gate:full` | FAIL; 33 successful tasks before the unrelated `@jeswr/unstorage-solid#build` failure; remaining workspace checks did not finish. |
| `git diff --check` | PASS before the implementation commit and final status commit. |

The search directory has **100% statements, branches, functions and lines**, with
per-file thresholds enforced by the normal app test command. The barrel contains
only re-exports and no executable statements. Tests include numeric BM25 oracles,
Unicode expansions and scripts, normalization rejection, malformed runtime inputs,
atomic updates, detached outputs, prefix matching, snippets, corrupt snapshots, and
50 deterministic generated mutation sequences compared with fresh rebuilds.

Additionally, the case-fold algorithm was compared against the
[Unicode 17 full/default case-fold data](https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt)
for all 1,114,112 code points after the documented normalization pipeline, with
zero differences on Node 24.22.1 (Unicode 17.0). This was a temporary validation
outside the committed tests; no downloaded Unicode data or runtime dependencies
were added.

An early typecheck before building workspace dependencies failed on missing
`@jeswr/suite-ui` declarations; the dependency-first validation above resolved it.

## Unfinished / blocked

- Full-workspace gate: the existing unstorage-solid build-deps script clones the
  lockfile-pinned fetch-rdf source, then invokes
  `npm install --no-audit --no-fund --ignore-scripts --prefer-offline` in its
  temporary build. npm failed with `EROFS` opening its cache under
  `/home/runner/.npm/_cacache/tmp/`. No source in that package was changed. A retry
  would repeat the network clone outside this lane's restrictions, so it was not
  attempted. The lane-specific app and affected gates are green.
- Automated per-commit review: `command -v roborev` found no CLI, and this checkout
  has no active post-commit review hook. No roborev verdict was available; the
  dispatcher still needs to run/read review. No review tooling was installed.

## Open questions / conservative readings

See `QUESTIONS.md` for the unspecified constants, query combination, snippet
conventions, locale and future façade integration. Defaults are implemented and
reviewable; none blocks the pure library. Compatibility folds that change word
boundaries are explicitly rejected with a typed error. No SDK hook/UI/network or
persistence integration was added, as required by SH-L2's pure-library scope.
