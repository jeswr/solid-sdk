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
