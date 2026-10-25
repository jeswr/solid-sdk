<!-- AUTHORED-BY Codex GPT-6 -->

# Lane status — sst-8xm.29 (T-003), final fix round

Updated: 2026-10-25. Branch: `lane/sst-8xm.29`;
base: `219cdd5a1579a95a6408f272fe6344e72e2e8664`.
This round resumed at `c80ea398`; earlier implementations remain in branch history.

## Outcome and commits

- `2fd8cf99` (`fix: allowlist layered dependency spec forms`) removes alias
  resolution. Specs in storage-client and pod-auth manifests, and specs under
  restricted dependency keys (including subpaths) in any scanned manifest,
  must be `workspace:*`, `workspace:^`, `workspace:~`,
  `workspace:<semver range>`, or plain semver ranges. Other forms fail with
  "unsupported dependency spec for a layered package" without printing specs.
  Layer rules apply to dependency keys. Unrestricted manifests' unrelated
  dependencies remain outside the check. AGENTS.md documents the new policy.
- Replace obsolete alias-resolution fixtures with accepted/rejected spec
  fixtures, including relative `workspace:../pod-auth`, scoped/unscoped aliases,
  paths, protocols, repository forms, tags and malformed specs. Exercise all
  three dependency fields and every scanned manifest location. Keep coverage
  for layer restrictions, subpaths and ignored development dependencies.
- Final documentation commit: `docs: record final layer spec fix results`.
  This report was updated last, after implementation and validation.

Conservative interpretation: empty or malformed ranges are unsupported. No
new dependency was needed for the semver syntax allowlist.

## Validation

- `pnpm exec turbo run lint:root test:root --filter=// --force` — **PASS**,
  2/2 root tasks executed without cache hits. This is the touched root project's
  gate; no package/app source files or manifests changed, so package-specific
  build, typecheck and dependent-package gates do not apply.
- The gate's `pnpm run lint:root` — **PASS**, including Biome, lockfile transport,
  app-workspace, SDK-layer and raw-fetch checks. The layer guard passes on all
  76 real manifests.
- The gate's `pnpm run test:root` — **PASS**, all 186 tests in 3 files,
  including 160 SDK-layer fixtures. Script coverage is not measured by the
  existing root configuration.
- Before changing the implementation,
  `pnpm exec vitest run test/check-sdk-layers.test.mjs` failed on the 36 new
  unsupported-spec regressions, confirming the old resolver fails the new policy.
- `git diff --check` — **PASS**.
- `check:packages` — not applicable; no dependencies were added.

The original lane brief explicitly assigns the whole-workspace gate to the
dispatcher and prohibits running it in this lane. Neither `pnpm run gate`
nor `pnpm run gate:full` was run; the scoped root gate above covers this change.

## Review, unfinished work, and open questions

`roborev status` is unavailable (exit 127, command not found). The dispatcher
must obtain the charter's per-commit automated review; no local review verdict
was available to read.

Implementation and the scoped gate are complete. Automated review and wider
workspace verification remain with the dispatcher. No implementation work is
blocked and there are no open questions. Bead integration and closure remain
with the dispatcher.

No dependencies were added; no pushes, PRs, branch switches, remote fetches,
or merges were performed. Work stayed inside this checkout apart from
read-only access to the prescribed tracker briefs and temporary test logs.
