<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-h2yt — CHT-L5 lane report

Branch: `lane/sst-h2yt`. Base: `2c99c9d2202c6b18c38c88ed1524fcb3d2efd460`.
Implementation and fix round 1 are complete. App checks and the affected gate pass.
The current full-workspace gate stops on unrelated root-test timeouts; all root
tests pass in isolation. Mandatory roborev review is unavailable in this environment.
The original implementation results follow; current validation is in the final section.

## Commits and scope

- `8c728893 feat(chat): parse bounded message search queries`: typed AST, parser,
  exported errors and limits, parser/validation tests, coverage glob, and conservative
  interpretation questions in `QUESTIONS.md`.
- `ecd88eae feat(chat): evaluate message search and highlight snippets`: plain-record
  evaluation, all filters, local Gregorian dates in a supplied IANA zone, Unicode
  prefix/phrase matching, deterministic ordering, surrogate-safe highlight snippets,
  runtime validation, public barrel and API documentation.
- Final documentation commit, `docs: record CHT-L5 lane results`: this report.

Three synthetic-fixture test files contain 121 search tests. The entire search
directory has 100% statements, branches, functions and lines, enforced per file by
the app coverage configuration. Tests include every specified error, each input
limit at its bound and bound + 1, the snippet bound and truncation, DST transitions,
fractional-hour offsets, skipped days, malformed snapshots/ASTs, Unicode expansion
offsets, and many repeated matches without argument-count overflow.

No dependency manifests or lockfiles changed. No UI, React/hooks, network or RDF
surface was added. No screenshots or Playwright specs were needed or run; no
browser was launched. No push, PR, branch switch, or network fetch/merge occurred.
The full gate generated callback/client-ID files in seven web apps; those exact
untracked generated files were removed afterward. No other package source changed.

## Environment and merge

Checks used Node 24 and pnpm 10.4.1 with this shell setup:

```sh
export PATH=/opt/node24/bin:$PATH
export npm_config_manage_package_manager_versions=false
```

The default Node 22 pnpm launcher initially attempted an unwritable global tools
directory; using the installed Node 24 launcher resolved that without installation
or repository configuration changes. Lifecycle scripts remained disabled.

Before the final checks, ran:

```sh
git -c commit.gpgsign=false -c user.name='Jesse Wright' -c user.email=63333554+jeswr@users.noreply.github.com merge origin/main
```

Result: `Already up to date.` The existing `origin/main` ref equals the base above;
origin is a local checkout. No fetch was necessary or performed.

## Commands and results

Dependency build preparation — PASS, 7 tasks:

```sh
pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4
```

Focused search checks — PASS, 121 tests; every covered file and coverage metric 100%:

```sh
pnpm --filter @jeswr/app-suite exec vitest run chat-search --coverage.include='src/apps/chat/lib/search/**/*.ts'
```

An earlier invocation using the literal filter `test/chat-search-*.test.ts` found no
tests; the corrected substring filter above ran all three files.

Required app checks — PASS, including 155 test files / 7,628 tests, with 100% app
coverage. App lint reported 54 warnings in unchanged files and no errors:

```sh
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
```

Required root lint — PASS:

```sh
pnpm run lint:root
```

Required affected gate — PASS, 13 tasks (7 cached), including 879 root tests and
7,628 app tests:

```sh
TURBO_SCM_BASE=2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 pnpm run gate
```

Full-workspace gate — FAIL outside lane scope, 284 successful / 351 total tasks:

```sh
pnpm run gate:full
```

`packages/suite-ui/test/navigation.test.tsx:159`, AppLauncher “supports checkboxes,
keyboard reorder, drag pin/reorder and enforces the six-app limit”, exceeded its
existing 5,000 ms timeout. All other 195 suite-ui tests passed. A separate run
passed all 196 tests without source or timeout changes:

```sh
pnpm --filter @jeswr/suite-ui run test
```

`pnpm run gate:full --concurrency=1` was rejected before running checks because
Turbo disallows a duplicate concurrency flag. Ran the script's exact task list
directly with serial scheduling instead:

```sh
pnpm exec turbo run lint lint:root build typecheck test test:root --concurrency=1
```

Result: FAIL outside lane scope, 312 successful / 363 total tasks (164 cached).
Suite-ui passed all 196 tests in this run. The blocking failure is
`packages/federation-trust/test/characterization.test.ts:196`, “delegation
credential structure is stable”: the expected serialized public JWK has property
order `crv,x,kty`; the actual order is `kty,crv,x`. Confirmed independently under
Node 24: 53 pass / 1 snapshot failure, with the same mismatch:

```sh
pnpm --filter @jeswr/federation-trust run test
```

`git diff` against the base is empty for both `packages/suite-ui` and
`packages/federation-trust`. These failures were recorded without modifying
unrelated packages, snapshots, timeouts, or gate configuration.

`pnpm run check:packages` — not applicable; no dependencies added.

