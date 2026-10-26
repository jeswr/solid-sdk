<!-- AUTHORED-BY Codex GPT-6 -->

# sst-jhl3 — fix round 7

Branch: `lane/sst-jhl3`.
Base: `917d3be9c7967622829adc43c1aaabb0964ec993`.
Resumed at: `1c407ee887cf3a1c4d4e1c06da20779ff96c4fb9`.
Review: `/home/runner/work/solid-suite-tracker/lanes/reviews/solid-sdk-lane-sst-jhl3-1c407ee887cf.md`,
read in full alongside the original and all earlier fix briefs. The integrator's
2026-10-26 final convergence decisions govern all three findings.

## Changes by commit

- `1826804c` — `fix: validate terms before nanopub serialization`: share the
  builder's existing IRI and language-tag guards with serialization. Check
  subjects, predicates, objects, graph names and literal datatypes before the
  Writer sees the mutable dataset. Add five position-based regression cases
  covering injection delimiters, embedded and trailing controls, unsupported
  schemes and relative IRIs. Extend the ten malformed-tag cases and the
  tagless `rdf:langString` case to cover serialization of caller mutations in
  audit and default graphs.
- `829e8e69` — `fix: preserve reference language tag spelling`: retain tag
  spelling through parsing, canonicalization, graph storage and TriG round
  trips. `fetch-rdf` remains the parsing/validation boundary; because it exposes
  no factory option, language-bearing input is replayed with a preserving N3
  factory. N3 stores use that factory too, since they recreate literals on reads.
  Add eight independent RDFlib 7.1.4 language oracles for named and blank
  subjects, including `EN-US`, `en-US`, `en-us` and `zh-Hant-TW`, plus a regression
  with matching text in separately named graphs. Check raw RDF/JS and Turtle
  inputs, reference IDs and skolem nodes, exact tag spelling and repeated
  serialization.
- `546c2e4d` — `fix: reject noncanonical scalar literal forms`: require canonical
  scalar spellings before hashing or emitting literals. Export
  `UnsupportedLiteralLexicalFormError`, extending `TypeError` with a datatype
  IRI property. Reject noncanonical and invalid integers, decimals and booleans
  at raw assertion, Turtle, template, TriG and mutable serialization boundaries;
  remove the superseded numeric coercion and dose-validation branches. Keep
  plain strings and language strings unchanged and retain the four temporal
  normalizers. Add 74 independent Python scalar fixtures (21 accepted and 53
  rejected), including `TRUE` and `1E3`, and 76 scalar regression tests. Retain
  historical oracle data, updating affected cases to expect typed rejection.
  Document the exact lexical policy and serialization checks.
- `docs: record seventh review fixes` — this final STATUS-only commit.

The conservative interpretation of canonical decimal spelling is RDFlib's stable
fixed-point spelling: fractional scale and signed zero remain significant
(`2.00`, `-0` and `-0.00` are accepted). Numeric whitespace, plus signs, padded
integers, exponent notation, shorthand fractions, `1`/`0` booleans and invalid
scalar values are rejected rather than coerced. The established plain-string
contract remains documented: RDF/JS merges plain strings and explicit
`xsd:string`; string oracle inputs therefore use plain literals.

Only the three findings, their regression tests, fixtures and documentation were
changed. No new strategy, dependency or unrelated implementation change was made.

## Validation

Node `v24.22.1`, pnpm `10.4.1`, installed Vitest `4.1.10`.
The following gates ran against the final implementation before the final commit:

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/rdf-serialize run build` | PASS; prepare the existing workspace dependency's declarations. |
| `pnpm --filter @jeswr/pkg-memory run lint && pnpm --filter @jeswr/pkg-memory run build && pnpm --filter @jeswr/pkg-memory run typecheck && pnpm --filter @jeswr/pkg-memory run test` | PASS; 7 files, 374 tests. Coverage: 100% statements (568), branches (402), functions (76), lines (475). Test log: `/tmp/sst-jhl3-fix7-package-tests.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run lint:root` | PASS, exit 0; Biome and transport/workspace/fetch guards. Log: `/tmp/sst-jhl3-fix7-lint-root.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate` | PASS, exit 0; all 7 tasks, including 374 package tests and 26 root tests. Log: `/tmp/sst-jhl3-fix7-gate.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run gate:full` | FAIL, exit 1; the existing `@jeswr/unstorage-solid#build` helper attempts a GitHub clone. The temporary git guard rejects it with exit 97 before the clone runs. 23 successful / 74 reported tasks. Log: `/tmp/sst-jhl3-fix7-gate-full.log`. |
| `git diff --check` and `git diff --cached --check` | PASS. |
| `roborev status` | Unavailable, exit 127: `roborev: command not found`, checked after each implementation commit. No automated review verdict is claimed. |

Targeted security tests passed 77 cases for the first implementation commit.
Language and security tests passed all 86 cases for the second commit. The final
package gate includes these regressions, the 76 new scalar cases, all existing
supported Python ID and complete-dataset oracles, and all temporal parity cases.

Generated the new synthetic literal fixtures with the pre-existing isolated
Python environment, using its verified RDFlib 7.1.4 and the unmodified reference:

```sh
/tmp/sst-jhl3-python/bin/python packages/pkg-memory/test/generate-literal-fixtures.py /home/runner/work/solid-sdk-lanes/_sources/knowledge-graph/pipeline/np_builder.py
pnpm --filter @jeswr/pkg-memory exec biome check --write test/fixtures/literal-parity.json
```

No Python or JavaScript dependencies were installed. No manifests or lockfiles
changed, so no dependency policy check was necessary. Lifecycle scripts remained
disabled. Existing synthetic and temporal fixtures were not regenerated. No
private pilot data was used. No push, PR, branch switch, remote fetch/merge,
publishing or other checkout edit occurred. The existing temporary git guard
prevented the full gate's remote clone; repository build helpers were unchanged.

## Unfinished work and open questions

All three review findings are fixed with regression coverage. Full-workspace
gate completion remains blocked by the unrelated clone helper; per-commit
roborev review remains unavailable in this sandbox. No implementation work or
open question remains for this brief. Any further parity edge is follow-up
tracker scope under the integrator's convergence instruction.
