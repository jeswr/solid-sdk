<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-vcij — MCP-05 lane report

Branch: `lane/sst-vcij`. Base: `6323e7ec0bd7a9dc7cf1a1426db29c8634773044`.

## Commits

- `565bdd13` — `feat(pkg-memory): classify beliefs and filter purposes`:
  KG §4.1 belief views, graph-scoped invalidation, revision/contradiction awareness,
  corroboration, local DPV special-category detection, per-client ODRL purpose
  filtering, default policy model, status and deny/permit matrix tests.
- `9c9627c8` — `feat(pkg-memory): store private nanopubs through PodPort`:
  structural PodPort seam and memory fake; ACL-first owner-only containers;
  separate create-only TriG resources, verified byte-preserving octet-stream
  fallback, ETag protection, scoped listing, append-only retractions, default
  policy document writer, microsecond chronology, and storage/security tests.
- Final documentation commit — `docs: record sst-vcij lane validation`:
  this report, committed last after the required gates.

## Validation

All commands ran in this checkout with Node v24.22.1 and pnpm 10.4.1.

| Exact command | Result |
| --- | --- |
| `pnpm install --ignore-scripts --offline` | PASS; lockfile updated for one workspace dependency; existing workspace peer warnings only; lifecycle scripts stayed disabled. |
| `pnpm exec turbo run build --filter=@jeswr/pkg-memory...` | PASS; four dependency-first builds. |
| `pnpm --filter @jeswr/pkg-memory run lint` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run build` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run typecheck` | PASS, including tests. |
| `pnpm --filter @jeswr/pkg-memory run test` | PASS; 10 files, 427 tests; 100% statements, branches, functions, and lines. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=6323e7ec0bd7a9dc7cf1a1426db29c8634773044 pnpm run gate` | PASS; 9 successful tasks, including 686 root tests. |
| `pnpm run gate:full` | FAIL outside this lane; 213 successful tasks before `@jeswr/federation-codegen#test` stopped the run (2 failed, 23 passed tests). |
| `git diff --check` | PASS. |

The full gate failures are in `tools/federation-codegen/test/generator.test.ts`:
the Bookmark target-class expectation still uses `https://w3id.org/jeswr/sectors/bookmarks#Bookmark`,
while the ontology/SHACL inputs use `https://jeswr.org/ns/sectors/bookmarks#Bookmark`;
the committed generated `ontology.ttl` has the same namespace drift. The tool,
generated fixtures, and vocabulary inputs are unchanged from the base commit
(verified with `git diff <base> --exit-code` on those paths). No unrelated fixes
were made. The full-workspace gate is therefore not green.

## Dependency policy

- `pnpm run check:packages @jeswr/solid-odrl @jeswr/solid-mcp --mode policy`:
  PASS, two names cleared. Only `@jeswr/solid-odrl` was added, as `workspace:*`;
  PodPort remains a structural interface to avoid a server dependency.
- `pnpm run check:packages @solid/object --mode policy`: PASS; considered existing
  RDF wrapper reuse, but no dependency was added. Existing `@rdfjs/wrapper`
  accessors cover this package's graph writes and reads.
- No third-party dependency or version was added or changed.

## Remaining verification and questions

- [QUESTIONS.md](QUESTIONS.md) records five ambiguities and the conservative
  readings taken: one belief level with past/revision precedence; the two named
  purposes and explicit category matching; the specified WAC `.acl` convention
  and conditional fallback; missing pilot/query inputs; no invented scheduling
  category (contact/preferences used for scheduling remain permitted).
- The supplied KG snapshot contains DESIGN, shapes, vocabulary, and builder, but
  no `pipeline/queries/*.rq` or private pilot. Tests cover the full status matrix
  and the existing independently generated fictional Python oracle; exact
  query/pilot parity remains unverified. No private data was imported.
- TriG acceptance, rejection and rewriting are simulated on the memory PodPort.
  Live CSS/sparq validation was not run under this lane's fixture-only rule.
- `roborev` is not installed in this environment, so its required independent
  per-commit reviews could not run. The implementation was inspected locally;
  automated review remains outstanding.
- No pushes, remote fetches/merges, PRs, publications, tracker changes, or edits
  to other checkouts were performed.

## Fix round 1 — four review findings

Fix base: `f2d20696d0f11527c475819d3918082533a88968`; branch remains `lane/sst-vcij`.

