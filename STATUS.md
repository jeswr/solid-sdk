<!-- AUTHORED-BY Codex GPT-6 -->

# sst-8xm.30 — fix round 7

Merged the prescribed local `origin/sdk/t-004-fetch-rdf` branch by fast-forward to
`0d768be1`. No push, PR, branch switch, or other checkout changes.

Commit `3d18e9d1` fixes the seven ACL inheritance failures. The exact test names
are in `apps/pod-manager/src/lib/resource-acl.test.ts`, rather than
`packages/solid-components`; this lane conservatively follows those named tests.
All seven reproduced before the fix (51 passed, seven failed).

The newly merged `pod-connectors` package still depended on published fetch-rdf
0.1.0 while Pod Manager used the workspace package. The two `RdfFetchError`
constructors differed, so missing ACL responses failed the `instanceof` check
despite carrying status 404. Switch the connector dependency and lockfile to
`workspace:*`, and adapt `freshRdf` to the workspace `fetchRdf`/document-loader API.
Keep revalidation, typed remote-context refusal, validators, response headers,
and base-IRI handling. Add HTTP error contract checks; weaken no existing tests.

Validation:

- Requested component dependency build and component tests: passed, 204 tests.
- fetch-rdf tests: passed, 73 tests.
- pod-connectors lint, build, typecheck, and tests: passed, 286 tests; lint has
  36 existing warnings.
- Pod Manager ACL tests: passed, all 58 tests including the seven regressions.
- Full Pod Manager tests: passed, 930 tests and one existing skip.
- Frozen offline dependency installation and `git diff --check`: passed.
- Final `pnpm run gate`: failed at `@jeswr/federation-codegen#test`.
- Final `pnpm run gate:full`: failed at the same task.

Both gates encounter two existing `tools/federation-codegen/test/generator.test.ts`
failures: the bookmark target class expects `https://w3id.org/jeswr/sectors/bookmarks#`
while generation returns `https://jeswr.org/ns/sectors/bookmarks#`, and generated
ontology bytes differ for the same namespace migration. These failures were also
observed before the fix; they are outside this ACL brief and remain unchanged.
The gates stop early, so full-workspace success is not claimed. Build-generated
untracked public assets were removed after verification.

Automated commit review remains unavailable: `roborev` is not installed in this
sandbox. No open implementation questions; the remaining blockers to a green
workspace gate are the unrelated generator failures above.

# sst-8xm.30 — fix round 8

Implemented only finding 2 from the review of `d4f87e107cb7`, as scoped by the
integrator. Commit `84dd7c71` (`fix: bundle the shipped federation context`) adds
the complete official `https://w3id.org/jeswr/fed` JSON-LD context beside OIDC in
federation-client's inline loader. The bundled document matches the official
response retrieved with `Accept: application/ld+json`; namespace mappings are
unchanged. All other remote contexts remain refused, including nested loads.
The final `docs: record federation context validation` commit updates this report.

Regression tests discover every shipped `apps/*/clientid.jsonld` (currently Pod
Chat and Pod Docs), parse each offline, and exercise both body and injected-fetch
verification. They also cover verification/listing of a valid registration using
the federation context, mutation isolation for both bundled contexts, and refusal
of unknown contexts and URL variants. Before the fix, Pod Chat parsing and loading
the federation context failed (two failures, 14 passing tests). After the fix,
all 17 offline-context tests pass. A built-bundle smoke check also confirms both
shipped documents parse with global fetch disabled.

Validation completed before the final commit:

- `pnpm exec turbo run build --filter=@jeswr/federation-client^...`: passed,
  all four dependency builds.
- `pnpm --filter @jeswr/federation-client run lint`: passed, one pre-existing
  informational diagnostic in `test/iri.test.ts`.
- `pnpm --filter @jeswr/federation-client run build`: passed.
- `pnpm --filter @jeswr/federation-client run typecheck`: passed.
- `pnpm --filter @jeswr/federation-client run test`: passed, 228 tests in 15 files.
- `pnpm --filter @jeswr/federation-client run test:coverage`: passed, 228 tests;
  context-loader has 100% statements, branches, functions, and lines. Overall
  coverage: 99.26% statements/lines, 89.82% branches, 98.21% functions.
- `pnpm exec turbo run build typecheck test --filter=...@jeswr/federation-client --concurrency=4`:
  passed, seven tasks (four cached).
- `pnpm run lint:root`: passed.
- `pnpm run gate`: failed at `@jeswr/federation-codegen#test` after 182 successful
  tasks. The two existing `tools/federation-codegen/test/generator.test.ts`
  failures are unchanged: the bookmarks target-class namespace mismatch and
  generated ontology byte drift, already recorded for round 7 above. The gate
  stops early; full-workspace success is not claimed.
- `git diff --check`: passed.
- `check:packages`: not applicable; no dependencies added or changed.

Finding 1 remains with VOC-06 (`sst-gxon`), as directed. Shipped metadata and
reader namespaces were not edited. Pod Chat now parses and extracts its
registration; its existing short access-mode values still produce semantic
validation issues, outside this parsing-only fix. Automated commit review remains
unavailable because `roborev` is not installed. No implementation work remains for
the scoped finding, and there are no open questions. No push, PR, branch switch,
remote fetch/merge, or changes to other checkouts.
