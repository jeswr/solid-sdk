<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-qucd / CAL-00 lane report

## Fix round 1 — 2026-10-26

Based on `451f9918cfa318c46ad8c2e1139bfce638b9b117`, on the same `lane/sst-qucd` branch. All six supplied review findings are addressed; changes are limited to three calendar model files, their two existing test files, and this report.

- `1d427add` — `fix: preserve calendar dates across time changes`: preserve civil dates in agenda day/month keys, sorting and grid placement; apply recurrence COUNT after timezone validity checks but before exceptions/range filtering; resolve ambiguous wall times to the earlier matching instant. Regression cases cover Los Angeles/London/Auckland displays, DST gaps and partial ranges with exceptions, and overlaps in London/New York/Lord Howe.
- `bb76f71c` — `fix: preserve ICS recurrence semantics`: parse floating UNTIL in the DTSTART timezone context; collect components before importing so any RECURRENCE-ID component rejects the entire same-UID series; reject export of mixed DTSTART/UNTIL date kinds. Tests cover master/override ordering, unrelated and UID-less events, floating and named-zone cutoffs, UTC cutoffs, and matching/mismatched date kinds in UTC and London.
- The final documentation commit records this fix round's verification.

Conservative choices explicitly permitted by the review: reject an overridden series as a whole rather than implementing overrides, and reject mixed cutoff/start date kinds on export rather than guessing a conversion. The model can still represent those mixed kinds internally. No new questions or unfinished implementation work in this fix round.

All pnpm commands used `export PATH="$PWD/node_modules/.bin:$PATH"` for the root tool binaries, as in the initial implementation.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter '@jeswr/app-suite^...'` | PASS: all four workspace dependencies built. An initial coverage run before this preparation could not resolve the unbuilt `@jeswr/rdf-serialize` dist; rerunning after the build passed. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: Biome, production Next.js build, strict TypeScript, and all 83 tests across four files. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS: 83 tests; model statements 578/578, branches 382/382, functions 153/153, lines 497/497 — all 100%. |
| `pnpm run lint:root` | PASS: root lint and all transport/workspace/fetch/token/contrast guards. |
| `TURBO_SCM_BASE=451f9918cfa318c46ad8c2e1139bfce638b9b117 pnpm run gate` | PASS: 9/9 tasks successful, including app lint/build/typecheck/test. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | BLOCKED outside this lane: existing `@jeswr/unstorage-solid#build` invokes a remote `git clone` to build its missing fetch-rdf dependency. Git refused it with `fatal: transport 'https' not allowed`. Remote Git transport was disabled to honor the lane's network-remote restriction; loose Turbo environment mode passes that restriction into child commands. No remote clone/fetch/merge completed, and no unrelated source was changed. |
| `git diff 451f9918cfa318c46ad8c2e1139bfce638b9b117 --check` | PASS before this documentation commit. |
| `roborev status` | UNAVAILABLE (exit 127): `roborev: command not found`; automated per-commit review remains unavailable in this sandbox. |

No dependencies or manifests changed; no dependency policy checks or installs were needed. No UI or screenshots. No pushes, PRs, branch switches, or changes to other checkouts. The only verification limits are the full-workspace gate and unavailable roborev above.

## Initial implementation (historical)

Implemented on `lane/sst-qucd`, based on `606c87b7edf73e83f118f95295b0eeda7abb6d92`.

## Commits

- `329e46c3` — `feat: add pure calendar data model`: calendar/event typed RDF accessors, canonical/legacy vocabulary support, date-only all-day values, shared recurrence and reminder objects, validation, DST-aware rrule expansion, ported agenda/grid helpers, month listing selection, calendar ICS import/export, injected scoped fetch and conditional writes/deletion, idempotent registration into an explicitly supplied Type Index. Includes model API documentation and conservative spec readings in `QUESTIONS.md`.
- `694e0e4f` — `test: cover calendar model and ICS round trips`: 65 new calendar tests, 20 static ICS fixtures, and enforced 100% model thresholds when running coverage.
- This final documentation commit records the commands, results and limits below.

No UI, hooks, React imports, SDK façade imports, shell changes, new projects, pushes or PRs. Existing application/package inventory is unchanged.

## Verification

The sandbox's pnpm script PATH only included each package's local binaries; commands below ran with `export PATH="$PWD/node_modules/.bin:$PATH"` so packages that intentionally use root TypeScript/Biome resolve those tools.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS. Production Next.js build, strict TypeScript and Biome green; 4 test files / 66 tests pass (65 calendar tests plus the existing fixture-access test). |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS. `lib/model`: statements 551/551, branches 358/358, functions 145/145, lines 474/474 — all 100%. Covers all 20 ICS fixture round-trips, weekly/monthly rules over spring/autumn DST, named-zone and civil-date handling, exceptions, reminders, validation, legacy RDF, Type Index idempotency, scope/redirect rejection and conditional HTTP failures. |
| `pnpm run lint:root` | PASS. Root Biome and workspace/transport/fetch/token guards; 74 contrast pairs, zero failures. |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | PASS. 10/10 tasks successful, including the suite app. |
| `pnpm run gate:full` | FAIL outside this lane: `@jeswr/unstorage-solid#build` invokes its existing missing-dependency build helper, whose `npm install --no-audit --no-fund --ignore-scripts --prefer-offline` fails with EROFS writing `/home/runner/.npm/_cacache/tmp/…`. The helper also clones its pinned fetch-rdf source into a temporary directory before that failure; no second attempt was made because of this lane's network/checkout restrictions. No unrelated source was changed. |
| `git diff 606c87b7edf73e83f118f95295b0eeda7abb6d92 --check` | PASS before this documentation commit. |
| `roborev status` | UNAVAILABLE (exit 127): `roborev: command not found`; per-commit automated review could not run in this sandbox. |

Coverage output and builds are git-ignored. No Playwright invocation or screenshots: this lane renders no UI. No visual fixture routes were added.

## Dependency policy and installation

Before adding dependencies:

```sh
pnpm run check:packages @jeswr/fetch-rdf @rdfjs/wrapper @solid/object n3 @rdfjs/types @types/n3 rrule @vitest/coverage-v8
```

PASS: all eight packages cleared the full npm policy check. The RDF libraries, types and coverage tooling reuse versions already in the workspace lockfile; `rrule@2.8.1` is the explicitly required recurrence engine. Internal dependencies use `workspace:*` (`suite-vocab`, `rdf-serialize`, `guarded-fetch`).

The initial `pnpm install --ignore-scripts` failed because the shared pnpm cache is read-only. The final installation succeeded with:

```sh
CI=true pnpm install --ignore-scripts --frozen-lockfile --force --store-dir /tmp/sst-qucd-pnpm
```

The writable temporary cache reused files from the read-only cache. Lifecycle scripts stayed disabled throughout. The lockfile diff contains only the suite importer and rrule package/snapshot; existing unrelated GitHub pins are preserved.

## Unfinished work and open questions

The CAL-00 implementation and its acceptance checks are complete. The full-workspace gate and roborev review remain unverified for the environmental reasons above.

`QUESTIONS.md` records three conservative readings for CAL-01: keep one resource per event without inventing shard paths; inject timezone context instead of minting timezone RDF storage; register into a supplied index and leave profile discovery/bootstrap to the later SDK wiring. Those questions do not block this model layer. Unsupported ICS recurrence/override/alarm features are explicitly reported, and custom VTIMEZONE definitions warn; timezone contexts returned by imports must be retained by the later caller.