- `a067b11b` — `fix(pkg-memory): reject lossy policy parsing`: validate the
  complete stored policy against the evaluator's supported RDF subset before
  accepting its projection. Unknown/malformed duties and constraints, dropped
  party/target fields, ambiguous scalar fields, and additional policy graphs
  reject. Includes the concurrent policy-creation read path and deny/permit tests.
- `5a8ec0e7` — `fix(pkg-memory): preserve shared ancestor ACLs`: retain existing
  ancestor containers and ACL bytes/ETags, including pre-existing ACLs on missing
  ancestors. Replace owner-only ACLs only for this store's `mcp/` container and
  policy resource. The policy now has a dedicated ACL before its first write.
- `f37df1d8` — `fix(pkg-memory): honor explicit revision links`: treat explicit
  revisions as authoritative, as the review permits, independently of extraction
  timestamps. A cross-batch regression covers newer source statements extracted
  before older statements; equal-clock withdrawals remain valid.
- `a7cc68a1` — `fix(pkg-memory): retain withdrawn assertion identity`: construct
  the withdrawal envelope with the original assertion graph, IRI, and skolem
  nodes; preserve original resource bytes and shared-assertion corroboration.
  Regression cases cover email, preference, and nested medication assertions.
- Final documentation commit — `docs: record sst-vcij fix validation`: this report.

Conservative readings: unsupported policy extensions (including profiles and
delegation) reject rather than being partly interpreted; explicit revision links
order statements without relying on publication metadata. No new design question
was introduced. The previously recorded pilot/live-server verification limits
remain outside this fix round.

### Fix validation

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/pkg-memory...` | PASS; dependency-first builds. |
| `pnpm --filter @jeswr/pkg-memory run lint` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run build` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run typecheck` | PASS, including tests. |
| `pnpm --filter @jeswr/pkg-memory run test` | PASS; 11 files, 476 tests; 100% statements, branches, functions, and lines. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=f2d20696d0f11527c475819d3918082533a88968 pnpm run gate` | PASS; 8 successful tasks. |
| `pnpm run gate:full` | FAIL outside this lane; 277 successful tasks before `@jeswr/federation-codegen#test` stopped the run (2 failed, 23 passed tests). Root tests: 686 passed. |
| `git diff --check f2d20696` | PASS. |

No dependencies, manifests, or lockfiles changed. All new tests use fictional
fixtures and the memory PodPort. `roborev` remains unavailable (`command -v
roborev` found no executable), so automated independent per-commit review could
not run. All four requested findings are implemented; no pushes, PRs, branch
switches, remote fetches/merges, or edits to other checkouts were performed.

The full gate reproduced the two namespace mismatches already documented above
in `tools/federation-codegen/test/generator.test.ts` (Bookmark target class and
generated ontology bytes). `git diff f2d20696 --exit-code` confirms that the tool
and `packages/solid-federation-vocab` inputs are unchanged from this fix round's
base. No unrelated fix was made. Generated web-public build artifacts were
removed before the final documentation commit; the working tree is clean.

## Fix round 2 — three review findings

Fix base: `60da98b9c11fa742e16b3b4d6f66ad53993e8914`; branch remains `lane/sst-vcij`.

- `45db1956` — `fix(pkg-memory): protect nanopub resource ACLs`: establish an
  owner-only ACL for each destination before writing private bytes. Replace
  orphan/public resource ACLs only with their strong ETag, create missing ACLs
  conditionally, and stop on ACL read/write failures or concurrent changes.
  Regressions cover all these cases and every resource in a multi-nanopub batch.
- `cebf38b6` — `fix(pkg-memory): recheck ACL-created containers`: recheck a
  previously absent container after its ACL write, avoiding a duplicate PUT when
  CSS creates it implicitly. Fixtures exercise first-run nanopub and policy
  writes, ACL-first ordering, and an unreadable container recheck.
- `9d040e80` — `fix(pkg-memory): scope withdrawals to nanopub targets`: retain
  the exact withdrawn nanopub identity in graph-scoped provenance alongside
  the shared assertion revision link. Classification uses that explicit target,
  allowing later identical facts to remain Current while keeping assertion
  deduplication and corroboration. Email, preference, and nested medication
  regressions cover reassertion, reversed input order, an omitted original,
  and a second withdrawal targeting the reassertion alone.
