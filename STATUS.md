<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CAL-L4 lane report — sst-ajqa

Branch: `lane/sst-ajqa`. Base: `8865b4b3e01bdb91ab0f102683e0833f786c65cf`.

## Commits

- `55e3796f feat: add calendar IANA time conversion`: typed errors, strict Gregorian
  wall-clock/instant conversion through Intl, explicit overlap selection, gap rejection,
  secondary-zone offsets/day differences, tests, and coverage glob.
- `fd37bd96 feat: plan calendar recurring series edits`: pure plans for single/following/all
  edits, UTC UNTIL truncation, EXDATE handling, explicit replacement records, recurrence
  membership checks, tests, API documentation and QUESTIONS.md.
- Final `docs: record CAL-L4 validation` commit: this report.

## Validation

All commands ran in this checkout with lifecycle scripts still disabled.

| Command | Result |
| --- | --- |
| `pnpm exec biome check --write apps/suite/src/apps/calendar/lib/tz apps/suite/test/calendar-tz-*.test.ts` | Passed; formatted changed files. |
| `pnpm --filter @jeswr/suite-ui run build` | Passed; generated prerequisite declarations. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | Passed all four commands. Lint has 21 existing warnings in Money files. 29 test files / 1268 tests passed. |
| `pnpm run lint:root` | Passed, including layer/workspace guards, tokens and all 74 contrast pairs. |
| `git merge origin/main` | Already up to date. The existing local ref is the base commit; no network fetch or merge was performed. |
| `TURBO_SCM_BASE=8865b4b3e01bdb91ab0f102683e0833f786c65cf pnpm run gate` | Passed, 7/7 Turbo tasks. Root tests: 7 files / 686 tests passed. |
| `pnpm run gate:full` | Failed in unchanged `@jeswr/federation-codegen#test`: 2 namespace/generated-ontology drift assertions. 279 successful / 344 total Turbo tasks; exit 1. |
| `git diff --check` | Passed. |
| `roborev status` | Unavailable: command not found (exit 127); no automated review verdicts could be read. |

Every TypeScript file in `src/apps/calendar/lib/tz/` has 100% statements, branches,
functions and lines in the V8 coverage summary. The affected gate also reports the
directory at 100% across all four metrics. No coverage exclusions or threshold reductions.

An early standalone app typecheck failed before `suite-ui` had been built (missing local
workspace declarations). Building that dependency resolved it; the final build/typecheck
sequence and affected gate passed.

No third-party dependencies were added; `check:packages` was not needed. No manifest or
lockfile changes. No UI was built; screenshots, Playwright, fixture routes and axe checks
are not applicable. Chromium was not launched.

## Scope, open questions and limitations

Implementation is complete for the conservative subset documented in QUESTIONS.md and the
library README. Questions left for integration: required historical date/precision support,
full RRULE grammar, and policy for migrating exceptions when schedules change.

- Whole-second dates/instants in 2000–2099; named Intl zones, modern minute offsets ±14h.
- DAILY/WEEKLY RRULEs with INTERVAL and COUNT or UTC UNTIL. Unsupported clauses/frequencies,
  malformed inputs, gaps and ambiguous inputs without an explicit choice fail with typed errors.
- Complete replacement timing is caller supplied; the planner does not guess new COUNTs or
  silently copy/shift exceptions. COUNT membership crossing an intervening DST gap is rejected.
- No persistence, UI, hooks, React, fetch, RDF changes or new dependencies.

The full-workspace gate remains blocked by existing federation-codegen test drift:
`test/generator.test.ts:81` expects the former `w3id.org/jeswr` bookmarks namespace while
input vocabulary uses `jeswr.org/ns`; the committed generated `ontology.ttl` also differs
from fresh generation for the same namespace migration. `git diff` against the lane base
shows no changes under `tools/federation-codegen` or `packages/solid-federation-vocab`.
These unrelated files were left unchanged. The full build's untracked generated
`apps/pod-*/web/public/{callback.html,clientid.jsonld}` files were removed afterward.

Automated roborev review remains unavailable in this environment. No pushes, PRs, branch
switches, network Git operations, or writes to other checkouts were performed.
