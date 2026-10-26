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

## Fix round 1 — review of `abb429dbd34e`

Implemented exactly the four supplied findings on the same `lane/sst-sf1j` branch.

- `cb97cc76` — `fix(photos): claim trash before restore or purge`: ETag-conditional
  persisted `restoring`/`purging` states fence stale competing operations before side effects.
  Purging records cannot restore, including after partial binary deletion; purge can retry.
  Restoring records cannot purge and can retry create-only restore. Added deterministic races
  for both winners, partial-delete recovery, claim ETag requirements, and state validation.
- `c55bb43a` — `fix(photos): allow WebP uploads without EXIF`: recognize the WebP
  container before the unsupported exifr reader. Added real lossless one-pixel WebP bytes,
  encoder/path assertions, decoder failure propagation, and rejection of other RIFF formats.
- `37d4836c` — `fix(photos): preserve nested terms and valid metadata`: retain RDF terms
  when following named/blank album ListItems and capture points. Independently guard optional
  numeric/URL/date conversions, validate dates before formatting, and retain valid fields and
  other subjects. Added mixed-resource, blank-node round-trip, and multi-photo corrupt-metadata
  regressions.
- Final documentation commit — `docs(photos): record review fixes and validation`: update
  the model integration notes and this report.

Conservative WebP interpretation: omit metadata unsupported by the pinned reader instead of
adding a parser or dependency. The encoder still validates/decodes pixels and supplies dimensions;
WebP thumbnails default to orientation 1. Ordinary trash records without a state remain readable.
No dependencies, UI, tracker files, or unrelated source changes were added.

### Fix-round validation

| Exact command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS: built all three workspace prerequisites before the app checks. Initial direct checks had failed because this fresh checkout had no prerequisite `dist/`; rebuilding resolved those failures. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: lint, production build, strict tsc, 9 files / 119 tests. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS: every model file meets 100% statements, branches, functions, and lines; totals 542 statements, 349 branches, 161 functions, 461 lines. No coverage exclusions. |
| `pnpm run lint:root` | PASS: all guards and 74 contrast pairs. |
| `TURBO_SCM_BASE=abb429dbd34e45c99342d66446ffb41ca1b4a8db pnpm run gate` | PASS: 9 / 9 tasks after the documentation update (3 cached); earlier source-only run also passed 8 / 8. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full` | INTERRUPTED: Turbo strict environment filtering removed the Git restriction; the unrelated unstorage-solid dependency bootstrap invoked a clone into `/tmp`. Stopped the run. No downloaded history was merged into the lane branch. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | FAILED in untouched `@jeswr/federation-trust#test`: `test/characterization.test.ts:196` snapshot expects `delegateKey` JSON order `crv,x,kty`, runtime emits `kty,crv,x`. 185 / 246 tasks completed successfully; full-workspace validation remains incomplete. |
| `git diff --check` | PASS. |
| `command -v roborev` | Unavailable; no automated per-commit verdict could be collected. The supplied review findings are all addressed. |

The full-gate retry uses `--env-mode=loose` so the Git transport restriction reaches child
processes. Dependency bootstrap output from the interrupted attempt is untracked build state;
no manifest or lockfile changed. The 16 public fixture files generated by the full gate were
removed before closing the lane. No screenshots or browser checks apply to these pure model fixes.

All four requested fixes are complete. Open questions: none. The full-workspace snapshot failure
and unavailable roborev are the remaining validation limitations; no unrelated fix was attempted.

## Fix round 2 — review of `25a9001cfeb4`

Implemented exactly the two supplied findings on `lane/sst-sf1j`.

- `060f7d70` — `fix(photos): recover restore cleanup with persisted receipts`: persist a unique
  restore activity as `prov:wasGeneratedBy` in the ETag-conditional trash claim and atomically
  with the create-only live description. On a 412, only a matching persisted receipt permits
  conditional trash cleanup. Retries preserve the live resource and recover after failed cleanup
  or a lost creation response. Regression tests cover 503/412 cleanup failures, a fresh adapter,
  a lost creation response, failed receipt reads, retrashing the same identifier, and identical
  live photos with missing or unrelated receipts. Existing restore/purge race tests still pass.
