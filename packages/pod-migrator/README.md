<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/pod-migrator

Plan, review and copy Solid pods without ever widening resource access. Source files stay in
place. This security-critical package is extracted from the standalone Pod Migrator; its engine
and regression tests move without logic changes. No mirror repository is configured.
The UI lives in Solid Suite Settings at `/settings/move-pod`.

## Public API

The root exports `planMigration`, `finalizePlan`, `executeMigration`, `createPodHttp`,
`detectAccessSystem`, `assertNotWider`, `effectivePolicy`, and the migration/policy types.
`planMigration({ source, target, targetContainer, rewriteIris?, signal?, onProgress? })` reads only.
`finalizePlan(plan, resolutions)` requires an explicit valid choice for every decision and proves
non-widening. Its executable snapshot is bound to the original sessions and single-use.
`executeMigration(executable, { source, target, signal?, onProgress? })` writes only the target,
then verifies copied bytes and permissions. Downloaded JSON cannot resume writes.

`PodSide` carries a storage root, owner WebID, fenced `http`, optional anonymous `publicHttp`,
and an independently established server `implementation`. Construct each transport with
`createPodHttp({ root, fetch })`. The fence enforces the root path, rejects redirects and caller
credential headers, and accepts string URLs only. Group expansion requires anonymous transport;
it never falls back to owner credentials. Never infer server implementation from editable RDF
or the login issuer.

`@jeswr/pod-migrator/connections` exports `PodConnection`, `ConnectionState`, `authConfig`,
`createConnections(origin, base?)`, `createConnection(id, origin, base?, clientId?)`,
`detectImplementation`, and `inspectPod(side, signal)`. Each connection has independent auth
storage keys and callbacks, with global fetch patching disabled. `inspectPod` inspects an existing
authenticated source without starting another session. `createConnection` can use a host's
Client Identifier Document; the callback remains `<origin><base>callback/<id>`.

Solid Suite uses its active account's pinned transport as source, and creates only a separate
`target` connection. Its Client Identifier Document at `/.well-known/solid-client-id.jsonld`
registers `/settings/move-pod/callback/target`. The destination is never registered as a suite
account. Demo accounts cannot start migration.

The root also exports `RunReport`, `readPreviousRun`, `saveReport`, `downloadReport` and
`journalKey`, extracted from the original UI. Reports and progress use this tab's sessionStorage,
without credentials. A reload labels an unfinished run interrupted and never resumes writes.
The suite shows a previous report only for the active source WebID and storage root.

## Security and validation

Read [the complete design](docs/DESIGN.md) and [engine safety notes](src/README.md) before changes.
The overriding invariant is that no intermediate or final state widens source access.
Execution validates all selected content before writes, locks containers top down, copies through
conditionally created owner-only placeholders, grants bottom up, then verifies. Unsupported
translations require per-item skip / nearest restrictive / abort choices. Unproven integrity,
shared access documents, stale validators and unsafe target inheritance fail closed.
Cancellation finishes the current safe unit; it never broadens permissions to roll back.

```sh
export PATH=/opt/node24/bin:$PATH
pnpm turbo run lint build typecheck test --filter=@jeswr/pod-migrator
pnpm --filter @jeswr/pod-migrator test:css
```

The package retains the standalone compiler version so its existing typed test fixtures remain
unchanged. The engine keeps its 100% lines, branches, functions and statements coverage gate. Connection
security tests accompany the moved engine tests. The live CSS 7.2 WAC/ACP suite and its runner
are in [test/css](test/css/README.md); ESS/NSS remain offline contracts, not live certifications.
