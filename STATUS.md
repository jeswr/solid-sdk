<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-ssm2 — DOC-L1 lane report

Branch: `lane/sst-ssm2`. Base: `ed72921cb1a22d6e10b9488eb8b3246c36155451`.

Implementation complete within `apps/suite/src/apps/docs/lib/anchoring/`.
No dependencies, manifests, lockfile, application registrations or UI changed.

## Commits

- `9b7257e6` — `feat(docs): add Web Annotation text anchoring`: public selector/result
  types and index barrel; `createSelectors` records exact text and up to 32 code
  points of adjacent context plus a position selector. `reanchor` tries the original
  position, searches the full projection for the exact quote, then uses bounded
  Levenshtein Bitap with 32-code-point words. Matches include confidence, a range
  and refreshed selectors; below-threshold/no-match results are orphans. Inputs
  remain immutable. Tests and per-file 100% coverage enforcement included.
- `64fd7646` — `fix(docs): bound fuzzy recovery memory and work`: sparse character
  masks, reusable banded edit-distance rows, independent oracle checks across word
  boundaries, and a 1,024-code-point quote regression.
- Final documentation commit — this report, committed after the gates below.

## Verification

Run in this checkout, with lifecycle scripts remaining disabled:

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; build the existing workspace dependency before direct app checks. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS on final implementation; Next.js production build, strict tsc, lint, and 149 tests across 7 files. |
| `pnpm run lint:root` | PASS, including workspace/lockfile/fetch/token/contrast guards (74 contrast pairs, no failures). |
| `TURBO_SCM_BASE=ed72921cb1a22d6e10b9488eb8b3246c36155451 pnpm run gate` | PASS; 7/7 tasks successful. |
| `pnpm run gate:full` | BLOCKED outside lane scope; exit 1 at `@jeswr/unstorage-solid#build`, 27 successful of 164 scheduled tasks. |
| `git diff --check ed72921cb1a22d6e10b9488eb8b3246c36155451` | PASS. |
| `command -v roborev` | Unavailable; no automated per-commit review verdicts could be obtained. |

The full gate's unchanged `packages/unstorage-solid/scripts/build-deps.mjs`
bootstraps a dependency through an external git clone into `/tmp`, then runs
`npm install --no-audit --no-fund --ignore-scripts --prefer-offline`. That install
failed with `EROFS` opening `/home/runner/.npm/_cacache/tmp/…`. No retry was made:
the lane prohibits fetching remote repositories and changing other checkouts.
No lane code touches that package. Remaining full-workspace checks are unverified.

Coverage: every source file in `src/apps/docs/lib/anchoring/` has **100% statements,
branches, functions and lines** in Vitest's JSON summary, with per-file thresholds
enabled. The index and type-only file have no executable statements. The 52 new
tests cover validation, Unicode and whitespace, context clipping, positional and
global quote matches, duplicates/overlaps, context/proximity/order tie breaking,
insertions/deletions/substitutions/transpositions, threshold boundaries, orphans,
search/edit bounds, surrogate boundaries, long patterns and immutable edit
sequences. Independent full-matrix distance oracles compare 2,268 short cases and
15 cases around 32-bit word boundaries against Bitap results.

Dependency policy: `check:packages` not applicable; no third-party dependency added.
Screenshots/Playwright/axe: not applicable; this lane renders no UI. Chromium was
not launched. The pure-library amendment (09-pure-libraries) governs this scope.

## Open questions and limitations

The implementation choices required by underspecified details are recorded in
[QUESTIONS.md](QUESTIONS.md): caller-provided projection and Unicode code point
offsets; confidence formula, tie breaking and finite fuzzy bounds. Conservative
defaults are exposed in the public API: threshold 0.5, radius 1,024 code points
(configurable 0–4,096), at most 32 edits. Exact quote lookup is always global.
These choices do not block this lane, and can be reviewed by the DOC-09 consumer.

No implementation work remains in DOC-L1. Full-workspace gate completion and
roborev review remain environment/tooling limitations for the dispatcher. Editor
marks, DOM projection, React integration and annotation persistence belong to
subsequent tasks. No pushes, PRs, branch switches or manual remote fetches/merges
were performed.
