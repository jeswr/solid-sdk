---
name: pod-migrator
description: Use when maintaining @jeswr/pod-migrator planning, reviewed execution, independent pod connections, or integrating its migration UI into a host application.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Pod migration

Read [README.md](README.md), [docs/DESIGN.md](docs/DESIGN.md), and the colocated
[engine safety notes](src/README.md) before changing migration behavior. Offline WAC/ACP
translation lives in `@jeswr/pod-access`; HTTP, decisions, planning and execution live here.

The root API is `planMigration` → `finalizePlan` → `executeMigration`. Planning only reads.
Every required decision needs an explicit supported resolution; abort prevents execution.
Executable snapshots are session-bound and single-use. Reports are never executable plans.

Never widen access, including partial execution. Preserve path-scoped string-only `PodHttp`
fences, redirect refusal, conditional writes, target scope inventory, fresh source/target proofs,
content integrity checks, top-down locks, bottom-up grants, owner Control and final verification.
Unproven integrity offers skip/abort; owner-only must not override unknown target restrictions.
Cancellation stops after the current safe unit without a permissive rollback.

The `./connections` API owns independent auth instances and storage namespaces. Keep
`patchGlobalFetch: false`, separate callback paths, and no issuer-origin arming. Discover storage
from the authenticated WebID subject; multiple roots require an explicit selection. Establish
implementation from trusted storage-host/header evidence, never RDF or issuer input. Group
expansion and rechecks require separately fenced anonymous fetch with no authenticated fallback.

A host may supply its existing source via `createPodHttp` and `inspectPod`; use a transport pinned
to that account/session. Create only the destination with `createConnection`, optionally passing
the host Client Identifier Document whose redirect list must include the dedicated callback.
Never register that destination as a host account. Discard plans and choices when credentials,
storage, destination folder or options change. Require review before execution; never auto-resume.
Journal helpers preserve interrupted reports without credentials; scope displayed reports to the
source identity. Keep all migration logic in this package and only presentation in the host.

Run dependency-first build, typecheck, lint and tests. Preserve the engine's 100% coverage gate
and unchanged regression tests. Run `test:css` against the installed CSS 7.2 WAC and ACP servers.
This package is security critical and needs maintainer review before merge.
