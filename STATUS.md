<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-mxdn — CHT-L3 lane report

## Scope and commits

- Started on `lane/sst-mxdn` at `809c3c12b59847444c2b83be757b4813c4865579`.
- `git merge --ff-only origin/main` integrated the locally available main at
  `d6a9c8b5c94d5bb8829f355afcd20e30182bab85` before gate runs. No remote fetch,
  push, PR, branch switch, or other checkout mutation was performed.
- `3a5b14d7 docs(chat): record unread contract assumptions` — numbered spec
  questions and conservative choices in `QUESTIONS.md`.
- `a4bed7ee feat(chat): add unread markers and notification rules` — pure library,
  public barrel/types, static typed errors, API documentation, 63 unit tests,
  and the unread directory's coverage glob.
- Final documentation commit records validation and clarifies that callers
  resolve revision logs before supplying snapshots.

The API provides `advanceReadMarker`, `countUnread`, and `decideNotification`.
Same-room marker merges take the maximum timestamp with null as never-read;
counts use the existing timeline's strictly-newer rule. Explicit mention IDs
override mute for notifications; own messages, read messages and edits suppress
notifications. All inputs are validated before suppression, without coercion.
Inputs are not mutated. Fixtures use fictional identities at example.org.

## Validation

Commands were run inside this checkout with pnpm 10.4.1 and Node 24.22.1.

| Exact command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | Passed; synchronized dependencies already present in merged main; no manifest/lockfile changes. Warned about solid-mcp's not-yet-built CLI binary, subsequently built by the gate. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/chat-unread.test.ts --coverage.enabled=false` | Expected initial red: unread module did not exist yet. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/chat-unread.test.ts '--coverage.include=src/apps/chat/lib/unread/**/*.ts'` | Passed: 63 tests; 100% statements (66/66), branches (59/59), functions (9/9), lines (52/52). |
| `pnpm exec biome check apps/suite/src/apps/chat/lib/unread apps/suite/test/chat-unread.test.ts apps/suite/vitest.config.ts` | Passed with no diagnostics. |
| `pnpm --filter @jeswr/app-suite run lint` | Passed; existing warnings elsewhere in the merged app. |
| `pnpm --filter @jeswr/app-suite... run build` | Passed: dependency-first build including production Next.js app build. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | Final exact app-only sequence passed after both workspace gate attempts: lint, production build, strict typecheck, 73 test files and 4,462 tests; 100% configured coverage, including every unread TypeScript file. |
| `pnpm --filter @jeswr/app-suite run typecheck` | Passed. |
| `pnpm --filter @jeswr/app-suite run test` | Passed: 73 files, 4,462 tests; all configured library files 100% in all four coverage metrics. |
| `pnpm run lint:root` | Passed, including SDK layers, workspace guards, tokens and all 74 contrast pairs. |
| `pnpm run test:root` | Passed in isolation: 9 files, 745 tests. |
| `TURBO_SCM_BASE=809c3c12b59847444c2b83be757b4813c4865579 pnpm run gate` | Initial attempt failed: existing root `test/agent-layers.test.mjs:509` dynamic-import path-character case timed out at 5 seconds during concurrent builds (744 other root tests passed). Retry passed 70/71 Turbo tasks, including root tests and all suite checks, then failed on three existing personal-agent test timeouts listed below. |
| `pnpm run gate:full` | Failed after 315 successful Turbo tasks: existing federation-trust characterization snapshot differs only in serialized JWK property order; details below. |
| `roborev status` | Unavailable: executable not installed (exit 127); no review verdicts could be read. |

Coverage is enforced per TypeScript file at 100%, including the new unread glob;
no threshold was lowered. No new dependency was added, so `check:packages` was
not applicable. No UI was built; browser fixtures, screenshots, axe and Playwright
specs were not applicable and Playwright was not launched.

## Boundaries and open questions

The conservative choices in `QUESTIONS.md` retain the existing timeline behavior:
timestamp-only markers (equality read), counts including own messages, and
explicit resolved mention IDs plus create/edit events. Counts cover supplied live
messages only. Account-scoped persistence, revision/tombstone resolution, event
classification and delivery deduplication belong to the caller. No implementation
work remains. The workspace gate failures and unavailable roborev review require
follow-up in the integrator's environment.

The affected-gate retry failed only in `@jeswr/personal-agent#test`: three tests
exceeded their existing five-second timeout, at
`packages/personal-agent/src/pilot/scheduling.test.ts:73` and
`packages/personal-agent/src/pilot/transmission.test.ts:316` / `:445`.
That package had 528 passing tests and three failures. These files are outside
this lane and were not changed. The unread implementation and suite-app checks
passed; the workspace gate is not reported as green.

The full-workspace gate failed in `@jeswr/federation-trust#test` at
`packages/federation-trust/test/characterization.test.ts:196`: the inline snapshot
expects a serialized delegate JWK ordered `crv,x,kty`, while the runtime emits
`kty,crv,x`. That package had 53 passing tests and one failure. Its source and
snapshots were not changed. Turbo stopped the remaining scheduled work.

The full gate generated untracked `apps/pod-*/web/public/clientid.jsonld` and
`callback.html` files for the eight pod applications. Only those build-generated
files/directories were removed after the gate; they are not lane deliverables.
