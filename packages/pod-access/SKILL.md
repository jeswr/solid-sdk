---
name: pod-access
description: Use when maintaining @jeswr/pod-access Solid WAC/ACP or LWS ODRL sharing, access grants and requests, offline policy translation, bounded access proofs or notification delivery.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

This package implements Solid WAC/ACP and LWS ODRL sharing via `createAccessClient` (T-050/T-051),
the offline ACL translation core extracted from Pod Migrator, and notification delivery.
`./testing` remains reserved. Sharing uses `AccessGrant`; the existing neutral policy `Grant`
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

## Notification delivery

`createNotify({ fetch, clock?, recipientProtocol?, pinningFetch? })` returns a callable
`notify(agentWebId, activity)`. Supply the pod-auth fetch and an explicit actor WebID.
Builders return templates without actor: `shareNotification`, `assignmentAnnounce`,
`mentionNotification`, `roomInvitation`. Preserve Tasks §5.7's assignment summary exactly.
Delivery failures return structured values and never throw. Do not change permissions here.

Discovery caches exact recipient WebIDs for ten minutes within a notifier instance; recreate
the notifier on account/session changes. Known LWS recipients use `recipientProtocol(webId)`;
never infer the recipient's protocol from the sender's storage. LWS media types also short-circuit.
Only one unambiguous NamedNode inbox on the exact WebID subject is accepted. Profiles and
inboxes use public HTTPS and refuse redirects. Node hostname targets require an authenticated
`pinningFetch`; never silently label an ordinary auth fetch as DNS-pinned. Browsers retain the
guard's documented DNS limitation. All parsing goes through fetch-rdf, with remote contexts refused.
