<!-- AUTHORED-BY Codex GPT-6 -->

# Lane status — sst-8xm.29 (T-003), fix round 1

Updated: 2026-10-25. Branch: `lane/sst-8xm.29`;
base: `219cdd5a1579a95a6408f272fe6344e72e2e8664`.

## Outcome and commits

The original implementation remains in `9b2a5fb9` (`feat: enforce SDK dependency
layers`), with its earlier completion report in `ff525448`.

This revision, `fix: resolve workspace aliases in the layer guard`, addresses
the medium finding from review @ff525448:

- Resolve npm aliases, ranged workspace aliases, and bare workspace aliases before
  applying rules. Only the target determines whether an edge is allowed.
- Plain `workspace:*`, `workspace:^`, and `workspace:~` specs retain the dependency
  key as their target, as do ordinary versions, ranges, and tags.
- Fail closed with `unresolvable dependency alias` for other protocols, paths,
  repository shorthands, and malformed specs; dependency specs are never printed.
- Check `dependencies`, `peerDependencies`, and `optionalDependencies`; development
  dependencies remain outside scope. Update the AGENTS.md guard documentation.
- Expand fixtures from 11 to 41 layer-guard tests, covering allowed aliases,
  disguised forbidden targets, every checked field, and unresolved aliases.
  The real-tree test checks working-directory independence for both passing and
  failing scans; the root lint command enforces the real-tree policy verdict.

## Validation

- `pnpm run test:root` — **PASS**, 3 files and 67 tests, including all 41
  layer-guard tests. The test configuration does not measure script coverage.
- `pnpm run lint:root` — **FAIL**, exit 1 at `check:sdk-layers`. Biome, lockfile
  transport, and app-workspace checks pass. The stricter guard rejects five
  existing declarations listed below.
- `pnpm run check:fetch` — **PASS**, run separately because lint stops before it.
- `git diff --check` — **PASS**.
- The gate scope is `lint:root` plus root script tests, as requested by the fix
  brief. No package sources changed; broader workspace gates were not run.

## Existing declarations blocking lint

The fail-closed rule applies conservatively to every manifest the guard scans,
including tools and packages without additional layer-specific restrictions.
It exposes these existing declarations:

| Manifest | Dependency | Protocol |
| --- | --- | --- |
| `apps/pod-manager/package.json` | `@solid/reactive-authentication` | `file:` |
| `packages/agent-authz-verifier/package.json` | `@jeswr/solid-odrl` | `github:` |
| `packages/agent-authz-verifier/package.json` | `@jeswr/solid-vc` | `github:` |
| `packages/federation-trust/package.json` | `@jeswr/federation-registry` | `github:` |
| `packages/federation-trust/package.json` | `@jeswr/solid-vc` | `github:` |

These manifests are unchanged: dependency migration is outside this fix brief.
They need dispatcher follow-up before the stricter real-tree gate can pass.

## Review, unfinished work, and open questions

`roborev status` is unavailable (exit 127, command not found). The dispatcher
must obtain the charter's per-commit automated review.

The requested guard fix and regression fixtures are complete. Remaining blockers
are the five existing declarations and unavailable automated review. There are
no open design questions. STATUS.md was updated after implementation and tests.
No dependencies were added, and no pushes, PRs, fetches, branch switches, or
changes to other checkouts were performed. Bead integration and closure remain
with the dispatcher.
