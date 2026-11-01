<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

> **Experimental — AI-agent-generated.** Security-critical WAC/ACP translation extracted from Pod Migrator, Solid/LWS sharing and notification delivery.

Pure, offline access-control readers, writers, a neutral policy model, conservative translation,
inheritance composition, and bounded symbolic access proofs. Pod Migrator consumes this package;
HTTP, group fetching, planning, decisions, conditional writes, and execution remain in the app.

Private at version 0.1.0 pending conformance (ADR-001 D5). Requires Node.js >=24 and the root pnpm workspace tooling.

Readers can return resource, member, and combined rules. `translatePolicy` and `assertNotWider`
require every grant and denial to be normalized to resource scope; they throw otherwise.
Use `scopePolicy` to select and normalize each scope, then translate and prove the two separately.
`policiesEqual` likewise requires normalized policies and returns false for invalid scopes.

## Sharing and access requests

Sharing through the public `@jeswr/storage-client` API, implementing SDK core ADR-003 §9
(T-050/T-051). Requires Node.js >=24. The storage client owns authentication, scope checks, RDF
parsing/serialization and transport errors.

```ts
import { createAccessClient } from '@jeswr/pod-access';

// storage is the StorageClient returned by createPodClient.
const access = createAccessClient({ storage });
const grant = await access.share(resourceUrl, {
  agent: 'https://bob.example/profile/card#me', modes: ['read'],
}, { inherit: false });
const grants = await access.grants(resourceUrl);
await access.revoke(resourceUrl, grant.id!);
```

`model()` reports `features.accessControl.detail.model` when available, otherwise `none`.
`grants`, `share` and `revoke` support Solid WAC/ACP and LWS ODRL grants. `requests` and
`request` support LWS access-request services; other protocols return `unsupported`.
`./testing` remains reserved.

## Solid discovery and conditional edits

