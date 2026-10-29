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

## Fix round 1 — inherited-constraint coverage

- `b99344c8` — `fix(vocab): require fixtures for inherited constraints`: compose
  imported profiles before deciding fixture requirements from the sector's own
  NodeShapes' effective constraints. A sector that only inherits Core's Account
  properties through `sh:node` now requires fixtures and per-shape coverage.
  Importing Core without inheriting constraints does not require fixtures.
- `docs: record inherited-constraint fix results` — this round's status update.

The regression first reproduced the finding on the unchanged validator with
`AssertionError: Missing expected rejection` for the inherited sector's absent
fixture directory. It now checks that missing fixtures and missing negative
coverage fail, and that a conforming positive plus a single-property negative
passes. Temporary RDF is built with `@rdfjs/wrapper` and serialized with
`n3.Writer`; the fixture node has only the sector class, so independent Core
targets cannot supply the coverage.

Commands use `PATH=/opt/node24/bin:$PATH` as above:

| Exact command | Result |
| --- | --- |
| `node packages/solid-federation-vocab/scripts/test-shacl-fixtures.mjs` (new regression before the fix) | FAIL as expected: the original validator skipped the inherited sector. |
| `pnpm exec biome check packages/solid-federation-vocab/scripts/shacl-fixtures.mjs packages/solid-federation-vocab/scripts/test-shacl-fixtures.mjs` | PASS. |
| `pnpm --filter @jeswr/solid-federation-vocab run gate` | PASS: lint, build, typecheck, test and ontology; 179 fixtures across 14 sectors plus the inherited-sector regression. |
| `TURBO_SCM_BASE=392fff8b7d96cb1245de35757579415a3b527991 pnpm run gate` | PASS: root lint and all affected tasks; 5 successful / 5 total. |
| `pnpm run gate:full` | FAIL at `//#test:root`: 162 failed root tests across the same four files listed above (empty subprocess diagnostics and a timeout). Turbo stopped after 39 successful / 202 total tasks. |
| `git diff --check` and `git diff --check 392fff8b7d96cb1245de35757579415a3b527991..HEAD` | PASS. |

No dependencies or profiles changed. There are no new design questions or
unfinished implementation work. `roborev` and the optional ROBOT/HermiT reasoner
remain unavailable as documented above. Root scripts, tests and guardrails are
unchanged from this round's base; the full-workspace failure remains an external
verification limit.

## Fix round 2 — nested and subclass coverage

Base: `8912474e71e3850e15fa2fc87eb50fa7e86e13ad`.

- `be981958` — `fix(vocab): retain nested failure coverage`: retain enclosing
  results for coverage attribution while keeping deduplicated leaves for failure
  counting and expected-path checks. Regression checks replace the Valuation
  negative with a nested MonetaryAmount failure, remove the standalone helper
  negative, and verify both shapes remain covered. Wrong wrapper paths, multiple
  leaf failures and unrelated helper failures remain rejected.
- `85333da5` — `fix(vocab): include subclasses in fixture coverage`: follow
  transitive `rdfs:subClassOf` links in fixture data for class targets, matching
  the installed validator. Positive/negative pairs using direct and transitive
  subclasses pass; unrelated classes cannot supply coverage.
- `docs: record coverage attribution fix results` — this round's status update.

Both regressions reproduced the review findings before their respective fixes:
the nested failure lost ValuationShape negative coverage, and the subclass pair
lost both positive and negative BookmarkShape coverage. Tests use temporary
copies, `@rdfjs/wrapper` accessors and `n3.Parser` / `n3.Writer`.

Commands use `PATH=/opt/node24/bin:$PATH` (Node `v24.22.1`, pnpm `10.4.1`):