- Final documentation commit — `docs: record sst-vcij round two validation`:
  this report, committed last after the required gates.

Conservative compatibility choice: existing assertion-only revision links keep
their assertion-wide semantics; new withdrawals identify their target envelope.
No timestamp heuristic or history migration was added. No new design question
was introduced. Tests use fictional identities and the memory PodPort; CSS
implicit container creation is simulated under the lane's fixture-only rule.

### Round two validation

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/pkg-memory...` | PASS; four dependency-first builds. |
| `pnpm --filter @jeswr/pkg-memory run lint` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run build` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run typecheck` | PASS, including tests. |
| `pnpm --filter @jeswr/pkg-memory run test` | PASS; 11 files, 486 tests; 100% statements, branches, functions, and lines. |
| `pnpm run lint:root` (via the affected gate) | PASS. |
| `TURBO_SCM_BASE=60da98b9c11fa742e16b3b4d6f66ad53993e8914 pnpm run gate` | PASS; 8 successful tasks. |
| `pnpm run gate:full` | FAIL outside this lane; 284 successful tasks before `@jeswr/federation-codegen#test` stopped the run (2 failed, 23 passed tests). Root tests: 686 passed. |
| `git diff --check 60da98b9c11fa742e16b3b4d6f66ad53993e8914` | PASS. |

Targeted regression runs for each finding failed on the corresponding unfixed
code before passing with the fixes. No dependencies, manifests, or lockfiles changed.
`roborev` remains unavailable (`command -v roborev` found no executable), so
automated independent per-commit review remains outstanding. All three requested
findings are implemented. No pushes, PRs, branch switches, remote fetches/merges,
tracker changes, or edits to other checkouts were performed.

The full gate reproduced the previously documented namespace mismatches in
`tools/federation-codegen/test/generator.test.ts`: the Bookmark target class and
generated ontology bytes. `git diff 60da98b9c11fa742e16b3b4d6f66ad53993e8914 --exit-code --
tools/federation-codegen packages/solid-federation-vocab` passed, confirming the
tool and vocabulary inputs are unchanged from this fix round's base. No
unrelated fix was made. Generated web-public build artifacts were removed before
the final documentation commit; the working tree is clean.

## Fix round 3 — three review findings

Review/fix base: `41f981fd54e7bf818aeae20c198b500b7e0dcc60`; branch remains
`lane/sst-vcij`. The required affected-gate comparison remains
`60da98b9c11fa742e16b3b4d6f66ad53993e8914`.

- `7b7b5522` — `fix(pkg-memory): deny unavailable policy context`: deny policies
  requiring context beyond purpose and the implicit evaluation time, including
  prohibitions under every conflict strategy. Reject unparseable temporal
  operands, unsupported datatypes/operators, and malformed operand cardinality
  before evaluation. Regressions cover missing operands, RDF policy roundtrips,
  permission/duty context, policy edits, and valid purpose/time evaluation.
- `5ebe4277` — `fix(pkg-memory): deduplicate shared assertion graphs`: compare
  independently parsed assertion copies using their canonical fingerprint and
  retain one copy per shared graph during listing. Conflicting copies fail
  closed. Regressions preserve nested blank-node structures, whole-dataset
  isomorphism, corroboration, repeated reads, and reversed listing order.
- `0099dd54` — `fix(pkg-memory): index belief classification lookups`: read
  provenance once per nanopub and precompute replacements, inactivity,
  corroboration, and live contradiction indexes. Regressions bound provenance
  reads linearly at 24 and 48 unrelated nanopubs and cover multiple revisions,
  missing targets, and self-revisions; existing belief/withdrawal tests pass.
- Final documentation commit — `docs: record sst-vcij round three validation`:
  this report, committed last after all required gate runs.

Conservative policy choice: an unsupported context requirement denies the whole
policy for this filter, even when attached to an otherwise unrelated rule or
when the policy selects permission-wins conflict resolution. No context is
invented, and invalid time operands never reach the evaluator's lexical fallback.
No new design question was introduced.

### Round three validation

