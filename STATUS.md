<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# sst-sf1j — PHO-00 lane report

Implemented on `lane/sst-sf1j`, based on `87e46ebd2ce33de295357a9610b64d358021b460`.
Only Photos model code, its tests, app dependency/test configuration, lockfile, and lane reports changed.
No UI, React hooks, SDK façade, shell routes, real image encoding, branch switches, pushes, or PRs.

## Commits

- `ba9b7338` — `feat(photos): add typed photo and ordered album models`:
  ported Pod Photos EXIF/Photograph typed accessors and regression tests; added thumbnail and DCT
  fields, ImageObject reads (including multi-subject PM connector documents), validation, ordered
  album ListItems with add/remove/reorder/cover and legacy hasPart reads, UTC day/month grouping,
  and pure favourite preference updates. Added required dependencies and 100% coverage thresholds.
- `1e5e6486` — `feat(photos): add injected upload and storage pipeline`:
  real exifr parsing, five real TIFF/EXIF fixtures, injected image-encoder contract, all eight
  orientations and bounded 320px WebP sizing, location removal from RDF and the binary via the
  encoder, fixed binary/thumbnail/item paths, injected scoped fetch, conditional reads/writes,
  listing, uploads, and PROV-based app-managed trash/restore/purge. Tests cover collisions,
  scope/redirect refusal, partial upload failure, ETag requirements, and recovery copies.
- Final documentation commit — `docs(photos): record PHO-00 validation and interpretations`:
  this report, clarified numbered questions, and model integration documentation.

All commits use the requested identity, disabled signing, and GPT-6.1-Sol provenance trailer.

## Validation

| Exact command | Result |
| --- | --- |
| `pnpm run check:packages @jeswr/fetch-rdf @rdfjs/wrapper @rdfjs/types @solid/object n3 @types/n3 exifr @vitest/coverage-v8` | PASS: all 8 cleared before dependency addition. Workspace guarded-fetch/rdf-serialize reuse existing packages. |
| `CI=true pnpm install --ignore-scripts --no-frozen-lockfile --store-dir /tmp/sst-sf1j-pnpm-store --cache-dir /tmp/sst-sf1j-cache` | PASS. The default store was read-only; a copy under `/tmp` allowed installation without lifecycle scripts. Retained only the Photos importer and exifr additions in the lockfile; removed unrelated peer-snapshot churn. |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS: suite-ui, guarded-fetch, rdf-serialize prerequisites. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: lint, Next.js production build, strict tsc, 9 test files / 94 tests. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS: every `lib/model` file meets 100% statements, branches, functions, and lines. Totals: 508 statements, 350 branches, 137 functions, 436 lines. No coverage exclusions or ignore annotations. |
| `pnpm run lint:root` | PASS, including workspace/lockfile guards and 74 contrast pairs. |
| `TURBO_SCM_BASE=87e46ebd2ce33de295357a9610b64d358021b460 pnpm run gate` | PASS: 9 / 9 tasks. |
| `pnpm run gate:full` | FAILED in untouched `@jeswr/unstorage-solid#build`: its build-deps bootstrap invoked a remote clone into `/tmp`, then `npm install --no-audit --no-fund --ignore-scripts --prefer-offline` failed with EROFS at `/home/runner/.npm/_cacache/tmp/`. 29 / 158 tasks completed before the failure; full-workspace validation is incomplete. |
| `git diff --check` | PASS. |
| `command -v roborev` | Unavailable; no automated review verdict could be collected. |

The remote clone was an unexpected side effect of the required full gate, not an explicit lane
fetch/merge operation. The bootstrap was not changed or rerun. Correcting that unrelated build or
running it in an authorized environment remains outside this lane.

Screenshots / Playwright: not applicable; PHO-00 builds no rendered component or route. Chromium
was not launched. No dependencies outside the model and its coverage tooling were added. No
workspace inventory changes were needed because no package or application was imported.

## Integration notes and open questions

Implementation is complete. Full-workspace validation and roborev review remain blocked as above.
`QUESTIONS.md` records the conservative interpretations: fixed item URLs with pure UTC month
shards/groups; strip location from both RDF and binary; per-photo PROV trash records with guarded
purge; existing standard vocabulary constants while suite-vocab is absent from this base.

PHO-01 supplies the real Canvas/image encoder and hooks/SDK adapters. Favourites here are pure
preference values; persistence is left to that adapter. Partial uploads stop with earlier successful
writes retained; callers reconcile those resources before retrying the same identifiers. Trash
moves preserve a recovery copy on delete failure; restore is create-only, and purge refuses live
original descriptions or binary paths outside the matching app-managed photo paths. Automatic
trash expiry and rewriting album/favourite references were not inferred from the Photos spec.
