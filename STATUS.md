<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.13 lane report

Branch: `lane/sst-8xm.13`; base: `0d8842080a31b716b2d1350efed53b19eb8c6832`.

Commits:

- `cdac32aa` — `feat: broadcast revalidation lifecycle events`: URL-only start/terminal
  events for background, forced, notification, listing, and reconnect-sweep attempts;
  compatible `UpdatedEvent`, new `OfflineEvent`/`RevalidationEvent`, and 51 lifecycle tests.
- `e9b1ea00` — `feat: expose revalidation status and syncing`: tracked-resource pending,
  confirmation, update, and rollback transitions; parallel-attempt accounting; React
  `syncing`; README/SKILL documentation and regenerated public API report.
- `77920536` — `fix: preserve sweep error propagation`: retain the existing reconnect-sweep
  rejection after reporting its terminal failure; a regression test proves the original
  error is propagated and later URLs are not started.
- This final report commit — `docs: record revalidation lane verification`.

Security property changed: revalidation progress and settlement are now observable across
tabs without exposing cached response bytes, headers (including ETags), tokens, credentials,
or error details. Every started attempt emits exactly one terminal event. A failed attempt
cannot falsely mark a resource fresh or leave a previously settled resource pending. Status
events retain the existing tracked-URL boundary. Worker authentication, WebID cache scoping,
revocation purges, and the never-authoritative cache policy are preserved.

Proof: the 35-case lifecycle matrix covers five execution paths with 304, 200, 403, 404,
500, network error, and connectivity loss. It observes the start while fetch is unresolved
and asserts the complete message array is exactly two `{ url, event }` objects. Additional
tests cover no-store/private purges, storage failures, forced 304 retries, offline/no-validator
no-ops, and sweep failure reporting with preserved error propagation. Status tests prove
snapshot transitions, previous-state restoration, untracked/unknown-event rejection, parallel attempts, and forget
cleanup. React tests prove both worker events and manual `markPending` control `syncing`.
All tests use local fixtures/mocks. Before implementation, 35 lifecycle cases failed against
the original behavior; the offline/no-validator no-op case passed.

Verification uses Node `v24.22.1` via `PATH=/opt/node24/bin:$PATH` and pnpm `10.4.1`.
Final commands/results:

- `PATH=/opt/node24/bin:$PATH pnpm --filter solid-offline run lint` — passed; three
  existing warnings in notifications.ts, worker.ts, and client-config.test.ts.
- `PATH=/opt/node24/bin:$PATH pnpm --filter solid-offline run build` — passed.
- `PATH=/opt/node24/bin:$PATH pnpm --filter solid-offline run typecheck` — passed.
- `PATH=/opt/node24/bin:$PATH pnpm --filter solid-offline run test` — passed: 16 files,
  300 tests.
- `PATH=/opt/node24/bin:$PATH pnpm --filter solid-offline run api:report` — regenerated.
- `PATH=/opt/node24/bin:$PATH pnpm --filter solid-offline run api:check` — passed.
- `PATH=/opt/node24/bin:$PATH pnpm run lint:root` — passed.
- `PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=0d8842080a31b716b2d1350efed53b19eb8c6832 pnpm run gate`
  — final run failed: 12/15 Turbo tasks succeeded (7 cached). The unchanged dependent
  Coeliac app's Turbopack build failed while processing globals.css: creating a process
  required binding a port, denied with `Operation not permitted (os error 1)`.
  `solid-offline` passed all 300 tests within this run. The first affected-gate attempt
  instead stopped at root tests: 169 failures / 900 tests in five files, including empty
  child-process output and timeouts.
- `PATH=/opt/node24/bin:$PATH pnpm run gate:full` — final run failed: 103/285 Turbo
  tasks succeeded (82 cached). The unchanged MCP server's Node/Web adapter tests could not
  open a loopback listener (`listen EPERM: operation not permitted 127.0.0.1`), and one
  listener test timed out. Root guardrail output assertions also reproduced before the
  MCP task stopped the run. The first full-gate attempt stopped at root tests (173/900
  failed; 82/269 Turbo tasks succeeded). These runs do not establish a green full workspace.
- `git diff --check` — passed.

Supply chain: no dependencies or manifests changed; `check:packages` was not applicable.
Lifecycle scripts remain disabled; no install, fetch, push, PR, or publication was performed.
The existing manifest name is `solid-offline`, so package filters use that name rather
than the proposed `@jeswr/solid-offline` name.

