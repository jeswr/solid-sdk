<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-jhl3 — fix round 4

Branch: `lane/sst-jhl3`.
Base: `917d3be9c7967622829adc43c1aaabb0964ec993`.
Resumed at: `5ba9dd4f77409c3ba3e5c3684f4ea55608894cc8`.
Review: `solid-sdk-lane-sst-jhl3-5ba9dd4f7740.md`, read in full alongside
the original brief and fix rounds 1–4.

## Changes by commit

- `9c02cacc` — `fix: normalize negative-zero UTC offsets`: normalize
  `-00:00` to `+00:00` before dateTime assertion hashing. Add two independent
  RDFlib 7.1.4 assertion ID and graph fixtures, including fractional seconds,
  with matching inputs in the fixture generator. Regressions cover template
  round trips and shared assertion graphs across `-00:00`, `+00:00` and `Z`
  through raw RDF/JS and Turtle builds, TriG serialization and parsing.
- `docs: record fourth review fix` — this final STATUS-only commit.

Only the reviewed negative-zero UTC finding and its regression tests changed.
The existing handling of timezone-less values, nonzero offsets and fractional
precision is preserved.

## Validation

Node `v24.22.1`, pnpm `10.4.1`. Checks ran before the final commit:

| Exact command | Result |
| --- | --- |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm --filter @jeswr/rdf-serialize run build` | PASS; build workspace dependency declarations first. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm --filter @jeswr/pkg-memory run lint && pnpm --filter @jeswr/pkg-memory run build && pnpm --filter @jeswr/pkg-memory run typecheck && pnpm --filter @jeswr/pkg-memory run test` | PASS; 4 test files, 182 tests. Coverage: 100% statements (530), branches (402), functions (64), and lines (445). Test log: `/tmp/sst-jhl3-fix4-package-tests.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run lint:root` | PASS, exit 0; Biome and transport/workspace/fetch guards. Log: `/tmp/sst-jhl3-fix4-lint-root.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate` | PASS, exit 0; all 7 tasks, including 182 package tests and 26 root tests. Log: `/tmp/sst-jhl3-fix4-gate.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run gate:full` | FAIL, exit 1; existing `@jeswr/unstorage-solid#build` invokes a GitHub clone. The temporary git guard refuses it with exit 97 before any clone runs. 2 successful / 31 reported tasks. Log: `/tmp/sst-jhl3-fix4-gate-full.log`. |
| `git diff --check` | PASS. |
| `roborev status` | Unavailable, exit 127: `roborev: command not found`. No automated review verdict is claimed. |

Before the fix, the targeted command
`pnpm --filter @jeswr/pkg-memory exec vitest run test/ids.test.ts test/temporal.test.ts --coverage.enabled=false`
failed six tests: the independent Python ID oracle, two template bounds and
three shared-graph cases. Log: `/tmp/sst-jhl3-fix4-regression-red.log`.
All final tests pass, including the existing five synthetic Python nanopub
fixtures and complete-dataset parity checks.

The two new oracle rows were generated using the unmodified reference builder
at `/home/runner/work/solid-sdk-lanes/_sources/knowledge-graph/pipeline/np_builder.py`
and the existing `/tmp/sst-jhl3-python/bin/python` environment, verified as
RDFlib `7.1.4`. Only those rows were appended; previous fixture outputs were
retained. Inputs use fictional `example.org` IRIs and contain no pilot data.

No dependencies or manifests changed; no dependency policy check or installation
was needed. Lifecycle scripts remained disabled. No push, PR, branch switch,
remote fetch/merge, publishing, or other checkout edit occurred. The temporary
git guard was reused from prior rounds and prevented the full gate's remote
clone; repository build helpers were not modified.

## Unfinished work and open questions

The single review finding is fixed with regression coverage. Full-workspace
gate completion remains blocked by the unrelated clone helper, and per-commit
roborev review remains unavailable in this sandbox. No product work or open
question remains for this fix brief.
