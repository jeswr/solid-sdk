<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-jhl3 — fix round 5

Branch: `lane/sst-jhl3`.
Base: `917d3be9c7967622829adc43c1aaabb0964ec993`.
Resumed at: `ef65896c7192e263f83a0c54b4cc4e022a9462ba`.
Review: `solid-sdk-lane-sst-jhl3-ef65896c7192.md`, read in full alongside
the original brief and fix rounds 1–5.

## Changes by commit

- `66c470ca` — `fix: match RDFlib temporal normalization`: normalize
  timezone-less dateTime fractions before hashing assertions, retaining absent
  timezones. Match RDFlib 7.1.4 microsecond padding/truncation, zero-fraction
  removal, and UTC forms. Normalize date, gYear, and gYearMonth timezone forms
  without shifting calendar values. Preserve lexical forms that Python cannot
  represent, including year zero and `24:00:00`. Add 40 independent Python
  fixture cases covering 97 lexical inputs, expected literals, assertion IDs,
  and graphs, plus the isolated fixture generator. Regressions check direct
  canonicalization, raw RDF/JS and Turtle builds, assertion deduplication,
  template bounds, TriG serialization and parsing, and distinct IDs for local
  dateTimes versus timezone-bearing instants. Update previous lexical
  expectations to the explicit round-5 design call.
- `docs: record fifth review fix` — this final STATUS-only commit.

Only the reviewed temporal normalization finding and its regression fixtures,
tests, and fixture documentation changed. Existing input-validation boundaries
are retained.

## Validation

Node `v24.22.1`, pnpm `10.4.1`. Checks ran before the final commit:

| Exact command | Result |
| --- | --- |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm --filter @jeswr/rdf-serialize run build` | PASS; build workspace dependency declarations first. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm --filter @jeswr/pkg-memory run lint && pnpm --filter @jeswr/pkg-memory run build && pnpm --filter @jeswr/pkg-memory run typecheck && pnpm --filter @jeswr/pkg-memory run test` | PASS; 4 test files, 226 tests. Coverage: 100% statements (546), branches (427), functions (65), and lines (458). Test log: `/tmp/sst-jhl3-fix5-package-tests.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run lint:root` | PASS, exit 0; Biome and transport/workspace/fetch guards. Log: `/tmp/sst-jhl3-fix5-lint-root.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate` | PASS, exit 0; all 7 tasks, including 226 package tests and 26 root tests. Log: `/tmp/sst-jhl3-fix5-gate.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run gate:full` | FAIL, exit 1; existing `@jeswr/unstorage-solid#build` invokes a GitHub clone. The temporary git guard refuses it with exit 97 before any clone runs. 28 successful / 155 reported tasks. Log: `/tmp/sst-jhl3-fix5-gate-full.log`. |
| `git diff --check` | PASS. |
| `roborev status` | Unavailable, exit 127: `roborev: command not found`, including after the implementation commit. No automated review verdict is claimed. |

Before implementation, the targeted command
`pnpm --filter @jeswr/pkg-memory exec vitest run test/temporal.test.ts test/model.test.ts --coverage.enabled=false`
failed 25 tests after the workspace dependency build. Log:
`/tmp/sst-jhl3-fix5-regression-red.log`. The same command passed all 150 tests
after implementation. Log: `/tmp/sst-jhl3-fix5-regression-green.log`.
The final package gate also passes the existing five synthetic Python nanopub
fixtures and complete-dataset parity checks.

The new oracle was generated with
`/tmp/sst-jhl3-python/bin/python packages/pkg-memory/test/generate-temporal-fixtures.py /home/runner/work/solid-sdk-lanes/_sources/knowledge-graph/pipeline/np_builder.py`.
The existing isolated environment was verified as RDFlib `7.1.4`; the generator
enforces that version and imports the unmodified reference builder. Expected
values, IDs, and graphs are computed entirely in Python. Only the new
`temporal.json` was generated, then formatted with
`pnpm exec biome format --write packages/pkg-memory/test/fixtures/temporal.json`.
All entity IRIs are fictional `example.org` values; no pilot data was used.

No dependencies or manifests changed; no dependency policy check or installation
was needed. Lifecycle scripts remained disabled. No push, PR, branch switch,
remote fetch/merge, publishing, or other checkout edit occurred. The temporary
git guard was reused from earlier rounds and prevented the full gate's remote
clone; repository build helpers were not modified.

## Unfinished work and open questions

The single review finding is fixed with regression coverage. Full-workspace
gate completion remains blocked by the unrelated clone helper, and per-commit
roborev review remains unavailable in this sandbox. No product work or open
question remains for this fix brief.