| Exact command | Result |
| --- | --- |
| `node packages/solid-federation-vocab/scripts/test-shacl-fixtures.mjs` | PASS after each fix; FAIL as expected before each fix. |
| `pnpm exec biome check --write packages/solid-federation-vocab/scripts/shacl-fixtures.mjs packages/solid-federation-vocab/scripts/test-shacl-fixtures.mjs` | PASS; formatted the regression checks. |
| `pnpm --filter @jeswr/solid-federation-vocab run gate` | PASS: lint, build, typecheck, test and ontology; 179 fixtures across 14 sectors and all regression checks. |
| `TURBO_SCM_BASE=8912474e71e3850e15fa2fc87eb50fa7e86e13ad pnpm run gate` | PASS: root lint and all affected tasks; 5 successful / 5 total. |
| `pnpm run gate:full` | FAIL at `//#test:root`: 161 failed / 739 passed tests across the same four unchanged root files listed above, with empty subprocess diagnostics. Turbo stopped after 33 successful / 196 total tasks. |
| `git diff --check` and `git diff --check 8912474e71e3850e15fa2fc87eb50fa7e86e13ad..HEAD` | PASS. |

No dependencies, profiles or permanent fixture data changed. No new design
questions or unfinished implementation work remain. `roborev` and the optional
ROBOT/HermiT reasoner remain unavailable as documented above; ontology parsing
and term hygiene passed. The full-workspace gate remains an external verification
limit; root scripts, tests and guardrails are unchanged from this round's base.
No push, PR, branch switch or fetch/merge was performed.

## Fix round 3 — helpers reached through property shapes

Base: `67198ef08c5e7175c202d78b1caeed6bebd77e1e`.

- `c70dedfa` — `fix(vocab): cover helpers reached through properties`: follow
  owning `sh:property` relationships as well as `sh:node` callers and evaluate
  each caller's value nodes with the installed SHACL validator's path evaluator.
  Each traversal branch keeps its own visited set so shared owners remain
  reachable through different properties.
- `docs: record property helper coverage fix results` — this round's status update.

The regression removes MonetaryAmountShape's direct target from a temporary
collectibles profile and removes its standalone negative fixture. Both positive
coverage and the nested Valuation negative now pass through property paths alone.
It also verifies that an unlinked amount cannot supply negative coverage and
that amounts without targeted callers cannot supply positive coverage. The
unchanged validator reproduced both missing helper coverage errors before the
fix. No permanent profiles or fixture data changed.

Commands use `PATH=/opt/node24/bin:$PATH` (Node `v24.22.1`, pnpm `10.4.1`):

| Exact command | Result |
| --- | --- |
| `node packages/solid-federation-vocab/scripts/test-shacl-fixtures.mjs` (new regression before the fix) | FAIL as expected: MonetaryAmountShape had neither positive nor negative fixture coverage. |
| `pnpm exec biome check --write packages/solid-federation-vocab/scripts/shacl-fixtures.mjs packages/solid-federation-vocab/scripts/test-shacl-fixtures.mjs` | PASS; formatted both changed scripts. |
| `pnpm exec biome check packages/solid-federation-vocab/scripts/shacl-fixtures.mjs packages/solid-federation-vocab/scripts/test-shacl-fixtures.mjs` | PASS. |
| `pnpm --filter @jeswr/solid-federation-vocab run gate` | PASS: lint, build, typecheck, test and ontology; 179 fixtures across 14 sectors and all regression checks. |
| `TURBO_SCM_BASE=67198ef08c5e7175c202d78b1caeed6bebd77e1e pnpm run gate` | PASS: root lint and all affected tasks; 5 successful / 5 total. |
| `pnpm run gate:full` | FAIL at `//#test:root`: 162 failed tests across the same four unchanged root files listed above (empty subprocess diagnostics and a timeout). Turbo stopped after 61 successful / 230 total tasks. |
| `git diff --check` and `git diff --check 67198ef08c5e7175c202d78b1caeed6bebd77e1e..HEAD` | PASS. |

No dependencies were added, so `check:packages` is not applicable. No new design
questions or unfinished implementation work remain. The full-workspace gate
remains an external verification limit; root scripts, tests and guardrails are
unchanged from this round's base. `roborev` and its post-commit hook remain
unavailable; the repository's
[`roborev-review` skill](skills/roborev-review/SKILL.md) was consulted, but no
automated review verdict is claimed. The optional ROBOT/HermiT consistency check
was skipped because the reasoner is unavailable; ontology parsing and term
hygiene passed. No push, PR, branch switch or fetch/merge was performed.
