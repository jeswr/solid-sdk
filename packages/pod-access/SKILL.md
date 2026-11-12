---
name: pod-access
description: Use when maintaining @jeswr/pod-access Solid WAC/ACP or LWS ODRL sharing, access grants and requests, offline policy translation, bounded access proofs or notification delivery and inbox reading.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

This package implements Solid WAC/ACP and LWS ODRL sharing via `createAccessClient` (T-050/T-051),
the offline ACL translation core extracted from Pod Migrator, and notification delivery.
`./testing` remains reserved. The `./roles` subpath owns the injected-fetch Solid role client
from SDK-APP-04 (role/mode mapping, `readGrants`, `setGrants`, `addGrant`, `removeGrant`). The `./requests-solid` entry adds Solid request
listing and decisions ported from Access Manager, granting through `./roles`. Sharing uses `AccessGrant`; the existing neutral policy `Grant`
keeps its Set-based modes, conditions, scope and provenance for translation consumers.
Design of record:
SDK core ADR-001 D4 and `ADR-003-storage-client.md` §9 in `solid-suite-planning/specs/sdk-core/`.
Read this repository's `AGENTS.md` and the package README before edits.

## Sharing client

Use [storage-capabilities](../storage-capabilities/SKILL.md) to inspect access-control models
and request/grant service features. Availability describes server support, not caller permission.
`ReadResult.allow === null` means no usable hint; it establishes neither denial nor access.
Read [LWS app differences](../../skills/lws-vs-solid/SKILL.md) for grant versus token semantics;
WAC documents do not apply to LWS grant services.

Use the public StorageClient interface. Never fetch directly or reach into backends. `model()`
comes from available `features.accessControl`; Solid methods use HEAD's advertised ACL/ACR
link, readRdf, then writeRdf with the access document's non-wildcard ETag. No automatic retries,
suffix guesses, ancestor resolution or creation of missing access documents. Preserve unrelated
RDF. Refuse advertised lack of Control; absent WAC-Allow leaves authorization to the server.

Read and author access graphs using `@solid/object` AclResource/Authorization and
AccessControlResource/AccessControl/Policy/Matcher, with typed `@rdfjs/wrapper` accessors for
multi-valued WAC fields. Never hand-build triples. Reject unsupported conditions rather than
represent conditional grants as unconditional. Named graphs and malformed typed RDF fail closed.

Every share creates a separate rule; caller-supplied ids never overwrite rules. Inheritance
requires a container and writes both direct and default/member control. WAC revoke preserves
co-agents, co-selectors and other targets. Before filtering WAC rules, reject matching
`acl:defaultForNew` with `unsupported` for listing/revocation, even without modern targets:
the NSS translation reader recognizes these legacy inherited grants, but sharing has no trusted
WAC dialect. Preserve unrelated legacy defaults. ACP revoke unlinks local controls, preserving shared
definitions; multi-policy control revocation is unsupported. RevocationKey accepts grant ids,
agent/group IRIs, `{ public: true }` and `{ authenticated: true }`. Explicit selectors also
revoke blank-node rules, which have no stable grant id. Validate and snapshot selector keys
before storage operations; shared WAC targets still fail closed.
On Solid, purpose/expiry and ACP groups/reserved agent IRIs passed as WebIDs are unsupported.
ACP operations require `acpDialect: 'css' | 'ess'` from trusted deployment knowledge;
never infer it from editable RDF. Sharing reuses the translation core's mode activation and
serialization: CSS `acl:*`, ESS `acp:*`. Unknown dialects refuse before I/O. ESS resource
Control sharing is unsupported. Refuse `acp:access`/`acp:memberAccess`, ACR-self resource
bindings and resource-less fragment/blank roots before listing or any edit; these must never
be silently skipped during revocation. Resource-less canonical roots require the ESS dialect
and `acp:AccessControlResource` type. Before omitting foreign roots, run the translation reader's
placement validation: potentially active foreign `accessControl` and `memberAccessControl` grants
must fail with `unsupported`, including shared controls. Keep the shared translation semantics in sync.

On Solid, `effective()` uses only HEAD's caller `allow` booleans, without adding implied modes. It returns
null when absent; `public: []` means unknown because StorageClient exposes no anonymous modes.
On LWS, `effective()` instead summarizes active grants for the injected caller identifier plus
public grants, excluding purpose constraints. It returns null for absent/anonymous or changed
identity. Testing fakes remain reserved.

