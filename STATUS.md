<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-qucd / CAL-00 lane report

## Fix round 4 — 2026-10-26

Resumed on `lane/sst-qucd` at `bd1190f9b00ea37728c763d7120f78e37497a988`. Read the original brief, all earlier fix briefs, and the complete round-four review. The single supplied finding is addressed; changes are confined to ICS import, its regression tests/API documentation, and this report.

- `ff73817c` — `fix: reject recurring ICS gap starts`: detect when a local DTSTART resolves to a different wall time and skip the recurring event with an explicit warning. This takes the conservative rejection option expressly permitted by the review, because the model cannot retain the original wall-clock DTSTART alongside its resolved instant. Standalone explicit gap dates retain pre-transition-offset semantics.
- Seven new regression cases cover named and floating gap starts in London, New York and Lord Howe, retention of unrelated events and aligned timezone contexts, and valid recurring starts before/after a gap or expressed in UTC. Existing generated-gap, overlap, exception, and 20-fixture round-trip tests remain green.
- The final documentation commit records this round's validation in STATUS.md.

All pnpm commands used `export PATH="$PWD/node_modules/.bin:$PATH"`. Git network transport was disabled for builds/gates with `GIT_ALLOW_PROTOCOL=file`; Turbo used `--env-mode=loose` to pass that restriction to child tasks.

| Exact command | Result |
| --- | --- |
| `GIT_ALLOW_PROTOCOL=file pnpm exec turbo run build --filter '@jeswr/app-suite^...' --env-mode=loose` | PASS: four workspace build dependencies prepared. |
| `pnpm --filter @jeswr/app-suite run test -- test/calendar/ical.test.ts` | Expected RED before implementation: three new gap-start regressions failed; the remaining 115 tests passed. This script invocation ran all four test files. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS: 24 files checked. |
| `GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: production Next.js build, strict TypeScript, and 118 tests across four files. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS: 118 tests; model statements 607/607, branches 415/415, functions 153/153, lines 526/526 — all 100%. |
| `pnpm run lint:root` | PASS: root Biome and transport/workspace/fetch/token/contrast guards. |
| `GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=74e38dd9847413b18c41e6ed0b35525de62a0bc8 pnpm run gate --env-mode=loose` | PASS: 10/10 tasks successful, including app lint/build/typecheck/test. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | BLOCKED outside this lane: existing unstorage-solid build invokes a remote clone to prepare fetch-rdf. Git refused HTTPS transport before any remote clone/fetch/merge could complete. Turbo stopped with `@jeswr/unstorage-solid#build` failed, 19 tasks successful. This is the same full-workspace blocker documented in earlier rounds. |
| `git diff bd1190f9b00ea37728c763d7120f78e37497a988 --check` | PASS before this documentation commit. |
| `roborev status` | UNAVAILABLE (exit 127): `roborev: command not found`; automated per-commit review could not run. |

No dependencies, manifests, lockfiles, UI or screenshots changed. No dependency policy checks or installs were needed. No pushes, PRs, branch switches, completed remote Git operations, or changes to other checkouts. Remaining verification limits are the unrelated full-workspace gate blocker and unavailable roborev. No unfinished implementation changes or open questions.

## Fix round 3 — 2026-10-26

Resumed on `lane/sst-qucd` at `005732b4fee4fc5009bdac6ba42d324c0d20e9f2`. Read the original brief, all earlier fix briefs, and the complete round-three review. All five supplied findings are addressed; implementation changes are confined to the calendar model and its regression tests/API documentation.

- `6a129231` — `fix: skip cancelled ICS events`: skip cancelled standalone events and recurring series with an explicit warning; retain unrelated active events and aligned timezone contexts.
- `ad9702d4` — `fix: require persistent ICS identities`: require an explicit UID or source URL, using the complete URL as the fallback instead of a content hash. Tests cover same-title/time events with distinct locations, descriptions and recurrence, stable source identities, explicit UID precedence, re-export, and absence of input mutation.
- `1f87e99f` — `fix: load calendar subjects at final URLs`: use fetchRdf's final URL for parsing and returned items, retaining ETags and document-scope validation. Tests cover relative event/calendar subjects after redirects and normalized requests whose injected responses omit a URL.
- `282e95f4` — `fix: reject subsecond ICS event values`: reject subsecond starts, ends, recurrence cutoffs, exceptions and absolute reminders rather than silently truncating them. Generated DTSTAMP metadata explicitly uses second precision. A whole-second event still round-trips.
- `79901b90` — `fix: interpret explicit ICS gap dates`: resolve explicit gap times using the pre-transition offset, with London, New York and Lord Howe regressions plus floating dates, end dates and exceptions. Generated recurrence gap times remain skipped without consuming COUNT; existing overlap tests remain green. Also correct the identity test fixture's optional-URL typing found by the app typecheck.
- The final documentation commit records this round's validation in STATUS.md.

Conservative choices expressly permitted by the review: skip cancellations with warnings instead of extending the event model; require persistent identity instead of mutating events to retain generated random UIDs; reject unsupported subsecond modeled dates instead of choosing a lossy conversion. There are no new design questions or unfinished implementation changes.

All pnpm commands used `export PATH="$PWD/node_modules/.bin:$PATH"`. Git network transport was disabled for builds/gates with `GIT_ALLOW_PROTOCOL=file`; Turbo used `--env-mode=loose` to pass that restriction to child tasks.

