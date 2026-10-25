<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-qucd / CAL-00 lane report

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
