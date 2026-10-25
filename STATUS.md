<!-- AUTHORED-BY Codex GPT-6 -->

# Lane status — sst-8xm.29 (T-003), fix round 3

Updated: 2026-10-25. Branch: `lane/sst-8xm.29`;
base: `219cdd5a1579a95a6408f272fe6344e72e2e8664`.

## Outcome and commits

The original implementation is `9b2a5fb9` (`feat: enforce SDK dependency layers`),
with its earlier completion report in `ff525448`. Fix round 1 is `e28fd187`
(`fix: resolve workspace aliases in the layer guard`); fix round 2 is `1aabe617`
(`fix: scope fail-closed alias checks to layered packages`).

Fix round 3 addresses the medium workspace-selector finding @1aabe617:

- `72c178c9` (`fix: require explicit workspace alias ranges`) resolves only
  explicit `workspace:<name>@<range>` forms as aliases. Every other workspace
  selector targets the dependency key, including bare words, versions, and
  ranges. Remove the now-unneeded semver parser and update AGENTS.md.
- Correct fixtures that previously accepted bare workspace words as aliases.
  Add the exact storage-client `"@jeswr/pod-auth": "workspace:n3"` regression
  across dependencies, peerDependencies, and optionalDependencies. Keep explicit
  scoped/unscoped workspace aliases and npm aliases covered. All 57 layer-guard
  tests pass.
- Final documentation commit: `docs: record workspace selector fix results`
  updates this report last, after implementation and validation.

## Validation

- `pnpm run lint:root` — **PASS**, including the layer guard on 76 real manifests,
  Biome, lockfile transport, app-workspace, and raw-fetch checks.
- `pnpm run test:root` — **PASS**, all 83 root tests in 3 files, including
  all 57 layer-guard tests. The configuration does not measure script coverage.
- `pnpm exec turbo run lint:root test:root --filter=//` — **PASS**, 2/2 tasks,
  both executed without cache hits. This is the touched root project's gate;
  no package or app source files or manifests changed, so no package-specific
  build or typecheck gates apply.
- Before changing the resolver, `pnpm exec vitest run test/check-sdk-layers.test.mjs`
  failed on the 7 corrected/new selector regressions, confirming they detect
  the previous behavior. The full root suite above passes after the fix.
- `git diff --check` — **PASS**.
- `check:packages` — not applicable; no dependencies were added.

The original lane brief explicitly assigns the whole-workspace gate to the
dispatcher. `pnpm run gate` and `pnpm run gate:full` were not rerun this round.
The preceding round recorded failures in the unchanged unstorage-solid build,
whose dependency-build helper invokes a remote clone and npm install. Avoiding
that helper also respects this round's prohibition on network fetches.

## Review, unfinished work, and open questions

`roborev status` is unavailable (exit 127, command not found). The dispatcher
must obtain the charter's per-commit automated review.

The requested guard fix and regression fixtures are complete, and the touched
root gate passes. Automated review remains unavailable locally; full-workspace
verification remains with the dispatcher. There are no open questions or
unresolved implementation decisions.
STATUS.md was updated last, after implementation and validation. No dependencies
were added; no pushes, PRs, branch switches, or merges were performed. Bead
integration and closure remain with the dispatcher.