| Exact command | Result |
| --- | --- |
| `GIT_ALLOW_PROTOCOL=file pnpm exec turbo run build --filter '@jeswr/app-suite^...' --env-mode=loose` | PASS: four workspace build dependencies prepared. The first targeted test attempt before preparation could not resolve unbuilt rdf-serialize output; it passed after preparation. |
| `pnpm --filter @jeswr/app-suite run lint` | PASS: 24 files checked. |
| `pnpm --filter @jeswr/app-suite run build` | PASS: production Next.js build. |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS after correcting the identity test fixture's explicit optional URL; initial strict typecheck caught that test-only issue. The final affected gate also passed the app typecheck. |
| `pnpm --filter @jeswr/app-suite run test` | PASS: 111 tests across four files, including all 20 ICS fixture round-trips. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS on the final source/tests: 111 tests; model statements 605/605, branches 407/407, functions 153/153, lines 524/524 — all 100%. |
| `pnpm run lint:root` | PASS: root Biome and transport/workspace/fetch/token/contrast guards. |
| `GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=74e38dd9847413b18c41e6ed0b35525de62a0bc8 pnpm run gate --env-mode=loose` | PASS: 10/10 tasks successful, including final app lint/build/typecheck/test. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | BLOCKED outside this lane: existing unstorage-solid build invokes a remote clone to prepare fetch-rdf. Git refused HTTPS transport before any remote clone/fetch/merge could complete. Turbo stopped with `@jeswr/unstorage-solid#build` failed, 23 tasks successful. This is the same full-workspace blocker documented in round two. |
| `git diff 005732b4fee4fc5009bdac6ba42d324c0d20e9f2 --check` | PASS before this documentation commit. |
| `roborev status` | UNAVAILABLE (exit 127): `roborev: command not found`; automated per-commit review could not run. |

No dependencies, manifests, lockfiles, UI or screenshots changed. No dependency policy checks or installs were needed. No pushes, PRs, branch switches, completed remote Git operations, or changes to other checkouts. Remaining verification limits are the unrelated full-workspace gate blocker and unavailable roborev; no open questions.

## Fix round 2 — 2026-10-26

Based on `74e38dd9847413b18c41e6ed0b35525de62a0bc8`, on `lane/sst-qucd`. All eight supplied review findings are addressed, with changes confined to the calendar model, its existing tests/documentation, and this report.

- `55531d97` — `fix: replace legacy calendar predicates`: write both schema:name and sched:summary; accept scheduling-only summaries; clear supported canonical/legacy scalar predicates and recurrence sets on replacement, including reminder triggers. Regression tests cover canonical and legacy scheduling input, clearing/replacing values, and removing old recurrence selectors.
- `ac2ce6d8` — `fix: preserve recurrence instants across rollback`: preserve the explicit DTSTART instant in repeated hours and compare inclusive instant UNTIL cutoffs after timezone conversion. Cases cover London cutoff boundaries and later-overlap starts in London, New York, and Lord Howe, including range filtering, exceptions, duration, count, and until.
- `ebd91ca6` — `fix: reject lossy ICS conversions`: reject unsupported named-zone timed exports, mixed DTSTART/EXDATE kinds, and nominal day/week alarm imports; export fixed day/week offsets in seconds. Update the model API documentation and ICS regressions while retaining all 20 fixture round-trips.
- `55d28166` — `fix: confine cutoff bounds to event expansion`: use the padded expansion range as the conservative candidate bound for instant UNTIL; preserve the raw rrule helper's UTC cutoff behavior with an explicit assertion.
- The final documentation commit records this round's validation.

Conservative options explicitly allowed by the review: reject named-zone timed exports instead of generating VTIMEZONE definitions (also prevents later-overlap local-time loss); reject mismatched exception date kinds instead of converting day-wide exclusions; reject imported nominal day/week alarms instead of adding timezone-aware reminder durations. All-day export remains timezone-independent; UTC timed export preserves explicit instants. Imports still return timezone context for expansion. The model retains fixed-duration offsets internally, including day/week spellings. No new design questions or unfinished implementation work.

All pnpm commands ran with `export PATH="$PWD/node_modules/.bin:$PATH"` so package scripts resolve root tools.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter '@jeswr/app-suite^...'` | PASS: workspace build dependencies prepared. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS: Biome, production Next.js build, strict TypeScript, and all 101 tests across four files. The final affected gate below reran the app checks after the last source adjustment. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS after the final source adjustment: 101 tests; model statements 595/595, branches 396/396, functions 154/154, lines 517/517 — all 100%. |
| `pnpm run lint:root` | PASS: root lint and all transport/workspace/fetch/token/contrast guards. |
| `TURBO_SCM_BASE=74e38dd9847413b18c41e6ed0b35525de62a0bc8 pnpm run gate` | PASS after the final source adjustment: 9/9 tasks successful, including app lint/build/typecheck/test. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | BLOCKED outside this lane: existing `@jeswr/unstorage-solid#build` attempted a remote clone for its missing fetch-rdf build dependency. Git refused it with `fatal: transport 'https' not allowed`. Remote Git transport was disabled to honor the lane restriction; loose Turbo environment mode passes it to child commands. No remote clone/fetch/merge completed and no unrelated source was changed. |
| `git diff 74e38dd9847413b18c41e6ed0b35525de62a0bc8 --check` | PASS before this documentation commit. |
| `roborev status` | UNAVAILABLE (exit 127): `roborev: command not found`; automated per-commit review could not run. |

No dependencies, manifests, lockfiles, UI, screenshots, or other checkouts changed. No dependency checks or installs were needed. No pushes, PRs, branch switches, or completed remote Git operations. Remaining verification limits are the full-workspace gate and unavailable roborev above; no new open questions.

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