LWS uses available AccessGrantService/AccessRequestService feature endpoints advertising
`lws:AccessProfile`. Request services work independently of grant discovery; grant operations
also require `odrl-grants`. Require an explicit canonical `storageId` (description.id), which
can differ from storage.root, and an `identity: () => string | null` callback for effective().
Use only storage.create/read/listAll/delete. Every service, target, member and Location must
pass storage.isWithinStorage. Never guess endpoints or reach into backends.

Build with @jeswr/solid-odrl policyToJsonLd and project its permissions into the LWS
AccessGrant/AccessRequest envelope with the fixed LWS context and application/lws+json.
Read maps to read; write maps only to modify; append maps to create; explicit delete maps to
delete. The builder's add-only append is deliberately converted to LWS create. Control,
inheritance, authenticated and group selectors are unsupported. Solid rejects delete mode.
Purpose maps to eq and expiry to inclusive dateTime lteq. Never drop an unknown restriction:
reject context overrides, unknown fields, unsupported matchers/operators and malformed records.
No remote JSON-LD context loading. Read only timezone-qualified dateTimes representable by Date.

AccessRequest extends AccessGrant with target and optional inbox; server resource URLs become ids.
Listing can project multiple entries from one envelope. Revoke resolves ids/selectors through
the grant listing and conditionally deletes each record with its own safe ETag. Validate all
selected records before any deletion; refuse envelopes spanning other resources, or co-agents
for agent/public selector revocation. Preserve public/modify/create/delete distinctions and
snapshot mutable inputs before the first await. No retry or automatic request approval.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and
adversarial tests with implementation changes. Tests use the public memory storage backend
with a HEAD link seam, independent RDF fixtures and byte snapshots; no live service is needed.
Keep development tool versions aligned with the root. Validate `lint`, dependency-first `build`,
`typecheck` and `test`, then the repository gate.

## Offline policy translation

The root exports WAC/ACP readers/writers, neutral policy/report types, conservative translation,
inheritance composition and bounded access proofs. See README.md for exports. Keep the migrator's
conservative source readings, widest target readings, target ACP allowlist, bounded complexity,
report IDs/options and dialect behavior. Server implementation is a trusted caller assertion,
never derived from editable access RDF. Normalize resource/member scopes before translation
and proof, then restore member scope before serialization.

In-process callers are trusted code. Keep internal mode lists private and frozen and helper
classes out of public exports; no export may let one caller alter another caller's proof.
The public mode list is a frozen copy; returned policies and reports are caller-owned.
Patching shared JavaScript built-ins or dependencies directly is outside this trust boundary.

The migrator owns HTTP, public group snapshots, review decisions, effective target phase proofs,
scope checks, conditional persistence and execution. Serializing a translated policy alone does
not establish safe migration. Run its regression suite when changing the translation core.

## Notification delivery and reading

`createNotify({ fetch, clock?, recipientProtocol?, pinningFetch? })` returns a callable
`notify(agentWebId, activity)`. Supply the pod-auth fetch and an explicit actor WebID.
Builders return templates without actor: `shareNotification`, `assignmentAnnounce`,
`mentionNotification`, `roomInvitation`. Preserve Tasks §5.7's assignment summary exactly.
Delivery failures return structured values and never throw. Do not change permissions here.

Discovery caches exact WebIDs for ten minutes, shared by notifiers/readers with identical
fetch, pinningFetch and clock functions. Supply fresh transport wrappers on account/session changes. Known LWS recipients use `recipientProtocol(webId)`;
never infer the recipient's protocol from the sender's storage. LWS media types also short-circuit.
Only one unambiguous NamedNode inbox on the exact WebID subject is accepted. Profiles and
inboxes use public HTTPS and refuse redirects. Node hostname targets require an authenticated
`pinningFetch`; never silently label an ordinary auth fetch as DNS-pinned. Browsers retain the
guard's documented DNS limitation. All parsing goes through fetch-rdf, with remote contexts refused.

