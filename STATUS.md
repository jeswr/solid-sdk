<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-cye3 — TSK-L2 lane report

Implemented on `lane/sst-cye3`, based on
`8c73e21f266896914a67b6434814b8bb567e1ba7`.

## Commits

- `2bde22b5` — `feat(tasks): add smart lists and recurring completion`:
  pure TypeScript library and barrel in `apps/suite/src/apps/tasks/lib/lists/`,
  API documentation, synthetic unit fixtures, enforced coverage glob, and
  conservative spec readings in `QUESTIONS.md`.
- `3eb4bcfc` — `fix(tasks): type completed history fields accurately`:
  remove replaced fields before constructing the closed occurrence so generic
  metadata survives without incorrectly retaining narrowed original field types.
- `docs(tasks): record sst-cye3 lane results` — this final report commit.

## Delivered behavior

Today (including overdue), Upcoming seven local dates, Overdue, No date and
Completed filters use an injected clock and IANA time zone. Comparators cover
local due dates/times, P1–P4 and SH-L1 manual keys, with stable ties.

Daily, weekly/byDay, monthly/byMonthDay and yearly recurrence support positive
intervals, due/completion anchoring, count and inclusive until. Completion plans
advance the open original and create a closed history occurrence, or close an
ordinary/exhausted original. One-level subtask progress leaves parent and child
states independent. Inputs outside the documented subset fail with typed errors,
including DST gaps/folds, unsupported recurrence fields and invalid hierarchies.

The library performs no React, hooks, fetching, RDF or persistence work.
Persistence adapters own conditional writes, identity allocation, reminder shifts
and undo using their retained snapshot.

## Verification

All commands ran in this checkout, with lifecycle scripts disabled.

| Exact command | Final result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; generate prerequisite workspace declarations |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; 11 test files, 342 tests |
| `pnpm run lint:root` | PASS; includes workspace/layer/transport/fetch/token guards and 74 contrast pairs |
| `TURBO_SCM_BASE=8c73e21f266896914a67b6434814b8bb567e1ba7 pnpm run gate` | PASS; 7/7 tasks, root and affected app |
| `pnpm run gate:full` | FAIL outside lane scope; 36 successful of 175 scheduled tasks before `@jeswr/unstorage-solid#build` failed |
| `git diff --check` | PASS |

Vitest V8 reports **100% statements, branches, functions and lines** for the
lists directory; the existing per-file 100% thresholds apply to its coverage glob.
Initial validation found missing generated suite-ui declarations, uncovered
boundary branches and a generic completion-result type mismatch; all were fixed
and the final app chain above passed after the fixes.

No dependencies or manifests changed. `check:packages` results: not applicable
(no new third-party dependency). No lockfile change, publishing, push or PR.
No UI/components/routes were built; screenshots and browser/axe specs are not
applicable. Playwright was not launched, per the lane instructions.

## Limitations and open questions

- Full gate is blocked by an existing dependency build helper in
  `packages/unstorage-solid/scripts/build-deps.mjs`: npm reports `EROFS` opening
  `/home/runner/.npm/_cacache/tmp/…`, with npm logs also outside the writable
  sandbox. The mandatory gate invoked that helper's temporary pinned fetch-rdf
  clone/npm bootstrap. No bootstrap retry or unrelated source change was made.
- `command -v roborev` found no executable. Automated per-commit roborev verdicts
  could not be obtained here; review remains for the dispatcher.
- Conservative readings and their spec references are in `QUESTIONS.md`:
  Today boundaries, Monday-based recurrence weeks, skipping missing calendar dates,
  rejecting ambiguous/nonexistent wall times, a 1970–9999 supported date range,
  progress-only roll-up and lexical SH-L1 order keys. None blocks this implementation.

## Fix round 2 — 2026-10-26

Addressed exactly the two recurrence-exhaustion findings reviewed at
`8eca802b02b03b188c45c616cafcefb830f5778d` on the same lane branch:

- `1ca6ea97` — `fix(tasks): compare fold cutoffs by possible instants`:
  timed cutoffs exhaust a fold only when every possible instant is after until;
  otherwise the existing typed ambiguity error remains. Regression tests cover
  inclusive cutoffs, the London fold from the review, both library entry points,
  and input immutability.
- `f0837b32` — `fix(tasks): exhaust all-day rules before calendar overflow`:
  pass the all-day cutoff into calendar advancement before range checks. Tests
  cover final completion at year 9999 across daily, weekly/byDay, monthly and
  yearly rules, large intervals and an occurrence exactly at the cutoff.
- `docs(tasks): record recurrence fix verification` — this report update.

Both findings were reproduced with failing regression tests before their fixes.
Final app verification passes **360 tests in 11 files**, including 12 new cases.
Every file in the lists directory retains **100% statements, branches, functions
and lines** under the existing coverage gate.

| Exact command | Fix-round result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; prerequisite workspace declarations |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; production build, types and all 360 tests |
| `pnpm run lint:root` | PASS |
| `TURBO_SCM_BASE=8eca802b02b03b188c45c616cafcefb830f5778d pnpm run gate` | PASS; 6/6 tasks |
| `GIT_ALLOW_PROTOCOL= pnpm run gate:full` | CANCELED (130); Turbo's strict environment mode filtered the Git transport restriction |
| `GIT_ALLOW_PROTOCOL= pnpm run gate:full --env-mode=loose` | FAIL outside lane scope; 181/252 tasks successful before `@jeswr/federation-trust#test` failed |
| `git diff --check` | PASS |

No dependencies, manifests, lockfiles or UI changed. `check:packages` and browser
screenshots remain inapplicable. No push, PR, branch switch or remote update to
this checkout. The initial full gate unexpectedly cloned the pinned fetch-rdf
dependency into a temporary directory through unstorage-solid's build helper;
the intended `GIT_ALLOW_PROTOCOL` restriction was filtered by Turbo. Stopped that
run and retried with `--env-mode=loose` so child processes inherit the restriction.
The retry failed in untouched `packages/federation-trust/test/characterization.test.ts:196`:
the delegation credential snapshot expects serialized key order `crv,x,kty`, but
the runtime produces `kty,crv,x`. Its other 53 tests passed. No unrelated snapshot
or source changes were made. Root tests passed all 341 cases during the initial
full-gate run.
`command -v roborev` still finds no executable; automated per-commit review
remains for the dispatcher. Both requested fixes are complete, with no new open
questions.
