<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-jhl3 — fix round 2

Branch: `lane/sst-jhl3`.
Base: `917d3be9c7967622829adc43c1aaabb0964ec993`.
Review: `solid-sdk-lane-sst-jhl3-b2189109765b.md`, read in full.

## Changes by commit

- `8c1172eb` — `fix: normalize numeric assertion literals`: normalize decimal
  scale, signed zero, all derived integer datatypes, and float/double spellings
  before canonical hashing. Preserve arbitrary-precision decimals and integers.
  Match RDFlib's distinct N-Triples and term encodings for non-finite floats.
  Add four independent Python canonicalization oracles and regeneration inputs.
- `0570a1b1` — `fix: order evidence timestamps by instant`: compare UTC instants
  across offsets, including microseconds within the same millisecond, and retain
  the selected timestamp's offset and normalized precision. Regression tests
  verify assertion generation and supersession invalidation through TriG, in
  both evidence orders, with positive/negative offsets and day boundaries.
- `3a6f50bc` — `fix: reject duplicate evidence selectors`: reject multiple
  TextQuoteSelectors or FragmentSelectors on one target instead of overwriting
  quote/locator fields. Regressions cover both triple orders, identical values,
  and an empty first value. Existing fixtures still round-trip a target with
  one selector of each type.
- `docs: record second review fixes` — this final STATUS-only commit.

Only the three reviewed findings and their regression fixtures/tests were
changed. The conservative selector choice rejects a second selector of the same
type even when its value matches; the scalar evidence API remains unchanged.

## Validation

Node `v24.22.1`, pnpm `10.4.1`. Checks ran before the final commit:

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/rdf-serialize run build` | PASS; build workspace dependency declarations first. |
| `pnpm --filter @jeswr/pkg-memory run lint && pnpm --filter @jeswr/pkg-memory run build && pnpm --filter @jeswr/pkg-memory run typecheck && pnpm --filter @jeswr/pkg-memory run test` | PASS; 3 test files, 70 tests, 100% statements (513), branches (371), functions (63), and lines (432). Test output: `/tmp/sst-jhl3-fix2-package-tests.log`. |
| `pnpm run lint:root` | PASS, exit 0; Biome and transport/workspace/fetch guards. Log: `/tmp/sst-jhl3-fix2-lint-root.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate` | PASS, exit 0; all 7 tasks, including 70 package tests and 26 root tests. Log: `/tmp/sst-jhl3-fix2-gate.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run gate:full` | FAIL, exit 1; existing `@jeswr/unstorage-solid#build` invokes a GitHub clone. The temporary git guard refuses it with exit 97 before any clone runs. 14 successful / 44 reported tasks. Log: `/tmp/sst-jhl3-fix2-gate-full.log`. |
| `git diff --check` | PASS. |
| `roborev status` | Unavailable, exit 127: `roborev: command not found`. No automated review verdict is claimed. |

The timestamp and selector regressions were run before their fixes: five tests
failed as expected, with 61 passing. Log:
`/tmp/sst-jhl3-fix2-regression-red.log`. All pass with the fixes.

The four numeric oracles were generated using the supplied unmodified reference
`/home/runner/work/solid-sdk-lanes/_sources/knowledge-graph/pipeline/np_builder.py`
and the existing isolated `/tmp/sst-jhl3-python/bin/python` (RDFlib 7.1.4).
Only the four new canonical cases were appended; earlier fixture outputs were
retained. The committed generator contains their reproducible inputs. Fixtures
contain no personal data and tests run offline without Python or private sources.

No dependencies or manifests changed; no dependency policy check or installation
was needed. Lifecycle scripts remained disabled. No push, PR, branch switch,
network git operation, publishing, or other checkout edit occurred. The temporary
git guard was reused from the preceding lane round; repository build helpers were
not modified.

## Unfinished work and open questions

All three review findings are fixed with regression coverage. Full-workspace gate
completion remains blocked by the unrelated clone helper, and per-commit roborev
review remains unavailable in this sandbox. No product work or open question
remains for this fix brief.
