<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-jhl3 — MCP-04 lane status, round 2

Branch: `lane/sst-jhl3`.
Base: `917d3be9c7967622829adc43c1aaabb0964ec993`.

## Outcome

Implemented `@jeswr/pkg-memory`. The three acceptance criteria pass:

- Eight typed fact templates round-trip through build → TriG → parse: address,
  email, phone, preference, condition, allergy, medication, relationship.
- Five fictional fact inputs match the unmodified Python reference builder's
  nanopub, assertion, provenance and pubinfo IDs byte-for-byte. The complete
  223-quad dataset is graph-isomorphic to its expected output.
- IRI/literal injection and malformed-dataset tests pass, including graph-scoped
  provenance reads, datatype injection, unsupported schemes and invalid statuses.

The implementation includes the reference UUIDv5 namespace and name construction,
RDFlib-style canonical assertion hashing/skolemization, shared assertion graphs,
all seven epistemic and five validity statuses, OA quote/fragment evidence,
DPV categories, batch source/entity metadata, message IDs, revision/contradiction
links, inference activities and intentionally withheld-value metadata. RDF writes
use wrapper accessors, parsing uses fetch-rdf, and serialization uses rdf-serialize.
The private Node >=24 package has documentation, a local skill, a testing subpath,
workspace dependency/lockfile entries and a suite.json entry. No dist is committed.

## Commits

Round 2:

- `f749a45f` — `test: add synthetic Python nanopub fixtures`: independent synthetic
  inputs/outputs, regeneration script, and the resolved source-location question.
- `7c427c60` — `feat: implement PKG nanopubs and fact templates`: package, model,
  eight templates, TriG reader/writer, documentation and workspace registration.
- `4a67aa46` — `test: verify nanopub parity and injection safety`: template,
  provenance, deduplication, canonicalization and adversarial tests.
- `b52c332b` — `fix: retain tied canonicalization candidates`: retain tied
  candidates and prefer a discrete candidate as the reference does; document
  the limitations of arbitrary symmetric raw assertions.
- `docs: record completed MCP-04 lane status` (this final commit).

Round 1's source-blocker records remain in `95be8c48` and `d00996d1`.
Question 1 in QUESTIONS.md is resolved by the supplied local sources and explicit
permission to replace private pilot fixtures with synthetic fixtures.

## Validation

Node `v24.22.1`, pnpm `10.4.1`. These checks ran before this final commit:

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/rdf-serialize run build` | PASS; dependency declarations built before package checks. |
| `pnpm --filter @jeswr/pkg-memory run lint && pnpm --filter @jeswr/pkg-memory run build && pnpm --filter @jeswr/pkg-memory run typecheck && pnpm --filter @jeswr/pkg-memory run test` | PASS; 3 test files, 63 tests; 100% statements (488), branches (328), functions (62), and lines (412). Test log: `/tmp/sst-jhl3-final-package-gate.log`. |
| `pnpm run lint:root` | PASS, exit 0; Biome, transport, workspace and fetch guards. Log: `/tmp/sst-jhl3-round2-lint-root.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate` | PASS, exit 0; 7 successful tasks, including 26 root tests and the package checks. Final log: `/tmp/sst-jhl3-final-gate.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run gate:full` | FAIL, exit 1; existing `@jeswr/unstorage-solid#build` tries to clone fetch-rdf from GitHub. The temporary git guard refused that prohibited operation with exit 97 before any clone ran. Final run: 21 successful / 55 reported tasks. Log: `/tmp/sst-jhl3-final-gate-full.log`. |
| `pnpm install --offline --frozen-lockfile --ignore-scripts --cache-dir /tmp/sst-jhl3-pnpm-cache` | PASS; committed lockfile resolves without unrelated importer changes. |
| `git diff --check` | PASS. |
| `roborev status` | Unavailable, exit 127: `roborev: command not found`. No automated review verdict is claimed. |

The temporary PATH wrapper permits normal git reads and refuses clone/fetch/pull/
push/merge from build helpers. No repository build helper was modified. The full
workspace failure is outside this lane's package. No network git operation ran in
round 2; no pushes, PRs, branch switches, publishing or other checkout edits occurred.

## Dependency policy and fixtures

Before manifest additions:

- `pnpm run check:packages @jeswr/fetch-rdf @rdfjs/wrapper @rdfjs/types n3 @types/n3 @vitest/coverage-v8 rdf-isomorphic`
  — PASS, all 7 packages cleared.
- `pnpm run check:packages @biomejs/biome typescript vitest`
  — PASS, all 3 packages cleared.

All versions already existed in the workspace lockfile. `pnpm install --ignore-scripts
--cache-dir /tmp/sst-jhl3-pnpm-cache` passed. An initial offline install lacked pnpm
metadata and failed before resolution; the subsequent frozen offline install passed.
Lifecycle scripts remained disabled.

Fixture generation used isolated `/tmp/sst-jhl3-python` with RDFlib `7.1.4`:

```sh
/tmp/sst-jhl3-python/bin/python packages/pkg-memory/test/generate-fixtures.py /home/runner/work/solid-sdk-lanes/_sources/knowledge-graph/pipeline/np_builder.py
```

The generator invokes the unmodified reference CLI. Its source SHA-256 is
`5b0354f60a53e3d2e5fc2254d124548281e4ca20e97bf17b7d06e0f152a89403`.
Only publication-generation timestamps are fixed after the reference run; IDs
and other graph content are preserved. All five inputs, their worker and their
sources are synthetic. No pilot dependencies or registry were needed, so no
pilot file was imported or stubbed. No real names, emails or WebIDs occur in
fixtures; person/entity/source IRIs use example.org. Standard vocabulary IRIs
retain their normative namespaces. Eleven additional committed canonicalization
oracles cover cycles, symmetry, escaping, language, typed values and Unicode.
Tests run offline without Python or the private reference source.

## Conservative choices and remaining limits

- The advertised MCP-01 scaffold is absent in this base, so only the required
  pkg-memory package was created; other W9 scaffolds were left to their lanes.
- The owner WebID is required explicitly. Source paths are metadata; source
  hashes must be supplied rather than implicitly reading local files.
- Parsing returns graph-scoped nanopub metadata and the complete assertion
  dataset. It does not reverse arbitrary RDF into a guessed fact-template input.
- This model preserves the builder's optional evidence/category fields; it does
  not claim to implement the separate KG SHACL/forbidden-value validator.
- Templates use plain-string IDs. RDF/JS merges plain and explicit xsd:string
  literals, whereas the Python builder can hash their spellings differently.
- Some highly symmetric regular blank-node graphs have no stable Python oracle:
  an extra 60-graph synthetic probe showed 22 reference-to-reference ID differences
  on a later Python rerun. The five required facts and eleven committed edge-case
  oracles are stable and pass. Universal byte parity for arbitrary symmetric raw
  RDF is not claimed. A separate 210-graph synthetic probe matched all IDs.

No MCP-04 acceptance item remains unfinished. Full-workspace gate completion and
per-commit roborev review remain blocked by the existing helper and unavailable
tooling above. No new blocking product/design question is pending. Belief
classification, purpose filtering, and pod storage remain MCP-05's scope.