The client discovers the associated access document from HEAD: `rel="acl"` for WAC and ACP.
ACP also accepts `rel="http://www.w3.org/ns/solid/acp#accessControl"`. It requires exactly one scoped
link and an existing readable RDF document. It does not guess a suffix, walk parent ACLs,
or create missing access documents: installing an own ACL can replace inherited protection.
See the [WAC discovery rules](https://solidproject.org/TR/wac#acl-link-relation) and
[ACP authorization graph](https://solid.github.io/authorization-panel/acp-specification/index.html#authorization-graph).

Edits clone the complete dataset and call `storage.writeRdf` with the access document's ETag,
preserving unrelated RDF. Missing/empty/wildcard validators fail with `precondition-required`;
412 conflicts propagate without retry. Missing, unreadable or unparsable documents propagate
their storage errors. A reported lack of Control fails locally with `forbidden`; when
WAC-Allow is absent, the server remains responsible for authorizing the conditional write.
Server 401/403 errors propagate unchanged. Named graphs and unexpected 304s are rejected.

## Solid grants

Each `share` creates a new independent authorization or policy and returns its IRI in `id`.
A supplied `grant.id` never updates an existing grant. Agents may be a WebID string,
`{ public: true }`, `{ authenticated: true }`, or (WAC only) `{ group: groupIri }`.
Solid supports `read`, `write`, `append` and `control`; `delete` is LWS-only. Purpose and
expiry constraints return `unsupported` on Solid. Mode lists round-trip explicitly without
adding implied modes.

WAC uses `AclResource`/`Authorization` from `@solid/object`. With `inherit: true` on a
container it writes both `acl:accessTo` and `acl:default`. ACP uses one AccessControl, Policy
and Matcher per grant, with `acp:allow` ACL modes and `acp:allOf` matching a single agent.
Inheritance links the control through both `acp:accessControl` and `acp:memberAccessControl`.
Inherited entries here mean defaults on this document; ancestor grants are not resolved.
ACP roots shared by the requested resource and other resources return `unsupported`.
Every `acp:resource` association must be an IRI, otherwise the document returns `invalid-response`.

`revoke` accepts a `RevocationKey`: an authorization/policy IRI, an agent/group IRI,
`{ public: true }`, or `{ authenticated: true }`. Selectors revoke all matching grants,
including blank-node rules that have no stable id. For example,
`await access.revoke(resourceUrl, { public: true })` removes public grants.
A matching rule id takes precedence over the same IRI used as an agent. WAC retains co-agents,
co-selectors and unrelated resource targets; agent or selector revocation on a rule shared
with other targets is `unsupported`. ACP unlinks this resource's control, retaining definitions that other resources
may reference. Revoking one policy of a multi-policy control is `unsupported`. No matching
grant means no write. Public/authenticated grants can also be revoked by their returned ids.
Malformed selector keys fail before storage operations.

Listing never flattens unsupported conditions into unconditional grants: WAC origins/unknown
conditions and ACP deny/anyOf/noneOf/multiple matchers or conditional matchers return
`unsupported`. Malformed typed RDF returns `invalid-response`.

On Solid, `effective(url)` reads only `storage.head(url).allow`. It returns `null` when unavailable,
otherwise `{ me, public: [] }`. The storage interface exposes only caller modes, so an empty
public list means **unknown**, and is not evidence that anonymous access is denied. It does
not infer public access from the caller's permissions or from access-document contents.

## LWS grants and requests

Pass the canonical storage identifier (`description.id` from `createPodClient`) explicitly;
LWS storage identifiers can differ from `storage.root`. Supply `identity` as a synchronous
callback returning the current caller's identifier, or `null` when signed out. Authentication
and transport remain in storage-client; pod-access does not inspect tokens or fetch directly.

```ts
const access = createAccessClient({
  storage,
  storageId: description.id,
  identity: () => currentCallerIdentifier,
});
const submitted = await access.request({
  target: resourceUrl,
  agent: 'https://id.example/agent',
  modes: ['read'],
  purpose: 'https://purpose.example/collaboration',
  expires: new Date('2030-06-09T10:00:00Z'),
  inbox: 'https://id.example/agent/inbox/', // optional notification destination
});
const requests = await access.requests();
const grant = await access.share(resourceUrl, {
  agent: requests[0].agent,
  modes: ['read'], // the controller explicitly chooses the approved scope
  purpose: requests[0].purpose,
  expires: requests[0].expires,
}, {});
await access.revoke(resourceUrl, grant.id!);
```

The [LWS Access Profile](https://w3c.github.io/lws-protocol/lws10-core/#access-profile)
uses `application/lws+json`, the LWS context, and an `access[]` envelope containing
`AccessPolicy` objects. `@jeswr/solid-odrl` builds the policy; pod-access projects the builder's
JSON-LD to that compact envelope. No remote context is fetched. `purpose` becomes an `eq`
constraint; `expires` becomes an inclusive `dateTime lteq` constraint with an ISO timestamp.

| SDK mode | LWS action |
| --- | --- |
| `read` | `read` |
| `write` | `modify` |
| `append` | `create` |
| `delete` | `delete` |
| `control` | `unsupported` |

Modify and delete remain independent. The ODRL builder's add-only `append` action is projected
to LWS `create`; it never becomes `modify`. Agents may be HTTP(S) identifiers or `{ public: true }`
(FOAF Agent). Groups, authenticated selectors, inheritance and Control return `unsupported`
before writes. All identifiers must be clean absolute HTTP(S) URLs without credentials.
Targets match exact resource identifiers; no ancestor or wildcard access is inferred.

Services come from available `features.accessGrants` / `features.accessRequests`, including an
endpoint and the advertised `https://www.w3.org/ns/lws#AccessProfile` profile. Grant operations
also require `accessControl` to advertise `odrl-grants`. Request services work independently of
grant discovery. Endpoints, listing members, resource targets and returned Locations must pass
`storage.isWithinStorage`; no external service is fetched through another transport.

`requests()` returns `AccessRequest` values (`AccessGrant` plus `target` and optional `inbox`). The
server-assigned resource URL is `id`. Listing follows storage-client pagination, reads each
record and preserves purpose/expiry. A multi-policy or multi-target envelope produces separate
entries sharing one `id`. Unrepresentable target matchers, constraints, context overrides,
unknown policy fields and malformed documents fail closed instead of becoming unconditional
grants. Only purpose `eq` and expiry `lteq` constraints fit the current API; other constraints
return `unsupported`. Date strings require a timezone, a four-digit year and at most millisecond precision.

Revocation resolves ids/agent selectors against the advertised grant listing; it never deletes
an arbitrary URL supplied as a key. It requires each record's non-wildcard ETag and uses a
conditional DELETE without retry. Before any deletion it validates all selected envelopes;
revoking a record that also targets another resource, or revoking by agent when it includes
co-agents, returns `unsupported`. No match means no deletion. Server errors propagate unchanged;
a later deletion failure can leave an earlier deletion completed.

LWS `effective()` summarizes only active grants for the current caller plus public grants.
It excludes expired grants and purpose-constrained grants because this method has no asserted
purpose. An absent/anonymous identity, or an identity change during the read, returns `null`.
An empty result does not account for implicit controller privileges or other server policy;
the server remains the authority for actual access decisions.

The sharing API uses `AccessGrant` (`agent`, an explicit mode array, optional purpose/expiry/id).
The existing `Grant` export remains the neutral translation rule (`who`, a mode Set, scope and provenance).
These types serve different APIs; translation mode implication does not change the sharing client's explicit modes.

## Notification delivery

Notification delivery lives at `@jeswr/pod-access/notify`:

```ts
import { assignmentAnnounce, createNotify } from '@jeswr/pod-access/notify';

const notify = createNotify({ fetch: auth.fetch });
const result = await notify(assigneeWebId, {
  ...assignmentAnnounce(task, tracker, assignerName, title),
  actor: senderWebId,
});
// { delivered: boolean, inbox: string | null,
//   reason?: 'no-inbox' | 'forbidden' | 'lws-no-ldn' | 'network' }
```

Activities support `Announce`, `Offer`, `Accept`, `Reject`, and `Create`; `object` and `actor`
are required, with optional `target` and `summary`. The POST body is ActivityStreams JSON-LD
(`application/ld+json`). Delivery failures resolve as values. An inbox's 401/403 is `forbidden`;
other transport, parsing, policy or HTTP failures are `network`. No unambiguous inbox is `no-inbox`.

Builders return templates without actor: `shareNotification(resource, role)` announces a share
with summary `Shared with you as {role}`; `assignmentAnnounce(task, tracker, assignerName, title)`
announces the task with tracker target and summary `{name} assigned you '{title}'`;
`mentionNotification(annotation, document)` creates an annotation with the document target;
`roomInvitation(room)` offers a room. These helpers do not modify grants or resource data.

Each notifier caches positive and missing-inbox discovery for ten minutes, sharing concurrent
profile reads. Transient failures are retried. Caches hold at most 256 exact WebIDs and belong
to one caller/session: recreate the notifier on account changes. `clock` is injectable for tests.

Known LWS recipients should be identified by `recipientProtocol: webId => 'lws'`; this returns
`lws-no-ldn` without network requests. An `application/lws+json` profile response also returns
`lws-no-ldn`. Unknown recipients are treated as WebIDs; the sender's protocol is irrelevant.

Profile and inbox destinations must be public HTTPS without URL credentials; inbox fragments
and ambiguous inbox assertions are refused. The caller transport must honor `redirect: 'manual'`.
All redirects are refused, bodies are capped at 256 KiB, and requests have an eight-second deadline.
Node hostname targets require an authenticated `pinningFetch` explicitly asserted to pin DNS,
in addition to `fetch`; ordinary pod-auth fetch is not silently treated as pinned. Browsers cannot
pin DNS and use guarded-fetch's browser policy. Activity IRIs currently require HTTPS.

React applications can use `useNotify()` from `@jeswr/suite-sdk` under `PodAuthProvider`; it
supplies the current actor/fetch and resets the cache on identity changes.

## Offline policy translation

```ts
import {
  assertNotWider, readWac, scopePolicy, translatePolicy, unionPolicies, writeAcp,
} from "@jeswr/pod-access";

// Parse RDF with @jeswr/fetch-rdf using the access document URL as baseIRI.
const source = readWac(dataset, sourceResource, sourceAclUrl, "css");
const context = {
  resourceUrl: sourceResource,
  sourceOwner,
  targetOwner,
  targetImplementation: "css",
  groups: new Map(),
} as const;
const sourceResourcePolicy = scopePolicy(source, "resource");
const sourceMemberPolicy = scopePolicy(source, "members");
const resource = translatePolicy(sourceResourcePolicy, "acp", context);
const members = translatePolicy(sourceMemberPolicy, "acp", {
  ...context,
  scopeId: "members:",
});
// Review resource.report and members.report; prove each translated component in its own scope.
assertNotWider(sourceResourcePolicy, resource.policy, context);
assertNotWider(sourceMemberPolicy, members.policy, context);
// Translation returns resource-normalized rules. Restore member scope before serialization.
const policy = unionPolicies(resource.policy, {
  grants: members.policy.grants.map((rule) => ({ ...rule, appliesTo: "members" })),
  denials: members.policy.denials.map((rule) => ({ ...rule, appliesTo: "members" })),
});
const turtle = await writeAcp(policy, targetResource, targetAcrUrl, "css");
// Before persistence, also prove the complete effective target resource and member policies,
// including owner access, retained target rules, and ancestor controls, against their source scopes.
```

The root entry point exports:

- `readWac` / `writeWac`, `readAcp` / `writeAcp`, `AcpDialect`, and `PolicyTooComplex`.
- `translatePolicy`, `TranslationContext`, `reportItem`, and `optionDescriptions`. Report IDs,
  explanations, options, and default decisions retain Pod Migrator's behavior. Translation scopes
  output to the resource and requires normalized input; callers select scopes and restore member
  scope explicitly.
- `emptyPolicy`, `scopePolicy`, `unionPolicies`, `ownerPolicy`, `effectivePolicy`,
  `effectiveMembers`, `assertNotWider`, `policiesEqual`, `ProofContext`, and `subjectKey`.
- The extracted policy/report types and shared RDF helpers (`ACL`, `ACP`, `RDF`, `FOAF`,
  `modes`, `modeIri`, `readModes`, `safeIri`, `RdfNode`, `serialize`, `parent`).

`@jeswr/pod-access/testing` remains reserved and exports nothing.

Server dialects are trusted caller assertions, never inferred from editable RDF. Source readers
retain conservative permissions; target readers use the widest established interpretation and refuse
unsupported restrictions. Non-CSS ACP targets must fit the closed target allowlist. Unsupported
conditions and denials retain the migrator's narrowing decisions; group expansion needs an explicitly
supplied, publicly readable membership snapshot. Writer output alone does not prove migration safety:
callers must retain owner access, validate decisions, prove effective resource and ancestor policies,
and protect persistence with scope checks and reviewed validators.

Run from the workspace root:

```sh
pnpm --filter @jeswr/pod-access run lint
pnpm --filter @jeswr/pod-access... run build
pnpm --filter @jeswr/pod-access run typecheck
pnpm --filter @jeswr/pod-access run test
```

Package tests require 100% branches, functions, lines, and statements, including adversarial target
shapes, malformed RDF, dialect-specific denials, symbolic proof limits, and writer failures.
The migrator retains its end-to-end engine regression and dialect matrix tests.
Tests also cover the reserved testing entry point, notification builders and a byte-snapshotted
assignment delivered through the real notifier and a fixture fetch. Sharing tests use the public
memory storage backend with a HEAD link seam, independent RDF fixtures and byte snapshots;
no live service is needed. Run `pnpm run gate` after the package checks.