Gate limitation: a standalone Node 24 `spawnSync` probe invoking the unmodified
`check-sdk-layers.mjs` against an empty temporary fixture returned
`error: "spawnSync /opt/node24/bin/node EPERM"` with empty stdout/stderr, reproducing the
sandbox restriction behind the guardrail output assertions. Root guardrail scripts and
root tests are unchanged by this lane. The Coeliac build also needs a local process/port
operation prohibited here; the MCP tests similarly require a loopback listener. No Coeliac
or MCP source was changed. Do not infer a green workspace gate from the green package gate; the lead must rerun the workspace gates outside this restricted sandbox.

Review limitation: `roborev status` exited 127 (`roborev: command not found`); this checkout
also has no active post-commit review hook. Automated per-commit adversarial review remains
for the lead/Jesse before merge. This security-critical change must not be auto-merged.

Implementation is complete. Outstanding verification is the workspace-gate rerun in an
appropriate environment and the required per-commit security review before Jesse merges.

Interpretations and options are recorded in [QUESTIONS.md](QUESTIONS.md). They preserve
the existing tracked-resource boundary and offline/no-op behavior, retain the optional
legacy ETag type field while omitting it from messages, and treat non-authoritative HTTP
answers (including unsolicited listing 304s) as failed confirmation. No unanswered question
blocks the implementation. Application UI wiring is out of scope.

## Fix round 1 — status races

This round starts at `7d5d23f99d24fe0404dd02b9d027352ab787d8d9` and supersedes the
original status-restoration and standalone-delete descriptions above.

Commits:

- `2596d246` — `fix: preserve status across overlapping revalidations`: fix all three
  review findings. Separate settled freshness from worker-attempt counts, retain unread
  updates through 304 confirmations until a consumer mark, preserve manual marks through
  failed attempts, and balance direct-delete purges with the existing lifecycle helper.
  README, SKILL, and the existing interpretation record describe these corrected semantics.
- The final report commit — `docs: record status race verification`.

Security property corrected: overlapping confirmations cannot hide an unread replacement
or purge, failed confirmation cannot discard a later manual stale observation, and a delete
cannot consume another fetch's pending count. The channel continues to carry only URL/event
objects. Direct deletion still performs no fetch; a failed purge now reports its own failure.
Public types and dependencies are unchanged.

Proof: ten new status cases cover both completion orders, sticky updates across later
confirmations, explicit read acknowledgment, all three manual mark methods during an attempt,
and a manual observation between parallel settlement events. Two new integrated worker/status
cases exercise direct deletion during a deferred fetch, including metadata purge failure;
they then start a second fetch and prove each fetch settles only its own pending work.
The existing delete test now asserts the exact balanced URL-only event pair. Before the
fix, the regression run failed 11 cases; after the fix, all 312 tests passed across 16 files.

Fix-round verification uses `PATH=/opt/node24/bin:$PATH` (Node `v24.22.1`, pnpm `10.4.1`):

- `pnpm --filter solid-offline run lint` — passed, with the same three existing warnings.
- `pnpm --filter solid-offline run build` — passed.
- `pnpm --filter solid-offline run typecheck` — passed.
- `pnpm --filter solid-offline run test` — passed: 312 tests in 16 files.
- `pnpm --filter solid-offline run api:check` — passed; no public API report change.
- `pnpm run lint:root` — passed.
- `TURBO_SCM_BASE=7d5d23f99d24fe0404dd02b9d027352ab787d8d9 pnpm run gate` —
  failed in unchanged root guardrail tests: 161 failures / 900 tests in four files
  (`agent-layers`, `agent-layers-reachability`, `check-packages-guard`, `check-sdk-layers`).
  Turbo completed 13/15 tasks; all 312 solid-offline tests passed within this run.
- `pnpm run gate:full` — failed at the same unchanged root guardrail tests: 161 failures /
  900 tests in the same four files; Turbo completed 45/209 tasks (9 cached) before stopping.
- `git diff --check` — passed.

The root failures again assert against empty child-process output. An isolated Node 24
`spawnSync` probe invoking the unchanged `scripts/check-sdk-layers.mjs` against a temporary
empty workspace reproduced `error.code: EPERM` with empty stdout/stderr. This supports the
existing sandbox diagnosis; no root guardrail code or tests were changed. Both workspace
gates require a rerun outside this restricted environment; the green package gate does not
establish a green workspace. Logs are `/tmp/sst-8xm.13-fix-gate.log` and
`/tmp/sst-8xm.13-fix-gate-full.log`.

