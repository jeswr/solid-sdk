<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

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
