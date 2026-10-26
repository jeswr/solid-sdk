<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-jhl3 — fix round 6

Branch: `lane/sst-jhl3`.
Base: `917d3be9c7967622829adc43c1aaabb0964ec993`.
Resumed at: `ab7b771f8c8292748213367f08d88d681632c016`.
Review: `solid-sdk-lane-sst-jhl3-ab7b771f8c82.md`, read in full alongside
all available original, round-2 and fix-round briefs. The integrator's final
round-6 convergence decisions govern findings 1 and 3.

## Changes by commit

- `99fcb740` — `fix: reject unsupported literal forms`: enforce the explicit
  datatype allowlist (`xsd:string`, `rdf:langString`, `xsd:integer`,
  `xsd:decimal`, `xsd:boolean`, `xsd:dateTime`, `xsd:date`, `xsd:gYear`,
  `xsd:gYearMonth`). Export `UnsupportedLiteralDatatypeError` with its datatype
  IRI and `UnsupportedLiteralCharacterError` with its numeric code point, both
  extending `TypeError`. Reject every other datatype and all eight specified
  Python line separators before normalization or hashing. Enforce the same
  literal policy for raw RDF/JS assertions, Turtle input, templates, batch
  metadata, TriG input and serialization of mutable caller datasets. Remove
  unreachable derived-integer and floating-point normalization branches.
  Add 56 regression cases covering accepted normalization, unsupported datatype
  families/custom IRIs, all forbidden separators at the beginning/middle/end
  of every allowed datatype, and metadata/input/output boundaries. Document the
  policy; retain the independent historical Python oracle data, with its three
  unsupported cases now asserting typed rejection.
- `8f362a16` — `fix: retain audit data for empty claim batches`: explicitly
  return the completed dataset and `nanopubs: []` for `claims: []`. Add two
  regressions for minimal batches and all-sensitive extractions, checking
  worker/activity, sources, entities, skipped categories, source links, notes,
  timestamps and serialization. Conservatively retain the existing requirement
  for at least one nanopub head in `parseNanopublications`; document using an
  RDF parser to read metadata-only TriG.
- `docs: record sixth review fixes` — this final STATUS-only commit.

Only the three reviewed findings, their tests and their documentation changed.
No strategy or unrelated implementation changes were made.

## Validation

Node `v24.22.1`, pnpm `10.4.1`, installed Vitest `4.1.10`.
Checks ran against the final implementation before the final commit:

| Exact command | Result |
| --- | --- |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm --filter @jeswr/rdf-serialize run build` | PASS; build workspace dependency declarations first. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm --filter @jeswr/pkg-memory run lint && pnpm --filter @jeswr/pkg-memory run build && pnpm --filter @jeswr/pkg-memory run typecheck && pnpm --filter @jeswr/pkg-memory run test` | PASS; 5 test files, 284 tests. Coverage: 100% statements (555), branches (410), functions (69), and lines (465). Test log: `/tmp/sst-jhl3-fix6-package-tests.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run lint:root` | PASS, exit 0; Biome and transport/workspace/fetch guards. Log: `/tmp/sst-jhl3-fix6-lint-root.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate` | PASS, exit 0; all 7 tasks, including 284 package tests and 26 root tests. Log: `/tmp/sst-jhl3-fix6-gate.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run gate:full` | FAIL, exit 1; existing `@jeswr/unstorage-solid#build` attempts a GitHub clone. The temporary git guard refuses it with exit 97 before any clone runs. 11 successful / 40 reported tasks. Log: `/tmp/sst-jhl3-fix6-gate-full.log`. |
| `git diff --check` and `git diff --cached --check` | PASS. |
| `roborev status` | Unavailable, exit 127: `roborev: command not found`, including after both implementation commits. No automated review verdict is claimed. |

After building the workspace dependency, the pre-implementation targeted command
`pnpm --filter @jeswr/pkg-memory exec vitest run test/literal-policy.test.ts test/model.test.ts --coverage.enabled=false`
failed 46 tests and passed 40. Log: `/tmp/sst-jhl3-fix6-regression-red.log`.
The same command passed all 86 tests after implementation. Log:
`/tmp/sst-jhl3-fix6-regression-green.log`. The final package gate includes the
subsequent exported-error assertions and all existing supported Python ID,
complete-dataset and temporal parity fixtures.

No dependencies or manifests changed; no dependency policy check or installation
was needed. Lifecycle scripts remained disabled. Existing synthetic fixtures were
reused without regeneration. No private pilot data was used. No push, PR, branch
switch, remote fetch/merge, publishing or other checkout edit occurred. The
existing temporary git guard prevented the full gate's remote clone; repository
build helpers were not modified.

## Unfinished work and open questions

All three review findings are fixed with regression coverage. Full-workspace
gate completion remains blocked by the unrelated clone helper, and per-commit
roborev review remains unavailable in this sandbox. No product work or open
question remains for this fix brief. Empty-batch support is confined to the
builder's explicit `claims: []` path; strict nanopub parsing is unchanged.