Supply chain: no dependency, manifest, or lockfile changes; `check:packages` is not applicable.
No remote fetch, push, PR, publication, branch switch, or other checkout modification occurred.
`roborev status` still exits 127 because roborev is unavailable; no active post-commit hook
is installed. The required per-commit adversarial review remains for the lead/Jesse before
merge; this security-critical package must not be auto-merged. No implementation work or
open design question remains.

## Fix round 2 — broadcast failures and tracking changes

This round starts at `9df8dfc8a7466301f40f1362ae4b394055f6c2a7` and fixes exactly
the two findings in the supplied review.

Commits:

- `26ecd5d5` — `fix: isolate revalidation broadcast failures`: isolate both start
  and terminal reporting so cache maintenance proceeds and retains its result or
  original error, even when either or both broadcasts throw.
- `6aedea6b` — `fix: retain attempts across status tracking changes`: account for
  every observed attempt independently of snapshot membership; keep active counts
  through `forget()` and settle them even while untracked. Newly tracked or retracked
  resources reflect attempts still in flight. Untracked URLs stay out of the snapshot.
- The final report commit — `docs: record second review fix verification`.

Security property corrected: a failed status broadcast cannot prevent revocation/deletion
purges or mask the original maintenance error. An older terminal event cannot clear newer
pending work after late tracking or forget/retrack. Reporting remains best effort: both
URL-only lifecycle messages are attempted, with no delivery guarantee if the channel throws.
No bytes, headers, credentials, or error details are added to broadcasts.

Proof: 31 new regression cases include start-only, terminal-only, and combined broadcast
failures; exact result/error identity; direct Delete and HTTP 403/404 purges of both bytes
and metadata; all three terminal outcomes across late tracking and forget/retrack;
untracked settlement cleanup; and React `syncing` through overlapping attempts. The
pre-fix regression run failed 29 cases; the two cleanup cases already passed. After the
fixes, all 343 tests pass across 16 files. All fixtures and transports are local mocks.
Worker lifecycle wiring and the public API are unchanged.

Verification uses Node `v24.22.1`, pnpm `10.4.1`, and `PATH=/opt/node24/bin:$PATH`:

- `pnpm --filter solid-offline run lint` — passed; the same three existing warnings.
- `pnpm --filter solid-offline run build` — passed.
- `pnpm --filter solid-offline run typecheck` — passed.
- `pnpm --filter solid-offline run test` — passed: 343 tests in 16 files.
- `pnpm --filter solid-offline run api:check` — passed; no API report change.
- `pnpm run lint:root` — passed as the first stage of the affected gate.
- `TURBO_SCM_BASE=9df8dfc8a7466301f40f1362ae4b394055f6c2a7 pnpm run gate` —
  failed: 13/14 Turbo tasks succeeded. All solid-offline checks passed. The unchanged
  Coeliac Turbopack build failed processing `packages/app-shell/dist/styles.css` because
  creating a process required binding a port: `Operation not permitted (os error 1)`.
  Log: `/tmp/sst-8xm.13-round2-gate.log`.
- `pnpm run gate:full` — failed: 60/232 Turbo tasks succeeded (11 cached), stopping
  at unchanged root guardrail tests: 161 failures / 900 tests across `agent-layers`,
  `agent-layers-reachability`, `check-packages-guard`, and `check-sdk-layers`.
  Log: `/tmp/sst-8xm.13-round2-gate-full.log`.
- `git diff --check` — passed.

The root failures assert against empty child-process output. A direct Node 24 invocation
of the unchanged `scripts/check-sdk-layers.mjs` passed against an empty temporary workspace;
invoking that same command with Node 24 `spawnSync` returned `error.code: EPERM` and empty
stdout/stderr. This reproduces the prior sandbox limitation. No root guardrail, Coeliac,
or app-shell source was changed. The package gate is green; the workspace gates still
require verification outside this sandbox.

Supply chain: no dependencies, manifests, or lockfiles changed; `check:packages` is not
applicable. No remote fetch, push, PR, publication, branch switch, or other checkout
modification occurred. `roborev status` exited 127 (`roborev: command not found`), so
required per-commit adversarial review remains for the lead/Jesse before merge. This
security-critical package must not be auto-merged.

Both requested fixes are complete. Remaining verification is the workspace-gate rerun
and unavailable per-commit review. No open design question remains; tracking continues
to control snapshot membership while attempt accounting follows the observed lifecycle.
