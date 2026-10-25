<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.58 — T-070 lane report

Date: 2026-10-25. Branch: `lane/sst-8xm.58`. Base: `219cdd5a1579a95a6408f272fe6344e72e2e8664`.

**Blocked before implementation.** The required Sparq 0.1.5 artifact exceeds both
size limits required by ADR-007 §D3 and T-070. Per the lane's contradiction rule,
implementation stopped and the maintainer decision is recorded in `QUESTIONS.md`.
No package source, dependency manifest, or lockfile was changed.

## Commits

- `b32df2a0` — `docs: flag rdf-engine bundle budget conflict`: records the
  conflicting requirements, measured evidence, and options requiring direction.
- `docs: record blocked rdf-engine lane` — final report commit containing this file.

Both use the required author identity, unsigned commit command, and
`Co-Authored-By: GPT-6.1-Sol (Codex) <noreply@openai.com>` trailer.

## Size evidence

Downloaded `https://registry.npmjs.org/@sparq-org/sparq/-/sparq-0.1.5.tgz`
to the checkout's ignored `node_modules/.cache/rdf-engine/` directory and unpacked
it there. Its SHA-512 integrity matches the `dist.integrity` field returned by
`https://registry.npmjs.org/@sparq-org/sparq/0.1.5`.

| Artifact in published tarball | Raw bytes | Gzip bytes, level 9 | Gzip bytes, default |
| --- | ---: | ---: | ---: |
| `wasm/sparq_wasm_bg.wasm` | 3,909,895 | 1,444,432 | 1,445,125 |
| `wasm-node/sparq_wasm_bg.wasm` | 3,909,895 | 1,444,432 | 1,445,125 |
| Required maximum | 2,621,440 | 921,600 | 921,600 |

Each WASM file alone exceeds both budgets; including JavaScript cannot make the
full bundle fit. Measurements used Node 24.22.1 `readFile`, `gzipSync(bytes)`, and
`gzipSync(bytes, { level: 9 })`. No size-budget test was added or claimed to pass.

## Dependency policy

Exact commands and results:

```sh
pnpm run check:packages @sparq-org/sparq n3 @types/n3 @rdfjs/types @types/node @vitest/coverage-v8
# PASS: all six packages cleared full policy/existence/age checks.
# @sparq-org/sparq: age 44 days.

pnpm run check:packages n3-canon rdf-validate-shacl
# FAIL: n3-canon first published 17 days ago, below the 30-day threshold.
# rdf-validate-shacl passed (age 2398 days).
```

The latter checked ADR-007 §D1's existing canonicalization/validation libraries
while investigating a WASM-free fake. The rejected package was not added.

An initial `pnpm --filter @jeswr/rdf-engine add @sparq-org/sparq@0.1.5 n3@^2.0.3
@rdfjs/types@^2.0.1` attempt encountered a read-only pnpm store/cache and was
cancelled before changing the manifest or lockfile. No dependency installation
or lifecycle scripts completed. The subsequent planned devDependency add did
not run. The size evidence above comes from the integrity-verified published
tarball, not a successful pnpm installation.

## Gate results

The following exact sequence completed with exit code 0 before the final commit:

```sh
pnpm --filter @jeswr/rdf-engine run lint && pnpm --filter @jeswr/rdf-engine run build && pnpm --filter @jeswr/rdf-engine run typecheck && pnpm --filter @jeswr/rdf-engine run test && pnpm run lint:root
```

- Package lint, build, and typecheck: PASS.
- Package tests: PASS, one existing scaffold smoke test. Coverage is enabled,
  with zero executable statements/functions/branches in the empty entry points.
  This is not validation of any T-070 functionality.
- Root lint, lockfile transport guard, app workspace guard, and raw-fetch guard: PASS.
- `git diff --check`: PASS before committing the decision record.
- No whole-workspace gate was run, as instructed. No package was changed, so no
  dependent-package gate applies.
- `roborev` is unavailable in this environment; automated commit review could
  not be run and no review verdict is claimed.

## Unfinished work and open question

All T-070 implementation remains: loader; parse/serialize/validate/canonicalize;
Node and browser entry points; static WASM copy helper; fake engine; shared
contract tests; bundle metadata/budget test; and memory leak tests. Contract,
size, and leak acceptance criteria have not been met.

The decision in `QUESTIONS.md` is required: authorize a larger budget for 0.1.5,
or supply an approved alternative prebuilt artifact/version meeting the existing
budget. No version, budget, dependency-policy, or API-design exception was made.