- `bd809fd2` — `fix(photos): canonicalize upload storage URLs`: normalize the validated storage
  base with `URL.href` before minting item URLs, binary URLs, thumbnail URLs, and RDF subjects.
  Tests cover explicit default ports and uppercase hostnames, including nested storage roots
  and upload → canonical listing → load → trash → purge.
- Final documentation commit — `docs(photos): record second review fixes and validation`:
  this report and the model integration notes.

Conservative collision policy: an existing live description without this restore's receipt
remains a collision, even when its supported photo fields are identical. Legacy trash records
remain readable and can restore create-only; historical completed restores without receipts
cannot be inferred safely. No dependencies, UI, tracker files, or unrelated source changes added.
No pushes, PRs, branch switches, remote fetches, or merges occurred.

### Fix-round-2 validation

| Exact command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS: all three workspace prerequisites. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/photos/trash.test.ts test/photos/io.test.ts` | Before fixes: reproduced both findings (3 failed, 18 passed). After fixes: PASS (21 tests), before adding further receipt/canonicalization cases. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: lint, production build, strict tsc, 9 files / 128 tests. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS: every model file meets 100% statements, branches, functions, and lines; totals 557 statements, 361 branches, 163 functions, 474 lines. No exclusions. |
| `pnpm run lint:root` | PASS: all guards and 74 contrast pairs. |
| `TURBO_SCM_BASE=25a9001cfeb4bcf53501005292d1860b25dacfaf pnpm run gate` | PASS: 8 / 8 tasks (3 cached) before this report update. An initial overlapping invocation hit Next.js's build lock; rerunning after the standalone app gate completed resolved it. Final run after this report update also passed. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | BLOCKED in untouched `@jeswr/unstorage-solid#build`: its dependency bootstrap attempted a remote clone and Git rejected HTTPS transport before any network fetch. 19 / 151 tasks completed. Full-workspace validation remains incomplete under the lane's remote-fetch restriction. |
| `git diff --check` | PASS. |
| `command -v roborev` | Unavailable; no automated per-commit verdict could be collected. |

Both supplied findings are addressed. No implementation work remains; open questions: none.
Full-workspace validation and automated roborev review have the limitations above. No screenshots
or browser checks apply to these pure model fixes.

<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 3 — review of `84aba11610fd`

Implemented exactly the two supplied recovery findings on `lane/sst-sf1j`.

- `5fc96227` — `fix(photos): fence restored metadata across trash cycles`: assign each trash
  cycle a fresh receipt and conditionally replace the live description with a durable tombstone.
  Restore replaces only its matching tombstone using its ETag; purge retains the tombstone after
  removing binaries and the trash record. Deterministic regressions pause an overlapping restore
  before its create attempt and before its conditional replacement, then let a separate adapter
  restore, retrash, and purge. Both stale writes fail without recreating a photo. Tests also cover
  missing tombstone ETags, unrelated lifecycle receipts, and failed tombstone writes.
- `70680558` — `fix(photos): preserve restore receipts through edits`: conditional `savePhoto`
  reads the matching revision and carries its receipt into the replacement dataset. A regression
  edits a photo after failed restore cleanup, then completes recovery with a fresh adapter while
  retaining the edits and the exact live revision; retrashing and purging also succeed.
- Final documentation commit — `docs(photos): record third review fixes and validation`:
  update model integration notes, then this report last.

