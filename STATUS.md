<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-x3q3 — MAI-L2 conversation threading

Implementation complete on `lane/sst-x3q3`, based on
`8865b4b3e01bdb91ab0f102683e0833f786c65cf`. No pushes, PRs, branch switches,
remote fetches, dependency additions or other checkout changes.

## Commits

- `480b0c33 docs: record mail threading input boundaries` — conservative choices in
  `QUESTIONS.md` for decoded input, anomaly handling and summary semantics.
- `0bd1b252 feat: implement pure JWZ mail threading` — library and barrel in
  `apps/suite/src/apps/mail/lib/threading/`; reference containers, missing ancestors,
  cycles, duplicate Message-IDs, subject fallback, latest-first ordering, summaries,
  typed errors, API README, synthetic fixtures and per-file coverage enforcement.
- Final commit, `docs: record mail threading lane results` — this report.

## Validation

Commands run in this checkout; final results:

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS — generated dependency declarations; no source changes |
| `pnpm exec biome check apps/suite/src/apps/mail/lib/threading apps/suite/test/mail-threading*.test.ts apps/suite/vitest.config.ts` | PASS — no diagnostics in changed TypeScript files |
| `pnpm --filter @jeswr/app-suite run lint` | PASS — 21 existing warnings outside this library |
| `pnpm --filter @jeswr/app-suite run build` | PASS — optimized Next.js production build |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS |
| `pnpm --filter @jeswr/app-suite run test` | PASS — 29 files, 1,261 tests |
| `pnpm run lint:root` | PASS — all workspace guards, including 74 contrast pairs |
| `TURBO_SCM_BASE=8865b4b3e01bdb91ab0f102683e0833f786c65cf pnpm run gate` | PASS — 7/7 tasks, app tests plus 686 root tests |
| `pnpm run gate:full` | FAIL outside lane scope — `@jeswr/federation-codegen#test`, 212 successful / 289 total tasks before termination |
| `git diff --check` | PASS |

The threading directory has **100% statements, branches, functions and lines per
TypeScript file** (no coverage exclusions). Its 84 unit cases include a 4,000-message
deep thread and 200 seeded adversarial snapshots checking no message loss, no repeated
tree nodes, and permutation invariance. All fixtures are synthetic with example.org
identities and fictional people. The explicit app lint/build/typecheck/test sequence
passed together after the workspace gates stopped.

Initial iterations exposed two incorrect test expectations and a readonly fixture edit;
these were corrected. The first typecheck needed the ignored `suite-ui` build output.
A redundant standalone build overlapped the affected gate and hit Next.js's build lock;
the subsequent complete sequential app check passed.

## Full-gate limitation

The two failures in `tools/federation-codegen/test/generator.test.ts` are:

- Line 81: expects `https://w3id.org/jeswr/sectors/bookmarks#Bookmark`, receives
  `https://jeswr.org/ns/sectors/bookmarks#Bookmark`.
- Line 126: committed generated `ontology.ttl` differs from fresh generation because
  the ontology's namespace/version migrated while the expected output stayed old.

`git diff 8865b4b3e01bdb91ab0f102683e0833f786c65cf -- tools/federation-codegen packages/solid-federation-vocab`
is empty. These are existing base inconsistencies; no out-of-scope files were changed.
The full gate stops on this failure, so remaining workspace tasks are not certified.

## Dependencies, UI and review

- `check:packages`: not applicable; no dependencies or manifest/lockfile changes.
  The property tests use the app's existing `fast-check` dependency.
- Screenshots/Playwright/axe: not applicable; this lane adds a pure library and no UI,
  rendered state, component or fixture route. Playwright was not launched.
- Roborev review could not run: `roborev status` returned `command not found`
  (exit 127). No review verdict is available; no installation/config changes were made.

## Open questions and unfinished work

No unfinished MAI-L2 implementation or blocking question. `QUESTIONS.md` records the
conservative choices: decoded snapshots and a bounded Message-ID syntax, deterministic
JWZ anomaly handling, exact participant identities and 160-code-point snippets. Raw
header/MIME parsing and full localized/RFC subject extraction remain outside this API's
documented input contract; unsupported header forms are rejected with typed errors.
Full-workspace green status and automated commit review remain limited as described above.

## Fix round 1 — decoded subject validation

- `c27ddad5 fix: accept literal encoded-word markers in subjects` narrows undecoded
  subject detection to complete encoded words. Ordinary literal `=?` text and incomplete
  markers remain valid. This takes the review's conservative option, preserving the
  existing typed rejection of complete raw encoded words and control characters.
- Regression tests cover normalization and a mixed mailbox containing the literal
  subject, a subject-matched reply, and an unrelated message. Complete B/Q encoded
  words, including lowercase and embedded forms, remain rejected.
- Final report commit: `docs: record subject validation fix results`.

Validation for this round (base `69ec9410b10804d0d4bc61495445ae1fe9376ed9`):

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/mail-threading-validation.test.ts --coverage.enabled=false` | Before fix: 5 expected regression failures, 64 passes |
| `pnpm --filter @jeswr/app-suite exec vitest run mail-threading --coverage.include='src/apps/mail/lib/threading/**/*.ts'` | PASS — 91 tests; 100% statements, branches, functions and lines |
| `pnpm exec biome check apps/suite/src/apps/mail/lib/threading/validation.ts apps/suite/test/mail-threading-validation.test.ts` | PASS |
| `pnpm --filter @jeswr/suite-ui run build` | PASS — dependency build only |
| `pnpm --filter @jeswr/app-suite run lint` | PASS — 21 existing warnings |
| `pnpm --filter @jeswr/app-suite run build` | PASS |
| `pnpm --filter @jeswr/app-suite run typecheck` | PASS |
| `pnpm --filter @jeswr/app-suite run test` | PASS — 29 files, 1,268 tests; all configured coverage thresholds remain 100% |
| `pnpm run lint:root` | PASS |
| `TURBO_SCM_BASE=69ec9410b10804d0d4bc61495445ae1fe9376ed9 pnpm run gate` | PASS — 6/6 tasks |
| `pnpm run gate:full` | FAIL outside scope — same two `@jeswr/federation-codegen` tests described above; 223 successful / 290 total tasks before termination; 686 root tests pass |
| `git diff --check` | PASS |

An initial targeted test invocation using `test/mail-threading*.test.ts` matched no
files because Vitest treats the filter as literal text. The corrected `mail-threading`
filter above passed. No dependencies, UI, screenshots, or unrelated source changes.
`roborev status` remains unavailable (exit 127, command not found).

The full-gate failures still concern the Bookmark namespace expectation and generated
`ontology.ttl` drift. `git diff 69ec9410b10804d0d4bc61495445ae1fe9376ed9 -- tools/federation-codegen packages/solid-federation-vocab`
is empty. No unfinished fix or open question remains; full-workspace green status and
automated commit review retain the limitations above.
