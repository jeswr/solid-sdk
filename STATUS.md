<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-fv0j — MCP-08 lane status

Implemented on `lane/sst-fv0j`, based on
`917d3be9c7967622829adc43c1aaabb0964ec993`. No pushes, PRs, publishing,
branch switches, remote git fetches/merges, or other checkout edits.

## Commits

- `cc2106d7` — `feat: add owner-only AS2 chat writer`: reusable structural
  ChatPodPort, canonical AS2 messages and collection metadata, Claude/ChatGPT/Codex
  namespaces, immutable message IDs with `If-None-Match: *`, ACL-before-content,
  paged listing and exclusive since filter, tests, API documentation, QUESTIONS.md.
- `c18d0685` — `feat: expose chat save list and get tools`: MCP registration,
  scoped fetch adapter, owner/read-only checks, conditional headers, refusal of
  remote-context RDF, client-driven tests, build externalization and workspace edge.
- Final documentation commit — `docs: record MCP-08 lane status` (this report).

## Validation

All tests used fixtures/in-memory pods; no real accounts or production API calls.
Node `v24.22.1`, pnpm `10.4.1`; dependency lifecycle scripts remained disabled.

Commands and final results:

```sh
pnpm --filter @jeswr/solid-chat-interop run lint && pnpm --filter @jeswr/solid-chat-interop run build && pnpm --filter @jeswr/solid-chat-interop run typecheck && pnpm --filter @jeswr/solid-chat-interop run test
# PASS: lint/build/typecheck, 107 tests in 7 files.

pnpm --filter @jeswr/solid-mcp run lint && pnpm --filter @jeswr/solid-mcp run build && pnpm --filter @jeswr/solid-mcp run typecheck && pnpm --filter @jeswr/solid-mcp run test
# PASS: lint/build/typecheck, 91 tests in 4 files.

pnpm run lint:root
# PASS: Biome, lockfile transport, app workspace and fetch guards.

pnpm --filter @jeswr/solid-mcp run test:coverage
# PASS: chat-tools.ts has 100% statements/branches/functions/lines.
# Existing whole-package branch coverage is 81.09%.

pnpm --filter @jeswr/solid-chat-interop exec vitest run --coverage --coverage.provider=v8 --coverage.include=src/chat-writer.ts --coverage.reportsDirectory=/tmp/sst-fv0j-writer-coverage
# PASS: writer 99.31% statements, 95.78% branches, 100% functions, 99.23% lines.
```

The required affected gate was run with a PATH wrapper refusing git
clone/fetch/pull/push, to enforce the lane's no-remote-git rule during legacy
build scripts:

```sh
PATH=/tmp/sst-fv0j-no-remote-git:$PATH TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate
# PASS: 26/26 tasks, including changed packages and their dependents.

PATH=/tmp/sst-fv0j-no-remote-git:$PATH pnpm run gate:full
# FAIL: @jeswr/federation-trust#test; 187 successful / 246 scheduled tasks.
```

The full-workspace failure is in unchanged
`packages/federation-trust/test/characterization.test.ts:196`:
“delegation credential structure is stable”. The embedded delegateKey JWK JSON
snapshot expects key order `crv,x,kty`; the current runtime emits `kty,crv,x`.
That package and its dependencies were not changed by this lane. The full gate
stopped at this failure, so it did not complete all scheduled tasks. Generated
untracked callback/client-ID assets were removed after the run; no build outputs
were committed. Logs are under `/tmp/sst-fv0j-*.log`.

Initial isolated checks failed because workspace dependency dist output had not
been built; dependency-first builds resolved that. The pinned Git fetch-rdf
package also lacked dist. Its output was restored inside this checkout's
node_modules from the existing `/tmp/sst-0e7-fetch-rdf.sQiWs6/dist` artifact;
that artifact's source archive names the exact pinned commit
`a8359a3764cb6b3c763e09ea211542a5dc7edc33`. No remote clone was used.

## Dependencies

- `pnpm run check:packages @solid/object` — PASS (full mode, age 262 days).
  Added the existing suite version `^0.6.0` to chat-interop for typed WAC writes.
- `pnpm run check:packages @jeswr/solid-chat-interop --mode policy` — PASS.
  Added only a `workspace:*` edge to solid-mcp.
- `pnpm install --offline --ignore-scripts` initially failed because package
  metadata was absent from the offline cache.
- `pnpm install --ignore-scripts` — PASS; lockfile changes narrowed to the two
  new importer entries, preserving unrelated baseline peer resolutions.
- `pnpm install --offline --frozen-lockfile --ignore-scripts` — PASS with the
  minimal consistent lockfile; no dependency upgrades or lifecycle execution.

## Limitations and questions

Implementation and all three acceptance criteria are covered. No task code is
left unfinished. Full-workspace gate completion is blocked by the unrelated
snapshot failure above. Automated roborev review could not run: the executable
and post-commit hook are absent; no tooling was installed.