All commands ran in this checkout with Node v24.22.1 and pnpm 10.4.1.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/pkg-memory...` | PASS; four dependency-first builds. |
| `pnpm --filter @jeswr/pkg-memory run lint` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run build` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run typecheck` | PASS, including tests. |
| `pnpm --filter @jeswr/pkg-memory run test` | PASS; 11 files, 510 tests; 100% statements, branches, functions, and lines. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=60da98b9c11fa742e16b3b4d6f66ad53993e8914 pnpm run gate` | PASS; 9 successful tasks, including 686 root tests. |
| `pnpm run gate:full` | FAIL outside this lane; 261 successful tasks before `@jeswr/federation-codegen#test` stopped the run (2 failed, 23 passed tests). Root tests: 686 passed. |
| `git diff --check 41f981fd54e7bf818aeae20c198b500b7e0dcc60` | PASS. |

The full gate reproduced the two previously documented namespace mismatches in
`tools/federation-codegen/test/generator.test.ts`: the Bookmark target class and
generated ontology bytes. `git diff 60da98b9c11fa742e16b3b4d6f66ad53993e8914 --exit-code --
tools/federation-codegen packages/solid-federation-vocab` passed, confirming the
tool and vocabulary inputs are unchanged from the required lane base. No
unrelated fix was made. Generated web-public build artifacts were removed.

All three findings are implemented, with fixture-only regressions. No dependency,
manifest, or lockfile changed; no dependency policy check was needed. `roborev`
remains unavailable (`command -v roborev` found no executable), so independent
automated per-commit review remains outstanding. No pushes, PRs, branch switches,
remote fetches/merges, tracker changes, or edits to other checkouts were performed.
There are no new open questions; earlier pilot/live-server verification limits
remain as documented above.

## Fix round 4 — shared assertion references

Review/fix base: `b53cf05192b29684907005c4786185f903d777ad`; branch remains
`lane/sst-vcij`. The required affected-gate comparison remains
`60da98b9c11fa742e16b3b4d6f66ad53993e8914`.

- `c8cb72eb` — `fix(pkg-memory): preserve shared assertion references`: reuse
  canonical blank-node labels to map incoming duplicate assertions to the first
  retained graph. Apply the mapping to subjects, objects, and graph names across
  the incoming dataset before dropping its duplicate assertion graph. Keep
  unrelated blank nodes intact and preserve the public canonicalization result.
  Regressions cover three resources, nested assertion nodes, provenance subjects
  and objects, publication metadata, individual reads, repeated listings, and
  reversed listing order, including whole-dataset isomorphism.
- Final documentation commit — `docs: record sst-vcij round four validation`:
  this report, committed last after all required gate runs.

### Round four validation

All commands ran in this checkout with Node v24.22.1 and pnpm 10.4.1.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/pkg-memory...` | PASS; four dependency-first builds. |
| `pnpm --filter @jeswr/pkg-memory exec vitest run test/store.test.ts -t 'preserves references into shared' --coverage.enabled=false` | Both regression cases FAIL on the unfixed implementation after dependency builds, exposing disconnected provenance. |
| `pnpm --filter @jeswr/pkg-memory exec vitest run test/store.test.ts -t 'shared' --coverage.enabled=false` | PASS after the fix; seven selected tests. |
| `pnpm --filter @jeswr/pkg-memory run lint` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run build` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run typecheck` | PASS, including tests. |
| `pnpm --filter @jeswr/pkg-memory run test` | PASS; 11 files, 512 tests; 100% statements, branches, functions, and lines. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=60da98b9c11fa742e16b3b4d6f66ad53993e8914 pnpm run gate` | PASS; 9 successful tasks, including 686 root tests. |
| `pnpm run gate:full` | FAIL outside this lane; 287 successful tasks before `@jeswr/federation-codegen#test` stopped the run (2 failed, 23 passed tests). Root tests: 686 passed. |
| `git diff --check b53cf05192b29684907005c4786185f903d777ad` | PASS. |

The full gate reproduced the two previously documented namespace mismatches in
`tools/federation-codegen/test/generator.test.ts`: the Bookmark target class and
generated ontology bytes. `git diff 60da98b9c11fa742e16b3b4d6f66ad53993e8914 --exit-code --
tools/federation-codegen packages/solid-federation-vocab` passed, confirming the
tool and vocabulary inputs are unchanged from the required lane base. No
unrelated fix was made. Generated web-public build artifacts were removed.

