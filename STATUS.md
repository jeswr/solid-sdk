<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-bf09 — CAL-L1

Implemented the pure TypeScript VEVENT boundary in `apps/suite/src/apps/calendar/lib/ics/`, with an index barrel and API documentation. No React, hooks, fetch, RDF, dependencies, or UI changes.

Commits:

- `1775885c` — `feat: add pure calendar ICS parse and serialize`: DATE and DATE-TIME start/end, UTC/floating/TZID preservation, structured RRULE selectors, EXDATE/RDATE, DISPLAY/AUDIO/EMAIL VALARM, UTF-8 folding, text escaping, opaque VTIMEZONE preservation, and documented scope/model assumptions in `QUESTIONS.md`.
- `e7647d32` — `test: verify ICS fixtures and enforce full coverage`: 20 synthetic wire fixtures with independent expected objects, malformed-input and boundary tests, strict parameter/DATE recurrence validation, and directory coverage thresholds enforced by normal app tests.
- Final documentation commit — `docs: record CAL-L1 lane verification` (this file).

Verification on the final implementation:

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; built the existing workspace prerequisite. The initial app typecheck lacked this generated dist; it passes after this build. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; production Next.js build, lint, strict TypeScript, 177 tests in 2 files. |
| `pnpm --filter @jeswr/app-suite exec vitest run --coverage` | PASS; coverage also runs in the normal test command. Final coverage: statements 307/307, branches 239/239, functions 44/44, lines 274/274 — all 100%. All seven TypeScript files in the ICS directory are included (types/barrel have no executable statements). |
| `pnpm run lint:root` | PASS; workspace/lockfile/fetch/token checks, 74 contrast pairs with zero failures. |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | PASS; 7/7 Turbo tasks successful (1 cached), including directory coverage thresholds. An earlier overlapping invocation hit Next.js's build lock; it was rerun sequentially after the app build finished. |
| `pnpm run gate:full` | FAIL outside lane scope: `@jeswr/unstorage-solid#build` invokes the existing fetch-rdf dependency bootstrap, whose npm install fails with EROFS writing `/home/runner/.npm/_cacache/tmp/`. The full workspace cannot be declared green. No unrelated source changes or bootstrap retries. |
| `git diff --check` | PASS. |

No `check:packages` commands were needed: no dependencies or manifests/lockfile changed. Coverage uses the already installed Vitest V8 provider.

Screenshots: none; pure library task with no rendered components. Playwright was not launched.

Review: repository `roborev-review` skill read; `roborev` is not installed/on PATH, so per-commit automated review could not be run. Dispatcher review remains outstanding.

Scope/assumptions: CAL-00 is absent in this base, so compatibility follows the specified event/recurrence/reminder field names through exported structural types, without importing a future model. DATE values stay dates and TZID values stay wall clocks. `QUESTIONS.md` records the options and conservative choices. Callers supply timezone definitions when required; conversion/definition generation and recurrence expansion are outside CAL-L1. Event DURATION/overrides, RDATE PERIOD, binary alarm attachments, and extension RRULEs are explicitly rejected rather than silently losing their semantics. No implementation work remains within this documented subset; direct integration against CAL-00 awaits that model.

## Fix round 1 — review of `8a7d87da3ddc`

- `5c2dae06` — `fix: correct calendar ICS interoperability`: addresses all four findings. Parameter lists retain quoted comma/semicolon/colon boundaries through opaque-component serialization; supported singleton parameters reject lists. Floating DTSTART/DTEND forms must match before cross-zone comparison is exempted. EMAIL alarms import/export an `attachments` collection while retaining the legacy singular `attachment` export and AUDIO's single-attachment limit. Alarm REPEAT accepts nonnegative safe integers independently of positive recurrence counts. Regression tests cover valid imports/exports and malformed counterparts.
- Final documentation commit — `docs: record ICS fix verification`: this verification record.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; existing workspace prerequisite built. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS after correcting an optional-property TypeScript error caught by the initial build. Final run: 211 tests in 2 files; ICS coverage 100% statements (324/324), branches (261/261), functions (48/48), lines (286/286). |
| `pnpm run lint:root` | PASS; all root checks, including 74 contrast pairs with zero failures. |
| `TURBO_SCM_BASE=8a7d87da3ddc9e74d1097f570b336697fc528a8f pnpm run gate` | PASS; 6/6 Turbo tasks successful. |
| `pnpm run gate:full` | FAIL outside the changed app: existing `@jeswr/unstorage-solid#build` dependency bootstrap runs npm install and receives EROFS writing `/home/runner/.npm/_cacache/tmp/`. Same environment blocker recorded above; no unrelated changes made. |
| `git diff --check` | PASS. |

No dependencies added, so no `check:packages` commands were needed. No UI changes or screenshots. `roborev` remains unavailable on PATH; dispatcher review is still required. All four requested fixes are implemented; no open questions. Conservative compatibility choice: retain the singular reminder attachment field for existing exporters while using the collection for imported EMAIL attachments.