The supplied base does not include the promised MCP-01 PodPort/tool registry.
This lane exposes a structurally compatible chat port and adapts existing
registration, without importing branches or reconstructing unrelated MCP-01
work. Integration with the eventual shared registry remains a coordination
question. See QUESTIONS.md for all conservative defaults: optional stable
message IDs, URL cursors, exclusive since, first title/message wins, owner WebID
requirement, read-only default and provider IDs. There are no other blocking
questions. ACL-before-content support is required from the server/port; there is
no permissive fallback. Listing scans chat resources without a shared index.

## Fix round 1 — review at 71278b5da95a

- `72bd090a` — `fix: harden chat saves and incomplete listings`: resolves all
  three review findings. ChatPodPort now discovers WAC ACL associations from
  the target's Link header instead of guessing a suffix. The adapter checks
  unique, unanchored, pod-scoped ACL URLs, refuses ACP and discovery redirects,
  and allows advertised ACLs on 404 before container creation. Existing non-WAC
  ACL documents abort saves; associations are rechecked after container creation.
  Chat PUTs use manual redirects and reject every 3xx. Listing skips only
  metadata 404s, preserving permission, transport, malformed-data and message
  errors. Regression tests and API documentation cover the changed behavior.
- Final documentation commit — `docs: record chat review fix validation`.

Final checks for this round (all fetches in tests are in-memory fixtures):

```sh
pnpm --filter @jeswr/solid-chat-interop run lint && pnpm --filter @jeswr/solid-chat-interop run build && pnpm --filter @jeswr/solid-chat-interop run typecheck && pnpm --filter @jeswr/solid-chat-interop run test
# PASS: lint/build/typecheck; 116 tests in 7 files.

pnpm --filter @jeswr/solid-mcp run lint && pnpm --filter @jeswr/solid-mcp run build && pnpm --filter @jeswr/solid-mcp run typecheck && pnpm --filter @jeswr/solid-mcp run test
# PASS: lint/build/typecheck; 115 tests in 4 files.

PATH=/tmp/sst-fv0j-no-remote-git:$PATH TURBO_SCM_BASE=71278b5da95ad44e04afff0a1dde06ef8baada15 pnpm run gate
# PASS: lint:root (including workspace/transport/fetch guards); 26/26 Turbo tasks.

PATH=/tmp/sst-fv0j-no-remote-git:$PATH pnpm run gate:full
# FAIL: unchanged @jeswr/federation-trust#test; 167/232 tasks completed.
```

The package checks also used the same PATH wrapper to refuse remote Git
operations. Dependency-first builds restored missing workspace dist output.
The exact-pinned fetch-rdf dist artifact described above was again copied into
this checkout's node_modules; no remote clone/fetch or lifecycle scripts ran.
No dependencies or lockfile changes were needed; check:packages is not applicable.
Logs: `/tmp/sst-fv0j-fix-{interop-gate,mcp-gate,gate,gate-full}.log`.

Full-gate completion remains blocked by the existing “delegation credential
structure is stable” snapshot mismatch at
`packages/federation-trust/test/characterization.test.ts:196`; that package is
unchanged. Roborev and its post-commit hook remain unavailable, so no automated
review verdict could be obtained. No task implementation remains unfinished.

Conservative compatibility choice: servers must advertise an unambiguous WAC
ACL even before container creation and support the ACL-first write sequence;
otherwise saving fails closed. No new open questions. The earlier shared
PodPort/registry coordination question is unchanged.

## Fix round 2 — review at 08e8edf3e9ee

- `2bd7ea4c` — `fix: protect chat content resource ACLs`: resolves the high
  finding about resource-specific grants. Metadata and messages now use the
  same ACL-first create path as containers: discover the exact resource's WAC
  ACL, reject unsupported documents, replace grants with owner-only access,
  attempt the conditional content write, and recheck the ACL association.
  Existing resources skipped with 412 receive the same protection. Only
  container ACLs set inherited defaults. Regression tests cover public grants
  on new and existing metadata/messages, custom ACL locations, immutable
  content, discovery/read/write failures, unsupported models, and changed
  associations. The package README documents these guarantees.
- Final documentation commit — `docs: record resource ACL fix validation`.

Final validation commands (all tests use fixtures/in-memory pods):

```sh
PATH=/tmp/sst-fv0j-no-remote-git:$PATH bash -c 'pnpm --filter @jeswr/solid-chat-interop run lint && pnpm --filter @jeswr/solid-chat-interop run build && pnpm --filter @jeswr/solid-chat-interop run typecheck && pnpm --filter @jeswr/solid-chat-interop run test'
# PASS: lint/build/typecheck; 128 tests in 7 files (42 writer tests).

PATH=/tmp/sst-fv0j-no-remote-git:$PATH TURBO_SCM_BASE=08e8edf3e9eefafe1bbd38312d74b787e88ca184 pnpm run gate
# PASS: lint:root and all guards; 25/25 Turbo tasks, including 115 MCP tests.

PATH=/tmp/sst-fv0j-no-remote-git:$PATH pnpm run gate:full
# FAIL: unchanged @jeswr/federation-trust#test; 163/226 tasks completed.
```