The sole round-four finding is implemented with fixture-only regressions. No
dependency, manifest, or lockfile changed; no dependency policy check was needed.
`roborev` remains unavailable (`command -v roborev` found no executable), so
independent automated per-commit review remains outstanding. No pushes, PRs,
branch switches, remote fetches/merges, tracker changes, or edits to other
checkouts were performed. There are no new open questions or design choices;
earlier pilot/live-server verification limits remain as documented above.

## Review fixes — client identity and shared batch graphs

Review/fix base and affected-gate comparison:
`7c4526fd2912413d60aabf9f1f674c89c7a8a623`; branch remains `lane/sst-vcij`.

- `b162e971` — `fix(pkg-memory): preserve client authorization identity`: reject
  client IDs whose IRI safety check changes their lexical identity, then pass
  the unchanged ID to the ODRL evaluator. Regressions cover every escaped ASCII
  character, policy-level and rule-level assignees, denial-message privacy,
  already encoded IDs, host case, default ports, and dot segments.
- `9f47a39f` — `fix(pkg-memory): retain shared batch graph identity`: validate
  repeated source/entity graphs alongside assertions, retain one copy per graph
  ID, and remap blank-node references throughout each incoming dataset. Retain
  remapped node identities for newly encountered graphs. Conflicting content,
  missing copies, and inconsistent cross-graph node mappings fail closed.
  Regressions cover shared authors and entities, nested nodes, provenance and
  publication references, independent batches, an assertion loaded from an
  earlier batch, repeated reads, reversed listings, and dataset isomorphism.
- Final documentation commit — `docs: record sst-vcij review fix validation`:
  this report, committed last after the required gates.

### Validation

Commands ran in this checkout with Node v24.22.1 and pnpm 10.4.1, using
`/opt/node24/bin` first on `PATH`.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/pkg-memory...` | PASS; four dependency-first builds. |
| `pnpm --filter @jeswr/pkg-memory exec vitest run test/purpose.test.ts test/store.test.ts -t 'requiring transformation\|retains shared source/entity\|conflicting stored copies of a shared (sources\|entities)' --coverage.enabled=false` | Expected FAIL on the unfixed implementation; 46 failing regression cases reproduced both findings. |
| `pnpm --filter @jeswr/pkg-memory run lint` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run build` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run typecheck` | PASS, including tests. |
| `pnpm --filter @jeswr/pkg-memory run test` | PASS; 11 files, 564 tests; 100% statements, branches, functions, and lines. |
| `pnpm run lint:root` | PASS. |
| `TURBO_SCM_BASE=7c4526fd2912413d60aabf9f1f674c89c7a8a623 pnpm run gate` | PASS; 8 successful tasks. |
| `pnpm run gate:full` (first attempt) | FAIL outside this lane; root pathological-spec timing test measured 63.99 ms against its 50 ms limit; 685 other root tests passed. |
| `pnpm exec turbo run test:root` | PASS without competing builds; all 686 root tests. |
| `pnpm run gate:full` (retry) | FAIL outside this lane; 282 successful tasks before `@jeswr/federation-codegen#test` stopped the run (2 failed, 23 passed tests). The passing root tests were cached. |
| `git diff --check 7c4526fd2912413d60aabf9f1f674c89c7a8a623` | PASS. |

The full-gate retry reproduced the two previously documented namespace mismatches
in `tools/federation-codegen/test/generator.test.ts`: the Bookmark target class
and generated ontology bytes. The affected tool/vocabulary inputs and the root
timing test/guard are unchanged from this review base, verified with
`git diff 7c4526fd2912413d60aabf9f1f674c89c7a8a623 --exit-code -- tools/federation-codegen packages/solid-federation-vocab test/check-sdk-layers.test.mjs scripts/check-sdk-layers.mjs`.
Generated web-public build artifacts were removed.

Both requested findings are implemented with fixture-only regressions. No
dependency, manifest, or lockfile changed; no dependency policy check was needed.
`roborev` remains unavailable (`command -v roborev` found no executable), so
independent automated per-commit review remains outstanding. No pushes, PRs,
branch switches, remote fetches/merges, tracker changes, or edits to other
checkouts were performed. No implementation work or new open questions remain;
the earlier pilot/live-server verification limits still apply.

## Review fix round 2 — cross-resource graph identity

Review/fix base and affected-gate comparison:
`2bfa746b274fca34fa5a1402068318c8a7482cb9`; branch remains `lane/sst-vcij`.

