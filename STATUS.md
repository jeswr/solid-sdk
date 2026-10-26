<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-9oqi — CON-04 lane report

Branch: `lane/sst-9oqi`. Base: `f0b98ad33f2c98e076ce70c391ac4cb43f72b469`.

## Commits

- `2575044e` — `feat: share Google OAuth product configuration`: shared Google
  Calendar/Contacts/Drive/Gmail read scopes; browser proxy and injected Desktop
  configurations; optional installed-app value in direct token POSTs; redirect refusal;
  fixture-only PKCE and exchange tests; public `./adapters/google/oauth` export.
- `665857ca` — `feat: import Google Calendar incremental events`: primary-calendar
  pagination, final sync checkpoints, incremental replacements/deletions, one bounded
  410 full resync, retained ETag conditions and failed-run checkpoint preservation;
  structured VOC-01 recurrence and exceptions, dual event types, date-only all-day
  values, deterministic rule nodes, fixture tests and sorted Turtle mapping snapshot.
- Final `docs: record CON-04 lane results` commit contains this report.

## Validation

All connector tests use synthetic fixtures/stub transports and the memory Pod. No
Google accounts, production API calls or real credentials were used.

| Exact command | Result |
| --- | --- |
| `pnpm install --offline --ignore-scripts` | PASS. No dependencies changed; the export-only manifest change needs no lockfile update. Unrelated pnpm peer-snapshot churn was discarded, leaving the lockfile unchanged. |
| `pnpm --filter '@jeswr/pod-connectors^...' run build` | PASS. Built fetch-rdf and guarded-fetch before connector tests resolve their declarations/entry points. |
| `pnpm --filter @jeswr/pod-connectors run lint && pnpm --filter @jeswr/pod-connectors run build && pnpm --filter @jeswr/pod-connectors run typecheck && pnpm --filter @jeswr/pod-connectors run test` | PASS. 47 test files, 381 tests; lint has 36 existing warnings in other adapter tests. |
| `pnpm run lint:root` | PASS. All root guards and 74 contrast pairs passed. |
| `TURBO_SCM_BASE=f0b98ad33f2c98e076ce70c391ac4cb43f72b469 pnpm run gate` | PASS. 12/12 tasks, including Pod Manager build, typecheck and tests (930 passed, one existing skipped); root tests 745 passed. |
| `pnpm run gate:full` | FAIL (exit 1). 324/372 tasks successful before Turbo stopped on the unchanged federation-trust characterization snapshot. |
| `pnpm run gate:full --continue=always` | FAIL (exit 1). Completed 386 tasks: 384 successful; federation-trust snapshot and create-solid-demo packed-bin suite failed. The latter hit the sandbox read-only npm cache and passes with the offline cache workaround below. |
| `npm_config_cache=/tmp/sst-9oqi-npm-cache npm_config_offline=true npm_config_ignore_scripts=true pnpm --filter create-solid-demo exec vitest run test/packed-bin.test.ts` | PASS. All three packaging tests pass with a writable temporary cache, offline and lifecycle scripts disabled; no repository change needed. |
| `pnpm --filter @jeswr/federation-trust exec vitest run test/characterization.test.ts` | FAIL (exit 1), reproducing the unrelated snapshot mismatch in isolation: 19 passed, one failed. |
| `git diff f0b98ad33f2c98e076ce70c391ac4cb43f72b469 --check` | PASS. |

Built-package self-import smoke checks passed for
`@jeswr/pod-connectors/adapters/google/oauth` and
`@jeswr/pod-connectors/adapters/google-calendar` using injected synthetic configuration.
The mapping snapshot includes sector and schema types, structured recurrence, weekday
IRIs, numeric limits, exception dates, source time zone and date/dateTime datatypes.
Tests also cover sync/page token URL encoding, empty calendars, expired tokens midway
through pagination, failed resyncs (401/403/429/500/410), malformed items and checkpoints,
recurrence removal, retained moved/cancelled instances, idempotence and concurrent-write 412.

`check:packages`: not applicable; no third-party or workspace dependency was added.
Lifecycle scripts remained disabled. No generated `dist/` files are committed.

## Limitations and questions

Implementation scope is complete. The full-workspace gate is blocked by an unrelated
existing snapshot: `packages/federation-trust/test/characterization.test.ts:196` expects
embedded public-JWK JSON keys in `crv,x,kty` order, while this environment emits
`kty,crv,x`. The assertion, federation-trust, solid-vc and lockfile are unchanged from
the lane base; federation-trust does not depend on pod-connectors. No unrelated
snapshot or implementation changes were made. The full-gate continuation also found
a sandbox-only npm cache write failure in create-solid-demo; its isolated offline
rerun with a writable `/tmp` cache passed all three tests. All remaining workspace
tasks passed in the continuation run.

Build-generated untracked callback/client-id files were removed from the eight Vite
apps after validation; only this lane's intended changes are committed.

`QUESTIONS.md` records two conservative readings:
use the vocabulary's defined `sched:CalendarEvent` alongside `schema:Event`, and reject
recurrence constructs outside VOC-01 (including ordinal BYDAY, RDATE and EXRULE)
before writing or advancing state. Different-zone EXDATEs are also rejected rather
than approximated. These choices require no new ontology terms or dependencies.

`roborev status` failed with exit 127 (`roborev: command not found`); automated per-commit
verdicts could not be queued or read in this environment. Review remains outstanding
for the integration lead. No additional review-tool installation, pushing, PRs, publishing, branch
switches, remote fetches or edits to other checkouts were performed.
