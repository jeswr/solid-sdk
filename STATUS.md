<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Lane status — sst-8xm.29 (T-003)

Updated: 2026-10-25. Branch: `lane/sst-8xm.29`;
base: `219cdd5a1579a95a6408f272fe6344e72e2e8664`.

## Outcome

Implemented `scripts/check-sdk-layers.mjs`, wired `check:sdk-layers` into
`lint:root`, added 11 CLI fixture tests, and documented the guard in one paragraph
in `AGENTS.md`. The current tree passes; seeded violations exit 1 with manifest
paths, dependency names, and the violated rule. Checks cover app roots and nested
web manifests, the storage-client allowlist, the pod-auth reverse-edge prohibition,
and npm aliases that could otherwise disguise forbidden targets.

The earlier question is resolved by ADR-001's 2026-10-25 amendment, which explicitly
excludes pod-auth and rdf-engine from storage-client's dependencies. The supplied
macOS planning paths do not exist here; the specified ADRs and planning STATUS.md
were read at `/home/runner/work/solid-suite-planning/specs/sdk-core/` instead.
`QUESTIONS.md` records the resolution.

## Commits

- `b0f5ac89` — `docs: record layer policy clarification` (inherited from the earlier run).
- `6f64ad51` — `docs: record blocked layer lint lane` (inherited; this report supersedes it).
- `9b2a5fb9` — `feat: enforce SDK dependency layers`: checker, fixture tests,
  root lint wiring, AGENTS.md paragraph, and resolved question.
- `docs: record completed layer lint lane` — this final report commit.

New commits use the requested author identity, signing disabled, and the
GPT-6.1-Sol co-author trailer.

## Gate results

- `pnpm run lint:root` — **PASS** (exit 0). Biome checked 13 files;
  lockfile transport, app workspace, and SDK layer guards passed. The SDK guard
  scanned 76 manifests. `check:fetch` scanned 11 source files and passed.
  Repeated successfully after writing this report and before the last commit.
- `pnpm run test:root` — **PASS** (exit 0): 3 files, 37 tests, including all
  11 new layer guard tests. Fixtures exercise allowed dependencies, both app
  manifest locations, every forbidden edge, npm aliases, and the explicit
  dependency-field scope. The real-tree test invokes the guard from outside
  the checkout to verify its default root is independent of the working directory.
- `git diff --check` — **PASS**, including before the last commit.
- Package lint/build/typecheck/test and dependent-package checks — not applicable:
  no `packages/*`, `apps/*`, or `tools/*` projects changed. Root validation is
  `lint:root` plus `test:root`.
- Whole-workspace gates (`gate` and `gate:full`) — not run, as required by the lane brief.

## Dependency checks

- `pnpm install --offline --frozen-lockfile --ignore-scripts` — **PASS** (exit 0),
  already up to date; no lockfile change or dependency lifecycle scripts.
- `pnpm run check:packages <name>` — not applicable; no dependencies were added or changed.

## Review and limitations

`roborev status` — unavailable (exit 127, command not found). No automated
review verdict could be obtained in this environment; the dispatcher must run
the charter's per-commit review.

Conservative scope: the script reads only manifest `dependencies`, as specified
by T-003. Development, peer, and optional dependency fields are not constrained.
Backend names refer to ADR-003's `@jeswr/storage-client/solid` and `/lws` subpaths.
Source import lint is outside this task; a manifest-only check cannot distinguish
root-package imports from backend subpath imports in application source files.

## Unfinished and open questions

No implementation work or open design questions remain for T-003. Automated
roborev review remains unavailable locally; the wider gate belongs to the dispatcher.
No pushes, fetches, PRs, branch switches, deployments, new dependencies, or edits
to other checkouts were performed. The bead is left for dispatcher integration
and closure.
