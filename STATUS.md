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