`createInboxReader({ fetch, pinningFetch?, clock?, maxItems? })` wraps the client reader.
`inbox(webId)` returns the owner's inbox or null, including LWS profiles. `list(inboxUrl,
{ signal? })` returns `InboxNotification[]` newest first, undated last, deterministic URL ties.
Reuse the shared pure scope/parser/ordering helpers and discovery cache; never import the
Node transport into the client entry. Fetch at most maxItems children (default 50) with at
most six requests active. Refuse foreign/outside/nested/query/fragment/encoded-slash members.
Unreadable members are skipped; container 401/403/404 and parse failures return []; other
container failures reject. Aborts reject with AbortError and start no further requests.
There is no mark-read/delete API. `notificationKind(n)` maps Announce share summaries before
Announce targets, then Create targets, then Offer to share/assignment/mention/invitation;
every other shape is other. Keep wrapper and builder round-trip coverage at 100%.

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

`notify`/`message` only record a no-op delivery hook (SDK-APP-07). `decide()` lives in `./requests-solid`.
`movePreservingAccess` is exported from `./roles` (see README.md). The root remains the migrator's offline API;
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

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

For `./roles`, `kind: "folder"` with a trailing-slash URL edits resource and member scope
together: WAC uses accessTo + default on the same authorization; ACP uses accessControl +
memberAccessControl with the same policy. All three mutations use both scopes;
revocation removes both. Non-folder operations preserve their resource-only contract.
Before reads and every mutation, refuse own-folder permissions whose per-principal modes
differ between resource and member scope with typed `partial-scope` (mutations report it
in `failed`, without writes). This includes members-only rules and no-op selections.
Track each policy placement's management provenance: exempt only ESS own-ACR `access`
and own-ACR `accessControl` management. Member `memberAccess` and own-ACR
`memberAccessControl` management must still cause `partial-scope`, including policies
shared with own-ACR management. Never rewrite descendant access
documents. Test shared principals, foreign targets, metadata, both scopes, owner lockout
and ETag races; preserve 100% coverage.

`movePreservingAccess(storage, from, destinationContainer, options)` extends the role mutation
options with `name?`, `acceptReset?`, and `signal?`. Native moves bypass access. Emulated Solid
moves snapshot own roles across at most 2,000 resources including the root, refuse lossy source
policies, preflight destination expressibility and lockout, then use `setGrants` with
`ownOnly: true` (no WAC ancestor materialisation). Inherited access follows destination ancestors
and is not reported as dropped. Folder roles require equal direct/member scopes; separate
comments-container moves refuse. No auxiliary access or describedby documents are role targets.
Unsupported destination grants require `acceptReset` and return `preserved: false` with original
URL/grant/reason entries in `dropped`; warn only on that result. `reapplied` contains destination
resource URLs. Reapplication failure/abort moves back and restores the snapshot without the
caller signal. Typed StorageError conflicts expose `step: reapply | rollback-failed`, `from`,
`to` and last known `url`; rollback failures retain both causes. Never retry or widen a grant.


`movePreservingAccess` emulation stages inside pod-access, never through `storage.move`:
preflight destination caller Control even for an empty own selection, and lockout-check every
planned own ACL/ACR. Snapshot resource and own-document ETags, endpoint and presence/absence;
require strong validators. Create exact-name empty placeholders top-down, install own grants
with `ownOnly: true`, read back and verify own rows/document presence, then stream content
with the placeholder ETag. Verify parents before creating children. Preserve inheritance for
items without own documents; preserve the presence of empty own ACP documents too. Re-read source validators before each access application and
across the whole source before any deletion; any change is conflict, including ACL appearance
or disappearance. Verify destination access and caller management before deleting sources.

Mirror storage-client's private container-RDF allow-list and 2,000-entry cap through public
storage APIs; exclude auxiliary access/metadata documents and drop describedby metadata.
Refuse names public decoded-name `create` cannot reproduce exactly. Read one resource stream
at a time. Delete sources bottom-up with snapshot resource ETags; after child deletions change
a container ETag, require verified-empty server-managed RDF and its fresh strong validator.
Delete listed source access documents after their protected data; refuse incompatible placements.
Before deletion, failure/cancellation leaves sources untouched and conditionally cleans up
copies bottom-up, ignoring the caller signal (`step: reapply`); cleanup failures are
`rollback-failed` with both roots and all causes. Content-bearing residuals have verified own
access (or source-equivalent inheritance); an access-installation failure may leave an empty
placeholder. Once deletion begins, stop on failure with `step: source-delete`, retaining the
whole verified destination and any remaining source items. Never recreate data or move it back.
Native moves still delegate unchanged. Keep ordering, validator races, cleanup/deletion failures,
lockout, aborts and both WAC/ACP transports covered at 100%. README documents non-atomic ancestor
and final-check races; never promise transactional visibility.

`./roles` exports `verifyPrivateDemoAccess(session, target, owner)`, the shared fail-closed
check for the isolated demo backend, and `ensurePrivateContainerAccess(session, target)`.
Call the latter only for an empty private container before writing any contents. Real
sessions provision owner manager grants for both resource and members using `setGrants`
and read them back. Unsupported models, inherited grants and verification failures refuse
private writes. The session supplies fetch, storageUrl, webId and mode.
