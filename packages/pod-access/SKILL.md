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
AccessClient/LWS work remains separate. The `./testing` entry point remains reserved. The `./requests-solid` entry adds Solid request listing and
decisions ported from Access Manager, granting through `./roles`.

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

For `./requests-solid`, preserve resolve-once target pinning before the Approving CAS, deterministic
grant IDs, create-only records/receipts, ACL writes after the CAS, and forward-only snapshot recovery.
On 412 re-read and observe the winner. Require strong ETags for request updates; grant through
`./roles` `addGrant` (roles, additive, conditional) and rethrow its refusals unretried. Reject off-storage targets and credentialed discovery links.
Keep parsing lenient, byte/member work bounded, and requester metadata notification-local.
Approvals grant Viewer or Editor only (append-only requests are refused). Reject ACP/unknown materialisation with the typed
error, and never read a `rel="acl"` link as proof of WAC (ESS advertises ACRs with it): detect the
model from the advertised document with the roles layer's `detectModel`, check it before using the
records folder ACL, and pin grants to `model: "wac"` (the roles layer then refuses an ACP target
before writing; translate that into `UnsupportedAccessModelError`). WAC expiry is receipt metadata only: document `expiryEnforced: false` and never imply revocation.
Delivery through unauthenticated `publicFetch` is best effort and cannot roll back committed decisions;
it never falls back to global fetch, and requester URLs must be public HTTPS (a URL check only: in
Node pass a DNS-checking `publicFetch`, e.g. `createGuardedFetch()` from `@jeswr/guarded-fetch`).
Records live in an owner-only `settings/access-records/` folder (created or verified before any
write); resume only from the owner's pinned decision there, never from the requester's notification.
Sealing the folder stores a random records key in its ACL (minted only after the folder is shown
private; a key found next to the unverified mark is replaced; a private folder with no key is given
one only while it holds nothing but its ACL, and otherwise refused so its records are never silently
orphaned). Decision records are named from that
key, the request URL, the requester, what was asked and a generation number, and say `approving`,
`approved` or `denied`; a finished record only matches a request in the same state, so a new request
at a reused URL starts a new generation. Grant and denial-receipt IDs derive from the record URL, so
they are bound to the requester. Never grant the storage root (slashless form included) or anything
under `<storage>settings/`, whether discovered or pinned; compare the decoded path
case-insensitively, never raw strings, and refuse any target with a query, fragment, empty segment
or an ambiguous percent-encoding (unreserved characters, `%`, `/`, `\`, controls, invalid UTF-8),
and segments ending in a dot or space or containing `::`;
ordinary encoded names (spaces, non-ASCII) stay shareable; access-control and metadata documents
(`.acl`, `.acr`, `.meta`) are never targets. A resumed approval
(pending or Approving) refuses explicit choices (`dataTypes`, `role`, `expiresAt`) that differ from
the pinned ones. A lost pin or CAS reports the request's re-read status in `RequestConflictError`.
Known limit: a requester-authored `approved` notification at a reused URL that matches an earlier
`approved` record returns that earlier grant (nothing new is granted), and the owner cannot record a
denial for it. Each approved data type
grants only its own requested modes (`modesByType`); a type that grants no mode is dropped.
Request/record documents must be owner-write-only; retries are explicit user-confirmed recovery.
Internal RDF wrappers remain private; the request subpath exports only its typed error classes.

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
redirect refusal and fetch-rdf remote-context refusal. No network in tests. A pinned
`options.model` refuses (`unsupported`, before any write) a resource whose detected model
differs (a behaviour change: these functions used to ignore it); `detectModel` is
read-only and the only path that admits a query-addressed access document (ESS `?ext=acr`).
Writing paths keep refusing queries. `detectModel` fails closed: only an existing, non-empty
access document decides the model, otherwise it reports `unknown`; `isMixedModel` tags its
mixed-model refusals, which requests-solid reports as `UnsupportedAccessModelError("unknown")`.

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
