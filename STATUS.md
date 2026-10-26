<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-r12k — CAL-L6 invitation and RSVP model

Implemented on `lane/sst-r12k`, based on `809c3c12b59847444c2b83be757b4813c4865579`.

## Commits

- `e116fac1` — `feat(calendar): model invitation and RSVP plans`: pure attendee/role/status model,
  organizer-only membership edits, sender-bound RSVP application, REQUEST/REPLY/CANCEL plans,
  sequence and DTSTAMP ordering, terminal cancellation, typed validation errors, summary counts,
  barrel/API documentation, and conservative scope choices in `QUESTIONS.md`.
- `c4487b42` — `test(calendar): cover invitation rules and invalid inputs`: 76 synthetic invitation
  tests plus the invitation directory's coverage glob in the suite Vitest config.
- This final documentation commit records validation and remaining environment limitations.

## Validation

Commands ran inside this checkout. No dependencies were added, no dependency lifecycle scripts
were enabled, and no network fetch, push, PR, or branch switch occurred.

| Exact command | Result |
| --- | --- |
| `git merge origin/main` | Already up to date, including the run immediately before final gates. Local `origin/main` is `809c3c12b59847444c2b83be757b4813c4865579`; no fetch was needed or performed. |
| `pnpm --filter @jeswr/suite-ui run build` | Passed; prepared the existing workspace dependency. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/calendar-invites.test.ts --coverage.include='src/apps/calendar/lib/invites/**/*.ts'` | Passed: 76 tests; 100% statements, branches, functions, and lines. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | Passed in that order: 30 test files, 1,474 tests, 100% coverage across configured library paths. Lint has 21 existing money-library warnings, with no errors. |
| `pnpm run lint:root` | Passed, including SDK/app/agent layer guards, transport guards, token checks, and all 74 contrast pairs. |
| `TURBO_SCM_BASE=809c3c12b59847444c2b83be757b4813c4865579 pnpm run gate` — initial run | Failed: the existing root `test/agent-layers.test.mjs:509` case `rejects disallowed path characters globally: (require as Loader)(TARGET);` exceeded its five-second timeout; 744 other root tests passed. |
| `pnpm run gate:full` | Failed outside lane scope: `@jeswr/federation-trust` `test/characterization.test.ts:196`, `delegation credential structure is stable`, mismatches serialized JWK property order (`crv,x,kty` expected; `kty,crv,x` received). 293 tasks succeeded before Turbo stopped. All 745 root tests passed in this run. No files in federation-trust differ from the base. |
| `TURBO_SCM_BASE=809c3c12b59847444c2b83be757b4813c4865579 pnpm run gate` — final rerun | Passed: 7/7 tasks, 5 cached; scopes were the root and `@jeswr/app-suite`. All 745 root tests and all 1,474 app tests passed. The initial root timeout did not recur. |
| `git diff 809c3c12b59847444c2b83be757b4813c4865579 --check` | Passed. |

Coverage summary confirms both files under `src/apps/calendar/lib/invites/` are included. The
implementation covers 132/132 statements, 80/80 branches, 32/32 functions, and 116/116 lines;
the barrel has no executable statements. No coverage exclusions or ignore directives were added.

`check:packages`: not applicable (no new dependencies). Screenshots/Playwright/axe: not applicable
(pure TypeScript library; no UI or routes rendered). Full-gate builds generated untracked
`callback.html` and `clientid.jsonld` files in the eight pod apps' `web/public/` directories; only
those generated files were removed after verification. Build output remains uncommitted.

## Remaining limitations and questions

- No invitation implementation work remains. The full-workspace gate is blocked by the unrelated
  federation-trust snapshot mismatch above; this lane does not change its snapshots or implementation.
- Automated per-commit review could not run: `command -v roborev` found no executable. No reviewer
  was installed and no automated review verdict is claimed.
- `QUESTIONS.md` records the nonblocking conservative interpretations: whole-event/WebID-only
  metadata plans, DELEGATED as status without transferring an invitation, and explicit DTSTAMP
  ordering with retained RSVP status across organizer revisions. Unsupported fields fail closed.
- Authentication of the supplied actor, storage authorization/concurrency, event content,
  serialization, sharing and delivery belong to the consuming adapter, outside this pure-library lane.
