<!-- AUTHORED-BY Codex GPT-6 -->

# Lane status — sst-8xm.29 (T-003), fix round 2

Updated: 2026-10-25. Branch: `lane/sst-8xm.29`;
base: `219cdd5a1579a95a6408f272fe6344e72e2e8664`.

## Outcome and commits

The original implementation is `9b2a5fb9` (`feat: enforce SDK dependency layers`),
with its earlier completion report in `ff525448`. Fix round 1 is `e28fd187`
(`fix: resolve workspace aliases in the layer guard`).

This revision, `fix: scope fail-closed alias checks to layered packages`, implements
the fix-round-2 decision and addresses the medium workspace-range finding @e28fd187:

- Limit unresolved-spec failures to storage-client and pod-auth manifests, plus
  restricted dependency keys in any scanned manifest (including their subpaths).
  Ignore unrelated file, link, and repository specs in unrestricted manifests.
  The five existing declarations identified in round 1 now pass without changes.
- Resolve workspace semver versions and ranges against the dependency key before
  considering aliases. Cover exact, caret, tilde, comparator, hyphen, union,
  wildcard, and prerelease/build ranges. Retain npm and workspace alias resolution.
- Preserve dependency, peer, and optional coverage, target-based layer rules,
  spec-redacted diagnostics, and the exclusion of development dependencies.
- Expand layer-guard fixtures from 41 to 54 tests. The real-tree test now requires
  a passing scan both inside and outside the checkout. Update AGENTS.md to describe
  the narrowed policy.

## Validation

- `pnpm run lint:root` — **PASS**, including the layer guard on 76 real manifests,
  Biome, lockfile transport, app-workspace, and raw-fetch checks.
- `pnpm run test:root -- test/check-sdk-layers.test.mjs` — **PASS**, 3 files and
  all 80 root tests (the separator causes Vitest to run the whole root suite).
- `pnpm exec vitest run test/check-sdk-layers.test.mjs` — **PASS**, all 54
  layer-guard tests. The test configuration does not measure script coverage.
- `git diff --check` — **PASS**.
- `pnpm run gate` and `pnpm run gate:full` — **FAIL**, exit 1 in the unchanged
  `@jeswr/unstorage-solid` build. Its dependency-build helper invokes a remote
  clone into `/tmp`, then `npm install --ignore-scripts`; npm fails with `EROFS`
  when writing `/home/runner/.npm/_cacache`. The gate's remote-clone side effect
  was discovered from its output; no further gate retries were made after that
  discovery. Logs: `/tmp/sst-8xm.29-gate.log` and
  `/tmp/sst-8xm.29-gate-full.log`. No package sources or dependencies were changed
  to work around this unrelated build/environment limitation.

## Review, unfinished work, and open questions

`roborev status` is unavailable (exit 127, command not found). The dispatcher
must obtain the charter's per-commit automated review.

The requested guard fix and regression fixtures are complete, and the requested
real-tree root lint passes. Full-workspace verification and automated review
remain incomplete for the reasons above. There are no open design questions.
STATUS.md was updated last, after implementation and validation. No dependencies
were added; no pushes, PRs, branch switches, or merges were performed. Bead
integration and closure remain with the dispatcher.
