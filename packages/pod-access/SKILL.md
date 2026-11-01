---
name: pod-access
description: Use when working on @jeswr/pod-access, the pod sharing and permissions across access-control models package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

This package owns the offline WAC/ACP translation core extracted from `apps/pod-migrator`:
readers/writers, neutral policy/report types, conservative translation, inheritance composition,
and bounded access proofs. See `README.md` for exports. The `./roles` subpath owns the injected-fetch Solid role client from SDK-APP-04; the broader
AccessClient/LWS work remains separate. The `./testing` entry point remains reserved.

Before implementation, read SDK core ADR-001 D4 and `ADR-003-storage-client.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and adversarial
tests with the implementation. Retain the migrator's conservative source readings, widest target
readings, target ACP allowlist, bounded complexity, report IDs/options, and dialect behavior.
Server implementation is a trusted caller assertion, never derived from editable access RDF.

In-process callers are trusted code. Keep internal mode lists private and frozen and helper
classes out of public exports; no export may let one caller alter another caller's proof.
The public mode list is a frozen copy; returned policies and reports are caller-owned.
Patching shared JavaScript built-ins or dependencies directly is outside this trust boundary.

The migrator owns HTTP, public group snapshots, review decisions, effective target phase proofs,
scope checks, conditional persistence, and execution. Run its tests when changing this core;
serializing a translated policy alone does not establish safe migration.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, dependency-first `build`, `typecheck`, and `test` scripts,
plus the migrator's regression suite and the repository gate.

<!-- AUTHORED-BY Codex -->

The public `./roles` API is documented in README.md: role/mode mapping, neutral AgentRef and
RoleGrant types, `grantsWithRoles`, `readGrants`, `setGrants`, `addGrant`, `removeGrant`, and branded `RoleError` classification via
`isRoleError`. Export helpers through `src/roles/index.ts` only; no mutable reader/error
classes may escape. New public API changes must update this skill and README together.

Preserve the Drive sharing prior art credited in source: nearest WAC replacement versus
additive ACP inheritance, separate ACR management, comments-container permissions, shared
scope/principal splitting, copied inherited ACLs, owner lockout and conditional writes.
Do not flatten denial/exclusion/conditional policies to unconditional role grants. Partial
or odd grants never round up; edits refuse lossy projections. Groups remain symbolic WAC
agents; ACP groups and WAC apps are unsupported. Never derive a server dialect from RDF.

Before every batch, reject expiry/purpose and preflight every URL for caller lockout before
any PUT. A batch is not atomic: report all per-URL failures, stop that URL's remaining writes,
and retain successful results accurately. Re-read discovery and governing validators before
conditional persistence; never retry a 412 silently. Copy WAC defaults through typed setters
and preserve materializedFrom provenance across reapplication, including descendant defaults.
Do not edit ancestor documents. Keep the HTTP body/quad/ancestor bounds, root checks,
redirect refusal and fetch-rdf remote-context refusal. No network in tests.

<!-- AUTHORED-BY Codex GPT-6 -->

`readGrants` returns `{ url, grants, version }` as an opaque JSON-serialisable `GrantSnapshot`;
`grantsWithRoles` remains `(await readGrants(url, options)).grants`. Preserve the version token
verbatim: it binds own-document presence/absence, own and inherited ETags, discovery, comments,
resource kind and trusted implementation. `setGrants` accepts `expected: snapshot` or a complete
per-resource map of snapshot version tokens. Compare the re-read validators with the token before
diffing raw RDF against that baseline; never silently switch a stale caller to a newer baseline.
Keep the matching snapshot's If-Match / absent If-None-Match: * preconditions through persistence.
Stale tokens fail even for no-op selections. A changed write consumes its old token; unchanged
reapplication with a current snapshot sends no PUT. Without expected, retain fresh-read behavior.

Single-agent operations must never route through full-set replacement. Add/raise only the selected
agent, keeping every other agent's modes, shared scopes, policy semantics and metadata intact;
an equal/higher effective role sends no write. Removal is idempotent for absent direct grants and
refuses inherited resource removal; retain inherited comments and refuse lossy comments Write
revocation. WAC splits shared principals; ACP splits only that principal's policy/matcher/control
paths while preserving member and foreign references. Both operations use the existing batch
preflight/results and conditional conflict contract, with no automatic 412 retry. Reject addGrant
expiry/purpose before any I/O. Test snapshots after JSON round trips, stale own/source validators,
absence races, preservation of unrelated RDF, creation/replacement preconditions and replay no-ops.

`notify`/`message` only record a no-op delivery hook (SDK-APP-07). `decide()` and
`movePreservingAccess` are outside this layer. The root remains the migrator's offline API;
its security and proof semantics must remain unchanged. `@jeswr/fetch-rdf` is an existing
workspace runtime dependency for role HTTP parsing. Keep exactOptionalPropertyTypes enabled.

`RoleContext.implementation` applies to both mapping helpers as well as HTTP options.
CSS ACP managers use resource acl:Control; ESS uses acp:Read+Write on the own ACR.
Validate the active mode vocabulary before normalization (CSS acl:*, ESS acp:*).
Refuse inactive management forms, foreign CSS member controls and ancestor bindings back
to the selected resource. Preserve CSS ACR-self controls as unrelated RDF using the same
dialect-aware target invariant for reads, full-set detachment and single-agent splitting.
ESS app matchers require PublicAgent alongside client; remove this activation marker when
removing the last client so revocation cannot create public access. Client-only ESS input
and special clients such as PublicClient are unsupported. Conjunctions of distinct non-public
selectors must be refused, never treated as empty principal intersections. These refusals
apply to reads and all three mutation operations.

ESS client matching carries a policy-level login requirement. The shared policy projection
must refuse any public result from a policy containing client matchers, including mixed
anyOf alternatives; splitting the policy or removing its last client must never produce
anonymous access. Apply the invariant to resource/member/management policies across own,
ancestor and comments documents and generated-document validation. Independent public
and client policies remain supported.

Allocate ACP roots through one shared writer invariant for full-set and single-agent edits,
including comments: reuse the canonical ACR IRI only when it is unreferenced and either
unused or an existing root bound to the selected resource (or the implicit canonical ESS
root). Otherwise allocate a fresh root. Preserve ACR-self/foreign bindings and identities
used as controls, policies or matchers, including references with no outgoing statements.

Combine each ACP principal's resource modes across documents before role projection, and
emit its effective role for every contributing source. Keep partial source provenance visible.
Inherited rows validate sources only; an explicit selection for the same principal always
takes precedence regardless of input order. Preserve existing modes for unchanged role
selections (including chatroom Write and partial ACP contributions completed by inheritance),
even when another principal changes. Never reconstruct an unchanged selection solely by
inverting the many-to-one role mapping.