Conservative lifecycle choice: retain a receipt-only item tombstone permanently after purge.
`loadPhoto` returns no photo for it; create-only uploads cannot reuse its item URL. This keeps the
live URL occupied and its generation durable across clients, including paused operations. Legacy
trash records with absent original descriptions remain restorable using create-only preconditions.
Ordinary edits retain completion evidence without adding it to the editable `Photo` fields.
No dependencies, UI, tracker files, or unrelated source changes were added. Commits use the actual
GPT-6 author provenance, requested git identity, and disabled signing. No pushes, PRs, branch
switches, remote fetches, or merges occurred.

### Fix-round-3 validation

| Exact command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS: all three workspace prerequisites. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/photos/trash.test.ts -t 'paused restore\|ordinary photo edits'` | Before fixes: both regressions failed, reproducing both findings. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/photos/trash.test.ts test/photos/io.test.ts` | After fixes: PASS, 29 tests. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: lint, production build, strict tsc, 9 files / 132 tests. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS: every model file meets 100% statements, branches, functions, and lines; totals 572 statements, 372 branches, 163 functions, 488 lines. No coverage exclusions. |
| `pnpm run lint:root` | PASS: all guards and 74 contrast pairs. |
| `TURBO_SCM_BASE=25a9001cfeb4bcf53501005292d1860b25dacfaf pnpm run gate` | PASS: 9 / 9 tasks, including root tests, after updating the integration notes and before this final report. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | BLOCKED in untouched `@jeswr/unstorage-solid#build`: its dependency bootstrap attempted a remote clone and Git rejected HTTPS transport before any network fetch. 26 / 81 scheduled tasks completed. Full-workspace validation remains incomplete under the lane's remote-fetch restriction. |
| `git diff --check` | PASS. |
| `command -v roborev` | Unavailable; no automated per-commit verdict could be collected. |

Both supplied findings are addressed. No implementation work remains; open questions: none.
Full-workspace validation and automated roborev review have the limitations above. No screenshots
or browser checks apply to these pure model fixes.

<!-- AUTHORED-BY Codex GPT-6 -->
## Fix round 4 — review of `e627122f089a`

Implemented the single supplied tombstone-subject finding on `lane/sst-sf1j`.

- `d3cf5ed5` — `fix(photos): sanitize tombstone subjects`: construct the receipt subject from
  `documentUrl(originalUrl)` before appending `#it`, matching photo and trash-record identity.
  Four regression cases use filenames containing spaces, angle brackets, quotes, and an embedded
  newline. They parse the serialized tombstone, verify its escaped subject and matching receipt,
  and restore the original photo using a fresh storage adapter.
- Final documentation commit — `docs(photos): record fourth review fix and validation`:
  this report, updated last.

### Fix-round-4 validation

| Exact command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS: all three workspace prerequisites. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/photos/trash.test.ts -t 'sanitizes the tombstone subject'` | Before the fix: all four final regression cases failed to parse the tombstone Turtle, reproducing the finding. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/photos/trash.test.ts` | After the fix: PASS, all 26 tests. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: lint, production build, strict tsc, 9 files / 136 tests. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS: every model file meets 100% statements, branches, functions, and lines; totals 572 statements, 372 branches, 163 functions, 488 lines. |
| `pnpm run lint:root` | PASS: all guards and 74 contrast pairs. |
| `TURBO_SCM_BASE=25a9001cfeb4bcf53501005292d1860b25dacfaf pnpm run gate` | PASS: 9 / 9 tasks, including root tests, before the final report commit. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | BLOCKED in untouched `@jeswr/unstorage-solid#build`: its dependency bootstrap attempted a remote clone, and Git rejected HTTPS transport before any network fetch. 10 / 122 scheduled tasks completed. |
| `git diff --check` | PASS. |
| `command -v roborev` | Unavailable; no automated per-commit verdict could be collected. |

The supplied finding is addressed. No implementation work remains; open questions: none.
Full-workspace validation and automated roborev review have the limitations above. No dependencies,
UI, tracker files, or unrelated source changes were added. No screenshots apply to this model fix.
Commits use GPT-6 provenance, the requested identity, and disabled signing. No pushes, PRs, branch
switches, remote fetches, or merges occurred.
