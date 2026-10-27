<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MUS-L6 lane report — sst-f1ig

Branch: `lane/sst-f1ig`. Base: `2c99c9d2202c6b18c38c88ed1524fcb3d2efd460`.

Commits:

- `1047c617 docs: record scrobble import interpretations` — conservative choices in
  `QUESTIONS.md`.
- `63563232 feat: import and deduplicate listening history` — pure ListenBrainz
  JSON array/JSON Lines and Last.fm CSV importers, normalized records, physical
  warning lines, strict timestamps/MBIDs, typed errors, deterministic duplicate
  selection/sorting, exported limits, README, tests and coverage include.
- Final `docs: record MUS-L6 lane validation` commit — this report.

The public barrel exports `importScrobbles`, `parseListenBrainz`, `parseLastFm`,
`ScrobbleError`, types, `MAX_EXPORT_BYTES` and `MAX_LISTENS`. Tests cover the real
64 MiB and 1,000,000-row limits at the bound and bound+1, including combined-source
limits and UTF-8 sizing, plus a seeded randomized duplicate-selection oracle.

`git fetch origin main` used the configured local source clone
`/home/user/solid-sdk`; merging `origin/main` reported "Already up to date."
This happened before the final gates. No network remote was fetched, and no
branch switch, push or PR was performed.

Validation used Node `v24.22.1`, pnpm `10.4.1`, and these execution settings:

```sh
export PATH=/opt/node24/bin:$PATH
export npm_config_manage_package_manager_versions=false
export VITEST_MAX_WORKERS=2
```

The initial default Node 22/pnpm command tried to create its tool-manager cache
outside writable paths. Selecting the installed Node 24/pnpm binaries resolved
that without changing repository configuration or installing dependencies.
Turbo's retry/full runs use `--env-mode=loose` to pass the worker setting through.

Commands and results:

- `pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4` —
  PASS, 7 dependency builds. An earlier app-only typecheck exposed missing fresh
  dependency declarations and was rerun successfully after these builds.
- From `apps/suite`:
  `pnpm exec vitest run test/music-scrobbles.test.ts --coverage.include='src/apps/music/lib/scrobbles/**/*.ts'`
  — PASS, 19 tests; all five importer TypeScript files have 100% statements,
  branches, functions and lines (302 statements, 262 branches, 30 functions,
  240 lines).
- Required app sequence:

  ```sh
  pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
  ```

  PASS throughout: production build succeeded; 153 test files and 7,526 tests
  passed. All configured app coverage includes reached 100% in all four
  categories. App lint reports existing warnings outside this task and exits 0.
- `pnpm run lint:root` — PASS, including workspace/layer guards and all 74
  contrast pairs.
- `TURBO_SCM_BASE=2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 pnpm run gate` —
  initial run FAILED on the existing root agent-layer guard's 5-second timeout:
  `test/agent-layers.test.mjs:509`,
  `rejects disallowed path characters globally: module["require"](TARGET);`.
  The other 878 root tests passed.
- `VITEST_MAX_WORKERS=1 pnpm exec turbo run test:root --filter=// --concurrency=1 --env-mode=loose`
  — PASS, all 879 root tests across 12 files, with existing timeouts intact.
- `TURBO_SCM_BASE=2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 pnpm run gate --env-mode=loose`
  — PASS, 13/13 tasks; app tests again 7,526/7,526 and 100% configured coverage.
- `pnpm run gate:full --env-mode=loose` — FAILED after 287 successful tasks out
  of 351, on the unrelated `@jeswr/federation-trust` test
  `characterization — emitted credential shape (every IRI pinned) > delegation credential structure is stable`
  at `packages/federation-trust/test/characterization.test.ts:196`.
  Its inline snapshot embeds a JWK JSON string with property order
  `crv,x,kty`; the received order is `kty,crv,x`. All property values agree.
- `VITEST_MAX_WORKERS=1 pnpm --filter @jeswr/federation-trust run test` —
  independently reproduced that same failure: 53 passed, 1 failed.
- `git diff 2c99c9d2202c6b18c38c88ed1524fcb3d2efd460 --exit-code -- packages/federation-trust`
  — PASS: that package is unchanged from the supplied base. Its snapshot is
  outside this lane's scope and was not updated.
- `git diff --check` — PASS. Fourteen untracked callback/client-ID files emitted
  by the full gate under seven `apps/pod-*/web/public/` directories were removed;
  no generated files or `dist/` were committed.