- `16a4789a` — `fix(pkg-memory): reject unsupported blank-node sharing`:
  validate the complete resource split before any Pod mutation. A blank node
  used by multiple resources must occur in a common assertion, sources, or
  entities graph in every resource that uses it. Reject provenance-only,
  publication-only, and unanchored cross-batch sharing; preserve local
  cross-graph nodes and supported shared nodes. Document this storage boundary.
- `a9a49822` — `fix(pkg-memory): match shared graph nodes jointly`: determine
  node correspondence from all repeated graphs together, retaining graph
  identity in an internal matching projection. Symmetric source authors can be
  distinguished by entities without depending on triple order. Genuine graph
  content and cross-graph identity conflicts still reject. Regressions verify
  whole-dataset isomorphism, provenance joins, repeated reads, and both listing
  orders after reordering stored triples.
- Final documentation commit — `docs: record sst-vcij graph identity validation`:
  this report, committed last after the required gates.

Conservative choice: use the review's explicitly permitted rejection of
unsupported sharing before writing. No persistent mapping format was introduced.
There are no new design questions.

### Validation

Commands ran in this checkout with `/opt/node24/bin` first on `PATH`
(Node v24.22.1 and pnpm 10.4.1).

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/pkg-memory...` | PASS; four dependency-first builds. |
| `pnpm --filter @jeswr/pkg-memory exec vitest run test/store.test.ts -t 'shared only between private\|local blank node shared' --coverage.enabled=false` | Expected FAIL before the first fix; both unsupported-sharing cases reproduced the finding. |
| `pnpm --filter @jeswr/pkg-memory exec vitest run test/store.test.ts -t 'resolves symmetric blank nodes' --coverage.enabled=false` | Expected FAIL before the joint-mapping fix; both listing orders reproduced the finding. |
| `pnpm --filter @jeswr/pkg-memory exec vitest run test/store.test.ts --coverage.enabled=false` | PASS after both fixes; 68 tests. |
| `pnpm --filter @jeswr/pkg-memory run lint` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run build` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run typecheck` | PASS, including tests. |
| `pnpm --filter @jeswr/pkg-memory run test` | PASS; 11 files, 570 tests; 100% statements, branches, functions, and lines. |
| `pnpm run lint:root` (via the affected gate) | PASS. |
| `TURBO_SCM_BASE=2bfa746b274fca34fa5a1402068318c8a7482cb9 pnpm run gate` | PASS; 8 successful tasks. |
| `pnpm run gate:full` (first attempt) | FAIL outside this lane; root pathological-spec timing test measured 62.27 ms against its 50 ms limit; 685 other root tests passed. |
| `pnpm exec turbo run test:root` | PASS without competing builds; all 686 root tests. |
| `pnpm run gate:full` (retry) | FAIL outside this lane; 285 successful tasks before `@jeswr/federation-codegen#test` stopped the run (2 failed, 23 passed tests). The passing root tests were cached. |
| `git diff --check 2bfa746b274fca34fa5a1402068318c8a7482cb9` | PASS. |

The full-gate retry reproduced the two previously documented namespace
mismatches in `tools/federation-codegen/test/generator.test.ts`: the Bookmark
target class and generated ontology bytes. The tool/vocabulary inputs and root
timing test/guard are unchanged from this review base, verified with
`git diff 2bfa746b274fca34fa5a1402068318c8a7482cb9 --exit-code -- tools/federation-codegen packages/solid-federation-vocab test/check-sdk-layers.test.mjs scripts/check-sdk-layers.mjs`.
Generated web-public build artifacts were removed before the final commit.

No dependency, manifest, or lockfile changed; no dependency policy check was
needed. Tests use fictional identities and the memory PodPort. `roborev` remains
unavailable (`command -v roborev` found no executable), so independent automated
per-commit review remains outstanding. Both requested findings are implemented.
No pushes, PRs, branch switches, remote fetches/merges, tracker changes, or edits
to other checkouts were performed. No implementation work or open questions
remain; the earlier pilot/live-server verification limits still apply.

## Review fix round 3 — policy semantics and exact graph correspondence

Review/fix base and affected-gate comparison:
`306db133142931fcbcd50ff514c3cdc04884e410`; branch remains `lane/sst-vcij`.

