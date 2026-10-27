<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-ild.3 lane status

Branch: `lane/sst-ild.3`. Base: `0d8842080a31b716b2d1350efed53b19eb8c6832`.

## Commits and implementation

- `bba950b6` — `test(vocab): cover sector SHACL constraints`: positive and
  single-constraint negative Turtle fixtures for all 14 constrained sectors;
  expected-path headers for existing scheduling negatives; reused diet diary and
  contradictory-coverage examples; conservative interpretations in `QUESTIONS.md`.
- `6c136835` — `feat(vocab): gate sector fixtures automatically`: recursive sector
  discovery, local imported-profile composition, exact expected-result paths,
  single underlying constraint enforcement, and positive/negative coverage for
  every enforceable NodeShape (including inherited properties and helper shapes).
  The package test runs regression checks that deliberately break temporary
  copies, including wrong/missing expectations, extra failures, conforming
  negatives, invalid positives, imported Core constraints, missing NodeShape
  coverage and newly added nested sectors without fixtures.
- `docs: record sst-ild.3 lane results` — this final status commit.

The gate passes 179 fixtures across 14 sectors, covering 140 NodeShapes with
enforceable property constraints. Profiles themselves are unchanged.

## Validation

All commands ran inside this checkout with `PATH=/opt/node24/bin:$PATH`
(Node `v24.22.1`, pnpm `10.4.1`).

| Exact command | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | PASS; lockfile unchanged, lifecycle scripts disabled. Existing missing workspace CLI build-artifact warnings only. |
| `pnpm exec biome check --write packages/solid-federation-vocab/scripts/shacl-fixtures.mjs packages/solid-federation-vocab/scripts/test-shacl-fixtures.mjs packages/solid-federation-vocab/scripts/validate.mjs packages/solid-federation-vocab/package.json` | PASS; formatted the new scripts. Existing informational lone-block diagnostic in `validate.mjs`. |
| `pnpm exec biome check --write packages/solid-federation-vocab/scripts/test-shacl-fixtures.mjs` | PASS after the imported-Core regression check was added. |
| `pnpm --filter @jeswr/solid-federation-vocab run gate` | PASS: lint, build, typecheck, test, ontology. |
| `pnpm --filter @jeswr/solid-federation-vocab run lint && pnpm --filter @jeswr/solid-federation-vocab run build && pnpm --filter @jeswr/solid-federation-vocab run typecheck && pnpm --filter @jeswr/solid-federation-vocab run test && pnpm --filter @jeswr/solid-federation-vocab run ontology` | PASS on the committed implementation; all fixture and deliberate-failure regression checks pass. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=0d8842080a31b716b2d1350efed53b19eb8c6832 pnpm run gate` | FAIL in unchanged root tests; all five package tasks passed. Turbo: 5 successful / 6 total. Root Vitest: 4 files failed / 8 passed; 168 tests failed / 732 passed. |
| `pnpm exec vitest run test/check-packages-guard.test.mjs` | FAIL independently: 2 failed / 2 passed. Both negative `request` package-policy checks receive empty subprocess output instead of the expected diagnostic. |
| `pnpm run gate:full` | FAIL in the same unchanged root suites: 4 files failed / 8 passed; 170 tests failed / 730 passed (including additional timeouts under the full run). Turbo stopped at `//#test:root` after 73 successful / 248 total tasks, so the full workspace was not completely verified. |
| `git diff --check` and `git diff --check 0d8842080a31b716b2d1350efed53b19eb8c6832..HEAD` | PASS. |

The affected gate's failing root files are `test/agent-layers-reachability.test.mjs`,
`test/agent-layers.test.mjs`, `test/check-packages-guard.test.mjs` and
`test/check-sdk-layers.test.mjs`. Failures include empty subprocess diagnostics and
timeouts. The root scripts, tests and guardrails are unchanged relative to the
base; no unrelated fixes were made.

The ontology gate passed Turtle parsing and term hygiene. Its existing optional
ROBOT/HermiT step explicitly skipped because the reasoner is unavailable.

## Supply chain and review

No dependencies were added. `check:packages` is not applicable and was not run;
the existing development dependencies suffice. The manifest changes only wire
the fixture self-check into `test` and the new scripts into `typecheck`.

`roborev` is not installed in this environment (`command -v roborev` found no
executable), and no post-commit review hook is installed in this checkout.
Automated per-commit review therefore remains unavailable. No tools were
installed and no review verdict is claimed.

## Open questions and remaining limits

The implementation is complete under the conservative readings committed in
`QUESTIONS.md`: recurse into nested sectors; exempt shapes that cannot produce
the required property-path failure (empty/tautological shapes and Diet's two
node-level genetic safety shapes). The latter rules remain active while all
diet fixtures validate. Expanding the contract to node-level results would need
a different expectation format and is outside this brief.

Workspace-wide gate failures and unavailable roborev/ROBOT verification remain
external limits. No push, PR, publication, branch switch or remote fetch/merge
was performed.