No dependencies were added: `check:packages` is not applicable. No UI was built:
Playwright, axe, visual fixtures and screenshots are not applicable and were not
run. The library contains no React, hooks or network I/O.

No MUS-L6 implementation work remains. Full-workspace validation remains red
on the independently reproduced, out-of-scope federation-trust snapshot failure.
Roborev is unavailable in this environment, so automated commit verdicts could
not be obtained. No tracker state was changed from this lane.

Open interpretations are recorded in `QUESTIONS.md` and applied conservatively:
limits shared across sources, all four exact CSV headers required, strongest-first
pairwise duplicate suppression, and integer epoch seconds. None blocks this
implementation.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 1 — scalar artist MBID warning

Starting head: `cfd8466f8f870346f33dd2a0211b601737a833c1`.

- `bfcaa663 fix: warn when dropping scalar artist MBIDs` — emit `INVALID_MBID`
  for every supplied non-array `artist_mbids` value. Validate individual artist
  UUIDs only inside arrays. Six regression cases cover a valid scalar lowercase
  UUID, null, an invalid string, an object, a number and a boolean, preserving the
  listen and checking the exact warning, field, source and physical line.
- Final `docs: record scalar MBID fix validation` commit — this report update.

Validation used the installed Node `v24.22.1` and pnpm `10.4.1`, with
`PATH=/opt/node24/bin:$PATH` and
`npm_config_manage_package_manager_versions=false`. App/focused runs used
`VITEST_MAX_WORKERS=2`; repository Turbo runs used `VITEST_MAX_WORKERS=1` and
`--env-mode=loose`.

Commands and results:

- From `apps/suite`, before the fix:
  `pnpm exec vitest run test/music-scrobbles.test.ts -t 'warns when dropping non-array artist MBIDs' --coverage.enabled=false`
  — expected regression failure: the valid scalar UUID emitted no warning;
  the other five cases passed.
- From `apps/suite`, after the fix:
  `pnpm exec vitest run test/music-scrobbles.test.ts --coverage.include='src/apps/music/lib/scrobbles/**/*.ts'`
  — PASS, 25 tests; 100% statements, branches, functions and lines for the
  scrobbles directory.
- `pnpm exec biome check --write apps/suite/src/apps/music/lib/scrobbles/normalize.ts apps/suite/test/music-scrobbles.test.ts`
  — PASS after formatting the new parameterized test.
- `pnpm exec turbo run build --filter='@jeswr/app-suite^...' --concurrency=4`
  — PASS, all 7 dependency builds.
- Required app gate:

  ```sh
  pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test
  ```

  PASS: production build and typecheck succeeded; 153 test files and 7,532
  tests passed with 100% configured coverage in all four categories. App lint
  exited 0 with 54 existing warnings outside this fix.
- `pnpm run lint:root` — PASS, including all repository guards.
- `TURBO_SCM_BASE=cfd8466f8f870346f33dd2a0211b601737a833c1 pnpm run gate --env-mode=loose`
  — PASS, 12/12 tasks; all 7,532 app tests and 100% configured coverage.
- `pnpm run gate:full --env-mode=loose` — FAILED, 160 successful tasks out of
  263, on four existing 5-second timeouts at
  `test/agent-layers.test.mjs:509`. The affected parameterized forms were
  `await import(TARGET);`, `require(TARGET);`, `(require as Loader)(TARGET);`
  and `type Value = import(TARGET).Value;`. Root results: 875 passed, 4 failed.
- `pnpm exec turbo run test:root --filter=// --concurrency=1 --env-mode=loose`
  — PASS in isolation, all 879 root tests across 12 files, with the original
  timeouts unchanged. This supports resource contention during the full gate
  as the cause of its timeout failures.
- `git diff cfd8466f8f870346f33dd2a0211b601737a833c1 --exit-code -- test/agent-layers.test.mjs scripts/check-agent-layers.mjs`
  — PASS: those root guard files are unchanged by this fix.
- `git diff --check` — PASS.

The review finding is fully addressed. Full-workspace validation remains red on
the root test timeouts above; no unrelated tests or configuration were changed.
Roborev remains unavailable, so automated commit verdicts could not be obtained.
No dependencies, UI changes, generated files, tracker mutations, branch changes,
fetches, merges, pushes or PRs were added in this fix round. No new open questions.
