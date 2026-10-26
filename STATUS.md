<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# DS-08 / sst-ytg lane status

Branch: `lane/sst-ytg`. Base: `3696bed75683e5c7aa253ba8a7cc163f5b8a1e07`.

Implemented DateTimeField (chrono-node, account locale, live interpretation),
DatePickerPopover (Radix, shadcn-style React DayPicker Calendar, time and all-day),
and RecurrenceEditor (daily/weekly/monthly day or nth weekday/yearly, exclusive
never/count/until endings). Pure date parsing and strict RFC 5545 subset codecs
are available through `@jeswr/suite-ui/date-time/model`; UI through `/date-time`.
All-day dates stay date strings under vocabulary V4. No RDF writes or new vocabulary.
The existing Tasks quick-add object remains structurally compatible.

## Commits

- `fcef9b4b` — `docs: record DS-08 contract gaps`: conservative resolutions in QUESTIONS.md.
- `29e1a463` — `feat(suite-ui): add date and recurrence inputs`: components, model codecs,
  token-backed styles, package exports, dependency declarations/lockfile, README, unit and axe tests.
- `66593e81` — `test(suite): add DS-08 fixtures and browser coverage`: one dev route per
  component and index links; browser scenarios for screenshots, axe, keyboard, touch and reflow.
- Final `docs: record DS-08 lane validation` commit contains this report.

## Dependency policy and installation

Before manifest edits, ran:

```sh
pnpm run check:packages chrono-node @radix-ui/react-popover react-day-picker lucide-react react react-dom @types/react @types/react-dom @testing-library/react jsdom axe-core
```

PASS: all 11 names cleared, full npm policy mode. Individual results:

| Dependency | Result |
| --- | --- |
| chrono-node | ok |
| @radix-ui/react-popover | ok |
| react-day-picker | ok |
| lucide-react | ok |
| react | ok |
| react-dom | ok |
| @types/react | ok |
| @types/react-dom | ok |
| @testing-library/react | ok |
| jsdom | ok |
| axe-core | ok |

Used existing lockfile versions except React DayPicker, which was absent (9.14.0).
Installed with `npm_config_cache=/tmp/sst-ytg-npm pnpm install --ignore-scripts`:
PASS. Lifecycle scripts stayed disabled; only suite-ui importer and new DayPicker
transitives changed in the lockfile. Existing workspace peer/bin warnings remain.

## Local verification

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/suite-ui run typecheck && pnpm --filter @jeswr/suite-ui run test` | PASS; 3 test files, 91 tests |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; production build and typecheck; 109 test files, 5,825 tests; coverage thresholds passed |
| `pnpm run lint:root` | PASS; workspace/layer/transport/token guards and 74 contrast pairs, zero failures |
| `PATH="$PWD/node_modules/.bin:$PATH" TURBO_SCM_BASE=3696bed75683e5c7aa253ba8a7cc163f5b8a1e07 pnpm run gate` | PASS; 14 successful tasks, 14 total |
| `PATH="$PWD/node_modules/.bin:$PATH" pnpm run gate:full` | FAIL outside lane scope; 284 successful tasks, 346 total, failed task `@jeswr/federation-trust#test` |
| `pnpm --filter @jeswr/app-suite exec playwright test --list` | PASS; 84 total cases, including 60 DS-08 cases (10 scenarios × 6 projects); no browser launched |
| `git diff --check` | PASS |

Suite-ui includes 20 phrase fixtures in each of en-GB/en-US (40 cases), validation
cases, RRULE object/string round-trips with exact ordinal-weekday serialization,
and jsdom/Testing Library interaction tests. Axe reports zero violations in the
component states tested; jsdom's unsupported layout/canvas contrast check is disabled.
Real contrast, focus, target geometry and reflow are asserted in dispatcher Playwright.

An initial app build failed because dependency dist output was absent; an initial
recursive dependency build could not find root `tsc` in the dependency-free suite-vocab
package. Both were resolved without source changes by running:

```sh
PATH="$PWD/node_modules/.bin:$PATH" pnpm --filter '@jeswr/app-suite^...' run build
```

The subsequent standalone app build/typecheck/lint and all 5,825 app tests passed
(109 files; existing per-file coverage thresholds passed).

Full-gate failure: `packages/federation-trust/test/characterization.test.ts:196`,
"delegation credential structure is stable" inline snapshot. The serialized public
JWK has identical fields but key order `kty,crv,x` rather than `crv,x,kty`. That
package and its existing lockfile resolutions are unchanged by this lane. Its other
53 tests passed. No unrelated snapshot or package changes were made. Full-gate-generated
untracked callback/client-ID files in the eight pod web apps were removed.

## Browser handoff and remaining validation

No screenshots taken locally and no Chromium launch attempted, as explicitly required.
Reference mockup HTML/CSS was inspected; reference browser comparisons are deferred.
`apps/suite/e2e/ds-08-date-time.spec.ts` writes full-page PNGs to the git-excluded
repo-root `artifacts/screens/DS-08/<name>-<project>.png` at 375/768/1280 × light/dark.
It covers every fixture state, open empty/all-day/timed calendars, live and invalid
natural input, recurrence validation states, keyboard focus restoration, touch targets,
320px reflow and zero serious/critical axe violations. Dispatcher command:

```sh
SUITE_E2E_PORT=<port> pnpm --filter @jeswr/app-suite test:e2e
```

Controls are synchronous; no storage loading, empty-filter, or typed network-error
surface is introduced. Fixtures show empty first-use, valid, invalid and disabled states.
Existing layout guards protect all three dev routes in production unless
`NEXT_PUBLIC_DEV_FIXTURES=1`.

Roborev is not installed (`command -v roborev` found no executable); no automated
per-commit verdicts could be read. The repository's roborev and test-infrastructure
skills were read. No installer, review service, push, PR, branch switch, or remote
fetch/merge was run.

Open questions and conservative choices are in QUESTIONS.md: missing DS-02 primitives
were supplied minimally; monthly nth-weekday uses optional domain `bySetPos` (ordinal
BYDAY in RRULE) pending a persistence mapping; account locale is supplied by the caller,
English parser acceptance covers en-GB/en-US and wall-time editing uses the host timezone.
Broader account timezone conversion and RDF persistence remain caller/data-layer work.
The dispatcher still needs to run and inspect browser screenshots, keyboard and axe results.