- `e786842a` — `fix(pkg-memory): deny unsupported policy semantics`: deny
  profiles and unverified delegation in the public purpose filter on every read,
  including direct callers and later policy edits. Cover both purposes, scalar
  and array profiles, empty declarations, and combined profile/delegation fields.
- `b7a31623` — `fix(pkg-memory): compare exact shared graph literals`: separate
  literal-preserving graph comparison from the builder's RDFlib-compatible
  assertion normalization. Reject conflicting lexical forms for all four temporal
  datatypes in both listing orders; preserve the original assertion safety checks.
- `a8165595` — `fix(pkg-memory): reject ambiguous shared node labels`: require
  unique structural labels for nodes in their common shared graphs before any Pod
  mutation, including single-resource puts that could be repeated in later calls.
  Listing ambiguous older/external resources also rejects. Cover reordered
  symmetric authors, reversed/repeated listings, private local symmetry, and
  authors distinguished by exact literal spellings; retain existing joint-graph
  correspondence regressions.
- Final documentation commit — `docs: record sst-vcij round three validation`:
  this report, committed last after the required gates.

Conservative choice: reject shared-node correspondence that structural refinement
cannot resolve without tie-breaking search. No persistent mapping format or
delegation evaluation was introduced. Policies declaring even empty profile or
delegation fields deny. No new design questions remain.

### Validation

Commands ran with `/opt/node24/bin` first on `PATH` (Node v24.22.1 and pnpm 10.4.1).

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/pkg-memory...` | PASS; four dependency-first builds. |
| `pnpm --filter @jeswr/pkg-memory exec vitest run test/purpose.test.ts -t 'unsupported policy semantics' --coverage.enabled=false` | Expected FAIL before the policy fix; seven regression cases reproduced the finding. |
| `pnpm --filter @jeswr/pkg-memory exec vitest run test/store.test.ts -t 'lexically distinct' --coverage.enabled=false` | Expected FAIL before the literal fix; all four temporal datatype cases reproduced the finding. |
| `pnpm --filter @jeswr/pkg-memory exec vitest run test/store.test.ts -t 'ambiguous.*shared authors' --coverage.enabled=false` | Expected FAIL before the ambiguity fix; four write/list regression cases reproduced the finding. |
| `pnpm --filter @jeswr/pkg-memory run lint` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run build` | PASS. |
| `pnpm --filter @jeswr/pkg-memory run typecheck` | PASS, including tests. |
| `pnpm --filter @jeswr/pkg-memory run test` | PASS; 11 files, 589 tests; 100% statements, branches, functions, and lines. |
| `TURBO_SCM_BASE=306db133142931fcbcd50ff514c3cdc04884e410 pnpm run gate` | PASS; root lint and 8 successful tasks. |
| `pnpm run gate:full` (first attempt) | FAIL outside this lane; one root agent-layer fixture exceeded its 5000 ms timeout during concurrent builds; 685 other root tests passed and 53 tasks succeeded. |
| `pnpm exec turbo run test:root` | PASS without competing builds; all 686 root tests. |
| `pnpm run gate:full` (retry) | FAIL outside this lane; 283 successful tasks before `@jeswr/federation-codegen#test` stopped the run (2 failed, 23 passed tests). Passing root tests were cached. |
| `git diff --check 306db133142931fcbcd50ff514c3cdc04884e410` | PASS. |

The full-gate retry reproduced the previously documented Bookmark target-class
and generated-ontology namespace mismatches in
`tools/federation-codegen/test/generator.test.ts`. The tool/vocabulary inputs and
the timed-out root test/guard are unchanged from this round's base, verified with
`git diff 306db133142931fcbcd50ff514c3cdc04884e410 --exit-code -- tools/federation-codegen packages/solid-federation-vocab test/agent-layers.test.mjs scripts/check-agent-layers.mjs`.
Generated web-public build artifacts were removed before the final commit.

All three requested findings are implemented with 19 added regression cases.
No dependency, manifest, or lockfile changed; no dependency policy check was
needed. Tests use fictional identities and the memory PodPort. `roborev` remains
unavailable (`command -v roborev` found no executable), so independent automated
per-commit review remains outstanding. No implementation work or open questions
remain. No pushes, PRs, branch switches, remote fetches/merges, tracker changes,
or edits to other checkouts were performed. The earlier pilot/live-server
verification limits still apply.