`roborev status` — unavailable, exit 127 (`roborev: command not found`); no hook
or review tool was installed. Review remains for the integration dispatcher.
The bead was not closed from this implementation worktree.

Logs and coverage evidence are in `/tmp/sst-h2yt-search-tests.log`,
`/tmp/sst-h2yt-app-coverage-summary.json`, `/tmp/sst-h2yt-root-lint.log`,
`/tmp/sst-h2yt-gate.log`, `/tmp/sst-h2yt-gate-full.log`,
`/tmp/sst-h2yt-gate-full-serial.log`, `/tmp/sst-h2yt-suite-ui-test.log`, and
`/tmp/sst-h2yt-federation-trust-test.log`.

## Nonblocking interpretation questions

See `QUESTIONS.md` for options and spec references. Conservative choices implemented:
all positive terms are required; exclusive date filters exclude the named local
date; timestamps are integer Unix milliseconds; room IDs/WebIDs match exactly;
mentions/links are derived from plain text; thread means a non-null reply target;
phrases are contiguous whole phrases; 160 UTF-16 units includes snippet ellipses.
Scores count positive query terms and therefore tie within one conjunctive query.

No search implementation work is unfinished. A green full-workspace gate and
automated commit review remain blocked by the external conditions above.

## Fix round 1 — mention detection (2026-10-27)

Fix-round base: `9a0632bb55603770dda77c7d0b38c2bf89d321b7`.
Addressed exactly the two supplied review findings:

- `11b39211 fix(chat): scan mention spans in linear time`: consume email and URL
  spans rather than retaining context until whitespace. Cache the next label
  delimiter and destination across failed nested candidates so suffixes are not
  repeatedly scanned. Separate boundary-delimited mentions after email/URL spans
  now work for both positive and negated filters.
- Final documentation commit, `docs: record mention fix validation`: this update.

Added 25 regression cases, bringing search coverage to 146 tests. Cases cover
adjacent email/URL and mention spans, explicit mentions, negation, malformed and
nested labels, repeated invalid destinations, and long ordinary word runs. The
timing regression exercises 50,000 failed label candidates and a 500,000-character
word run with a five-second budget; it took 670 ms in the affected gate. The old
regex alone took 5,860 ms for one 100,000-character malformed-label input.
The entire search directory retains 100% statements, branches, functions and lines.

Conservative parsing choice: retain URI punctuation within URL spans; whitespace,
angle brackets and quotes end those spans. Existing explicit mention syntax is
retained, including backticks in otherwise valid destinations. No message-length
limit, dependency, API, UI or unrelated implementation change was added.

Commands used the same Node 24 / pnpm environment documented above:

```sh
pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4
pnpm --filter @jeswr/app-suite exec vitest run chat-search --coverage.include='src/apps/chat/lib/search/**/*.ts' --coverage.reportsDirectory=/tmp/sst-h2yt-fix-search-coverage
pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
pnpm run lint:root
TURBO_SCM_BASE=9a0632bb55603770dda77c7d0b38c2bf89d321b7 pnpm run gate
pnpm run gate:full
pnpm run test:root
```

Results:

- Dependency builds: PASS, seven tasks.
- Focused search tests: PASS, 146 tests and 100% coverage of every metric.
- App lint/build/typecheck/test: PASS, 155 files / 7,653 tests and 100% app coverage.
  App lint reports the same 54 warnings in unchanged files.
- Root lint: PASS.
- Affected gate: PASS, 12 tasks (seven cached), including all 7,653 app tests.
- Full-workspace gate: FAIL, 58 successful / 224 total tasks before cancellation.
  Two unchanged `test/agent-layers.test.mjs:509` cases, “rejects disallowed path
  characters globally” for `require(TARGET);` and `(require as Loader)(TARGET);`,
  exceeded their existing 5,000 ms timeout. The root suite reported 877 pass / two
  timeouts. No root test, checker or timeout setting changed in this lane.
- Isolated root tests after that failure: PASS, all 879 tests / 12 files.
- `roborev status`: unavailable, exit 127 (`roborev: command not found`).

No generated untracked files remained after the gates. No dependency checks or
screenshots were needed. No push, PR, branch switch, fetch or merge occurred.
Both review findings are fixed; no implementation work or new interpretation
questions remain. A green full-workspace gate and automated commit review remain
outstanding for the reasons above.

Evidence: `/tmp/sst-h2yt-fix-regression-before.log`,
`/tmp/sst-h2yt-fix-search-tests.log`, `/tmp/sst-h2yt-fix-search-coverage/`,
`/tmp/sst-h2yt-fix-dependency-build.log`, `/tmp/sst-h2yt-fix-package-gate.log`,
`/tmp/sst-h2yt-fix-root-lint.log`, `/tmp/sst-h2yt-fix-gate.log`,
`/tmp/sst-h2yt-fix-gate-full.log`, and `/tmp/sst-h2yt-fix-root-tests.log`.