The full gate again stops at the existing “delegation credential structure is
stable” snapshot mismatch in
`packages/federation-trust/test/characterization.test.ts:196`: delegateKey JSON
expects key order `crv,x,kty`, but receives `kty,crv,x`. No changes were made to
that package; remaining full-workspace tasks did not finish.

Workspace dependency output was built first with
`PATH=/tmp/sst-fv0j-no-remote-git:$PATH pnpm exec turbo run build --filter='@jeswr/solid-chat-interop^...'`.
The exact-pinned fetch-rdf dist artifact described above was restored into this
checkout's node_modules. No remote Git operations, lifecycle scripts, dependency
changes or lockfile edits were needed; check:packages is not applicable.
Roborev remains unavailable, so no automated review verdict could be obtained.
Logs: `/tmp/sst-fv0j-fix2-{deps,interop-gate,gate,gate-full}.log`.

No requested implementation remains unfinished and there are no new open
questions. Conservatively, ACL-before-content support and an unchanged WAC ACL
association are required for every content resource, including existing ones;
unsupported servers fail closed. The earlier shared PodPort/registry
coordination question is unchanged.

## Fix round 3 — review at ea53c6f322d1

- `9ce98897` — `fix: reject shared chat ACL documents`: resolves the medium
  finding about removing unrelated authorizations. Before replacing a discovered
  ACL, the writer checks every authorization's complete `acl:accessTo` and
  `acl:default` sets. If any scope names another resource, saving fails before
  writing that ACL or its target. The conservative option explicitly allowed by
  the review is to reject shared documents, preserving them unchanged.
  The README documents this restriction. Twenty-four regression cases cover
  containers, metadata and messages, new and existing resources, separate
  authorizations and multiple scope values in one authorization. They assert
  the shared ACL and target remain unchanged and subsequent messages are not
  written. All 24 failed against the previous implementation before the fix.
- Final documentation commit — `docs: record shared ACL fix validation`.

Final validation commands (the new tests use only the in-memory pod):

```sh
PATH=/tmp/sst-fv0j-no-remote-git:$PATH pnpm exec turbo run build --filter='@jeswr/solid-chat-interop^...'
# PASS: dependency-first build.

PATH=/tmp/sst-fv0j-no-remote-git:$PATH bash -c 'pnpm --filter @jeswr/solid-chat-interop run lint && pnpm --filter @jeswr/solid-chat-interop run build && pnpm --filter @jeswr/solid-chat-interop run typecheck && pnpm --filter @jeswr/solid-chat-interop run test'
# PASS: lint/build/typecheck; 152 tests in 7 files (66 writer tests).

PATH=/tmp/sst-fv0j-no-remote-git:$PATH pnpm run lint:root
# PASS: Biome, lockfile transport, app workspace and fetch guards.

PATH=/tmp/sst-fv0j-no-remote-git:$PATH TURBO_SCM_BASE=08e8edf3e9eefafe1bbd38312d74b787e88ca184 pnpm run gate
# PASS: 26/26 Turbo tasks, including dependent packages and 115 MCP tests.

PATH=/tmp/sst-fv0j-no-remote-git:$PATH pnpm run gate:full
# FAIL: unchanged @jeswr/federation-trust#test; 227/273 tasks completed.
```

The full gate again stops at the existing “delegation credential structure is
stable” snapshot mismatch in
`packages/federation-trust/test/characterization.test.ts:196`: delegateKey JSON
expects key order `crv,x,kty`, but receives `kty,crv,x`. That package is unchanged;
the remaining full-workspace tasks did not complete. Generated untracked
callback/client-ID assets were removed after the run.

The first affected-gate attempt was blocked when the existing MCP build script
tried a remote Git clone for missing fetch-rdf output. The PATH guard refused
the clone. Restoring the already available exact-pinned fetch-rdf artifact
described above into this checkout's MCP node_modules allowed the gate to pass;
the source archive identifies commit
`a8359a3764cb6b3c763e09ea211542a5dc7edc33`. No remote Git operation, dependency
addition, lockfile change or lifecycle script was needed. check:packages is not
applicable. An initial package lint attempt reported test formatting; formatting
was corrected before the successful final package gate.

Roborev remains unavailable, so no automated review verdict could be obtained.
Logs: `/tmp/sst-fv0j-fix3-{deps,regression-red,interop-gate,root-lint,gate,gate-full}.log`.
No requested implementation remains unfinished and there are no new open
questions. The earlier shared PodPort/registry coordination question is unchanged.
