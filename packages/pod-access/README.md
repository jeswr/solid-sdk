<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

> **Experimental — AI-agent-generated.** Security-critical WAC/ACP translation extracted from Pod Migrator, Solid/LWS sharing and notification delivery.

Offline access-control readers, writers, a neutral policy model, conservative translation,
inheritance composition, and bounded symbolic access proofs. Pod Migrator consumes this package;
migration HTTP, group fetching, planning, decisions, and execution remain in the app.
The `./roles` subpath adds injected-fetch Solid sharing with conditional persistence, and
`./requests-solid` provides the Solid request inbox and decision pipeline on top of it.

Private at version 0.1.0 pending conformance (ADR-001 D5). Requires Node.js >=24 and the root pnpm workspace tooling.
The `./roles` subpath implements the Solid sharing portion of SDK core ADR-003 §9 as standalone
injected-fetch role functions (SDK-APP-04), beside the `createAccessClient` sharing client and LWS grants.

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
// Set acpDialect only from independent knowledge of the deployment (here CSS).
const access = createAccessClient({ storage, acpDialect: 'css' });
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
container it writes both `acl:accessTo` and `acl:default`. Listing and revocation return
`unsupported` for matching legacy `acl:defaultForNew` rules, including rules without modern
targets: NSS can activate these inherited grants, and the sharing client has no trusted WAC dialect.
Legacy defaults for other targets are preserved. ACP requires an explicit trusted
`acpDialect: 'css' | 'ess'` assertion; absent or unknown dialects return `unsupported` before I/O.
Never infer the dialect from editable access RDF, hostname guesses, or capability diagnostics.
Mode activation and serialization reuse the offline translation core: CSS uses `acl:*` modes,
ESS uses `acp:*` modes. ACP uses one AccessControl, Policy and Matcher per grant,
with `acp:allOf` matching a single agent. ESS resource Control is inactive, so sharing Control
on ESS is `unsupported`; its ACR access policies require a richer editor.
Inheritance links the control through both `acp:accessControl` and `acp:memberAccessControl`.
Inherited entries here mean defaults on this document; ancestor grants are not resolved.
ACP roots shared by the requested resource and other resources return `unsupported`.
Documents with potentially active grants on foreign roots also return `unsupported`, for both
`acp:accessControl` and `acp:memberAccessControl`, including controls shared with a local root.
Foreign-root placement validation reuses the translation reader before listing or any edit;
revocation cannot succeed after merely unlinking local controls while foreign grants remain active.
Every `acp:resource` association must be an IRI, otherwise the document returns `invalid-response`.
Resource-less roots are accepted only for a typed canonical ESS ACR subject. Resource-less
fragment/blank roots, ACR-self resource bindings, and `acp:access`/`acp:memberAccess` policies
return `unsupported` for listing, sharing and revocation, even when another root could be edited.
Revocation never reports success after silently ignoring those potentially active Control grants.

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

## Notification delivery and reading

Notification delivery lives at `@jeswr/pod-access/notify`:

```ts
import { assignmentAnnounce, createInboxManager, createNotify } from '@jeswr/pod-access/notify';

const notify = createNotify({ fetch: auth.fetch, webId: auth.webId });
const result = await notify(assigneeWebId, {
  ...assignmentAnnounce(task, tracker, assignerName, title),
  actor: senderWebId,
});
// { delivered: boolean, inbox: string | null,
//   reason?: 'no-inbox' | 'forbidden' | 'lws-no-ldn' | 'network' }
```

Activities support `Announce`, `Offer`, `Accept`, `Reject`, `Create`, `Invite` and `Update`;
`actor` is required, with optional `object`, `target`, `summary` and `content`.
The client binds `actor` to the authenticated `webId` supplied at construction and refuses
mismatches as `invalid-actor`. It builds a typed RDF/JS dataset and serializes with n3.Writer
as `text/turtle`, using the relative named subject `#it`. Non-HTTPS optional object/target
links are omitted. Issue drafts include PROV-O attribution and generation time.
Delivery failures resolve as values: `no-inbox`, `lws-no-ldn`, `invalid-target`,
`profile-unreadable`, `forbidden` (inbox 401/403), or `network`. HTTP failures retain `status`.

Builders return templates without actor: `shareNotification(resource, role)` announces a share
with summary `Shared with you as {role}`; `assignmentAnnounce(task, tracker, assignerName, title)`
announces the task with tracker target and summary `{name} assigned you '{title}'`;
`mentionNotification(annotation, document)` creates an annotation with the document target;
`roomInvitation(room)` offers a room. `issueAnnounce(issue, recipient, summary)` preserves
an issue event's recipient target and app-provided summary in an Announce draft.
These helpers do not modify grants or resource data.

Notifiers and readers cache positive and missing-inbox discovery for ten minutes, sharing concurrent
profile reads when fetch, pinningFetch and clock identities match. Transient failures are retried. Caches hold at most 256 exact WebIDs and belong
to one caller/session: supply fresh transport wrappers on account changes. `clock` is injectable for tests.

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

`createInboxReader({ fetch, pinningFetch?, clock?, maxItems? })` at the same `./notify` subpath
is a thin browser-safe reader wrapper. `inbox(webId)` discovers the owner's inbox or returns
null (including LWS profiles). `list(inboxUrl, { signal? })` returns `InboxNotification[]`,
newest first with undated items last and URL ties deterministic. Items carry `url`, `type`
and optional `actor`, `object`, `target`, `summary`, `content`, `name`, `published` (ISO string).
Legacy names and valid untyped publication dates are retained. `includeUnknownActivities: true`
keeps even empty readable RDF as unknown notifications (Issues opts in); the fallback label
does not assert an ActivityStreams type IRI. `listPage(inboxUrl, { signal? })`
returns `{ notifications, members, truncated }`: `members` includes all eligible direct children read before the byte ceiling,
and `truncated` reports whether the listing exceeded the byte or item ceiling, even when
individual fetched members could not be read.

Reads use the delivery transport's HTTPS, redirect, byte and deadline guards. At most
`maxItems` direct children (default 50, non-negative safe integer up to the exported `MAX_INBOX_ITEMS` of 500) are fetched in listing
order, with concurrency at most six. Foreign, outside-container, nested, query/fragment and
encoded-slash members are never dereferenced; unreadable members are skipped. Container
404 or RDF parse failures return `[]`; 401/403 and other container failures reject. Abort rejects
with `AbortError` and stops new work. `createNotifyFetch({ fetch, pinningFetch? })` exposes
the same transport for notification-linked foreign resources. It also refuses a final response
URL different from the requested document if a caller transport ignored manual redirects.

`createInboxManager({ webId, storageRoots, fetch, pinningFetch?, clock?, maxItems? })`
discovers the owner's inbox, returning `null` if absent or outside the active storage roots
(or query-addressed). Supply trusted roots from the authenticated session. The returned
`{ inboxUrl, list, listPage, markRead, dismiss }` pins all writes to direct children of that inbox:

```ts
const inbox = await createInboxManager({
  webId: auth.webId, storageRoots: [storage.root], fetch: auth.fetch,
});
if (inbox) {
  const [notification] = await inbox.list(); // each also has read: boolean
  if (notification) {
    await inbox.markRead(notification.url);
    await inbox.dismiss(notification.url);
  }
}
```

Read state uses same-container `<notification>.read.ttl` sidecars. Sidecars remain in
`members` for read state but are never fetched or counted against the notification budget.
The manager fetches up to `MAX_INBOX_ITEMS`, sorts newest first, then applies its optional
display `maxItems` (default the package maximum). `listPage()` returns notifications and
`truncated`; apps must surface that flag, since a bounded listing may omit newer items.
Listing overflow retains complete RDF statements already read and sets `truncated: true`;
individual notification bodies still fail at 256 KiB.

Mark-read PUT and notification DELETE are unconditional, idempotent operations: they do
not merge existing data and require no HEAD or ETag. Dismissal tolerates 404 and cleans up
its sidecar best effort. Strong ETag preconditions remain required for read-modify-write
operations elsewhere in this package. Only direct notification children of the owner's
inbox are valid mutation targets; read markers cannot be supplied as notification targets.
Foreign/outside/nested/query/fragment/credentialed/encoded-delimiter targets fail before I/O.

Production delivery permits public HTTPS on port 443 only. All branches reject single-label
hosts, empty DNS labels, trailing dots, private/reserved IPs, userinfo and redirects.
Own-storage GET/HEAD may use any HTTPS port when `ownStorageRoots` comes from the trusted
session. This never relaxes foreign reads or POST/PUT/DELETE port checks. `devLoopback: true`
is an explicit app opt-in for HTTP(S) on exactly localhost, 127.0.0.1 or [::1], on any port;
it never permits general HTTP or another private host. Issues enables it only when the app
itself runs on one of those loopback hosts. Node public hostnames still require DNS pinning;
browsers retain the documented DNS limitation.

`notificationKind(notification)` classifies builder round-trips as `share` (Announce with
summary starting `Shared with you as `), `assignment` (Announce with target), `mention`
(Create with target), `invitation` (Offer), or `other`. Share summaries take precedence
when an Announce also has a target. React consumers use `useInbox()` from suite-sdk.

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

- `readWac` / `writeWac`, `readAcp` / `writeAcp`, `AcpDialect`, and `isPolicyTooComplex(error)`.
- `translatePolicy`, `TranslationContext`, `reportItem`, and `optionDescriptions`. Report IDs,
  explanations, options, and default decisions retain Pod Migrator's behavior. Translation scopes
  output to the resource and requires normalized input; callers select scopes and restore member
  scope explicitly.
- `emptyPolicy`, `scopePolicy`, `unionPolicies`, `ownerPolicy`, `effectivePolicy`,
  `effectiveMembers`, `assertNotWider`, `policiesEqual`, `ProofContext`, and `subjectKey`.
- The extracted policy/report types and shared RDF helpers (`ACL`, `ACP`, `RDF`, `FOAF`,
  `modes` (a frozen copy), `modeIri`, `readModes`, `safeIri`, `serialize`, `parent`).

`@jeswr/pod-access/testing` remains reserved and exports nothing.

In-process callers are trusted code. Internal mode lists are private and frozen, and public
offline exports expose no reader or error classes, so one caller cannot alter another caller's proof
through exported state or helper prototypes. Returned policies and reports are caller-owned.
Patching shared JavaScript built-ins or dependencies directly is outside this trust boundary.

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

<!-- AUTHORED-BY Codex -->
<!-- AUTHORED-BY Codex GPT-6 -->

`@jeswr/pod-access/roles` exports `rolesToModes`, `modesToRole`, `grantsWithRoles`,
`readGrants`, `setGrants`, `addGrant`, `removeGrant`, `movePreservingAccess`, `isRoleError`, and their documented types
(`Role`, `ResourceKind`, `AgentRef`, `RoleGrant`, `GrantSnapshot`, `RoleModes`, `RoleContext`,
`RoleError`, `RolesOptions`, `GrantMutationOptions`, `SetGrantsOptions`, `SetGrantsResult`).
It does not change the offline root API.

```ts
import { readGrants, setGrants } from "@jeswr/pod-access/roles";

const options = { fetch: authFetch, webId, root: "https://pod.example/" };
const snapshot = await readGrants(resourceUrl, options);
const result = await setGrants([resourceUrl], [
  ...snapshot.grants,
  { agent: { type: "webid", id: friendWebId }, role: "viewer",
    inherited: false, source: "" },
], { ...options, expected: snapshot, notify: true, message: "Shared with you" });
// Check result.failed; applied includes only URLs that completed all their writes.
```

Roles are `viewer | commenter | editor | manager`; kinds are
`resource | folder | document | chatroom` (default `resource`). `RoleModes` separates
`resource`, `comments`, and `acr` arrays of the existing lowercase neutral `Mode` type.
`rolesToModes(role, kind, ctx)` grants Read to viewers; commenters add Append on
`ctx.commentsContainer` (required for documents; without it other kinds project to viewer).
Editors get Read+Write+Append, or Read+Append for chatrooms. Managers add WAC or CSS ACP
resource Control; ESS ACP managers instead add Read+Write on the own ACR.
`modesToRole(modes, kind, ctx?)` accepts either those split
arrays or an iterable of resource modes, returns the highest fully covered role, and
returns undefined for partial management or odd permissions. Append on a file is not
comment access. WAC is the mapping default; for ACP pass `model: "acp"` and the trusted
`implementation` (`css` by default, or `ess`) to both mapping helpers. Given to the reading and
writing functions (`grantsWithRoles`, `readGrants`, `setGrants`, `addGrant`, `removeGrant`),
`model` pins the access model instead: a resource whose detected model differs is refused with an
`unsupported` `RoleError` before anything is written. Leave it unset to work with either model.
This is a behaviour change: these functions used to ignore `model` and go on with whichever model
the resource used, so a caller that passed it for mapping now gets a refusal on the other model.

`AgentRef` supports WebIDs, public and authenticated agents, WAC groups, and ACP apps
(client matchers). ACP groups require a membership snapshot and WAC cannot express apps;
those combinations are refused. `RoleGrant` includes `agent`, `role`, optional `expiresAt`
and `purpose`, `inherited`, and `source` (governing document URL). WAC/ACP cannot express
expiry or purpose: specifying either rejects the entire call before I/O with a typed
`RoleError` carrying `code: "unsupported"` and `feature: "accessControl"`. This is the
StorageError-compatible local error contract; no storage-client dependency is introduced.
Use `isRoleError` and `code` to classify errors; no error class/prototype is exported.

Discovery uses advertised Link `rel="acl"` endpoints (also the ACP accessControl relation),
RDF vocabulary and ACP type links. WAC stops at the nearest existing ACL, including an
empty one; ACP adds ancestor member controls. ACP modes for each principal are combined
across all contributing documents before role projection. Each contributing source gets
a row with that effective role, including sources with only part of its required modes.
Returned rows retain each document's origin;
odd/partial permissions are omitted, never rounded up. Conditional or richer policies are
refused instead of silently replaced. Comments are read via `commentsContainer` when supplied;
a commenter that depends on inherited Append names that comments ancestor as its source.
Round-tripping those inherited rows preserves explicit Read and sends no writes.
`implementation` is a trusted caller assertion (default `css`; `ess` selects ACP mode
vocabulary, ACR management and client activation; `nss` enables legacy WAC defaultForNew),
never inferred from editable RDF. ACP mode vocabulary must match the implementation
(`acl:*` for CSS, `acp:*` for ESS); inactive vocabulary is refused before normalization.
CSS-inactive ESS management forms and CSS foreign member bindings are refused. Ancestor
bindings back to the selected child are also refused rather than hiding effective access.
CSS ACR-self access controls remain unrelated RDF and do not project as resource access.
Conjunctions of distinct non-public selectors (including named agent with client or
AuthenticatedAgent) are refused by every roles operation. ESS app matchers include the
required PublicAgent activation alongside the client restriction; client-only ESS matchers
and special clients such as PublicClient are refused. Removing an app's last client also
removes its activation marker. ESS policies that combine a public alternative with client
matchers are refused when their role projection would lose the policy's login requirement.
This check covers resource, member and ACR management policies in own, ancestor and comments
documents, for reads and every mutation.

`setGrants` applies the full requested **explicit** set to each resource, preserving
unrelated targets and annotations. With `kind: "folder"` and a trailing-slash URL, each
changed grant covers both the folder and its members: WAC writes `acl:accessTo` and
`acl:default` on the same authorization; ACP links a matching policy through
`acp:accessControl` and `acp:memberAccessControl`. Removal clears both scopes.
`addGrant` and `removeGrant` use the same folder scope. Non-folder operations retain their
resource-only behavior. Descendants' own access documents are never rewritten.

Existing folder permissions must match between resource and member scope, after combining
each principal's modes in the own document. A resource-only, members-only, or differently
scoped permission causes a typed `RoleError` with code `partial-scope`: `readGrants` rejects,
and mutations report the refusal in `failed` without a PUT, including no-op selections.
This conservative boundary prevents an ordinary role row from silently widening or narrowing
legacy folder access. Only ESS own-ACR management (`acp:access` or own-ACR
`acp:accessControl`) is exempt from this comparison. Member management through
`acp:memberAccess` or own-ACR `acp:memberAccessControl` remains scoped and causes
`partial-scope`, even when the same policy also grants own-ACR management.
Inherited rows are read-only and must match their governing source. They never overwrite an explicit selection for the same
principal, regardless of row order. An unchanged role selection preserves that principal's
existing modes, including chatroom Write and partial ACP contributions completed by
inheritance. A changed role is mapped using the requested kind and implementation.
On the first explicit WAC change, effective inherited
authorizations are copied to an own ACL, changing default to accessTo; copied container
defaults also continue protecting descendants. A `pod-access:materializedFrom` annotation
preserves these copied grants across repeated applications even when omitted from the
explicit selection. Explicitly selecting that agent can change the local copy. Ancestors
are never edited. Unchanged documents receive no PUT. Comment changes preserve unrelated
container permissions and refuse to discard Write as if it were only Append.
ACP writes reuse the canonical ACR IRI only when it is unreferenced and either unused or
already a root for the selected resource. Existing ACR-self and foreign bindings, and
identities used by controls, policies or matchers, remain separate from generated roots.

`readGrants(url, options)` returns a JSON-serialisable `GrantSnapshot` with `{ url, grants,
version }`. `grantsWithRoles(url, options)` keeps returning the plain array and is exactly
`(await readGrants(url, options)).grants`. The opaque version token records the own ACL/ACR
ETag or its absence, every governing inherited document's URL and ETag, and the same state
for the comments container. It also binds the resource kind and trusted implementation.
Store or JSON round-trip the token verbatim; its encoding is private. Missing ETags remain
readable but prevent changes that need those validators.

For read-modify-write, pass `expected: snapshot` to `setGrants`, or use a per-resource map
`expected: { [snapshot.url]: snapshot.version, [second.url]: second.version }`. Every selected
URL needs its own token. Planning re-reads raw RDF and requires its validators to match the
snapshot before diffing: the baseline is the state captured by the snapshot, and untouched
RDF retains its full detail. The token is authoritative; editing `snapshot.grants` does not
change the baseline. A stale token, different discovery, or changed governing source reports
a typed `conflict` naming the selected URL, including when an absent own document has since
been created. Conditional PUTs retain that baseline's ETag or absence precondition. Without
`expected`, `setGrants` reads a fresh baseline as before. Reapplying an unchanged selection
against a current snapshot sends no write. A successful changed write consumes its old token;
read another snapshot before the next full-set edit. Stale tokens also fail for no-op selections.

Access-request approvals can use the single-agent operations directly:

```ts
import { addGrant, removeGrant } from "@jeswr/pod-access/roles";

const grant = { agent: { type: "webid" as const, id: requesterWebId },
  role: "viewer" as const, inherited: false, source: "" };
const approval = await addGrant([resourceUrl], grant, { fetch: authFetch, webId });
// Inspect approval.failed before marking the access request approved.
const revocation = await removeGrant([resourceUrl], grant.agent, { fetch: authFetch, webId });
```

`addGrant(urls, grant, options)` reads each URL and adds or raises only that agent's direct
role, preserving all other agents' authorization semantics, shared scopes and annotations.
It never performs a full-set replacement or lowers an existing higher role. An equal or
higher effective role is a successful no-op, including inherited roles; crash-recovery replays
therefore converge. `removeGrant(urls, agent, options)` removes that agent's direct resource
role and its direct commenter Append where applicable; an absent direct grant is a no-op.
Inherited resource grants must be removed at their source (`inherited-grant`); inherited
comments remain intact, and comments Write cannot be discarded as Append. Both operations
use `GrantMutationOptions` (injected fetch, caller WebID and the usual role context), return
the same per-URL `SetGrantsResult` as `setGrants`, preflight caller lockout, and write with
If-Match or If-None-Match: *. Neither retries conflicts. `addGrant` rejects expiry/purpose
before any I/O, just like `setGrants`.

Every replacement uses the fetched ETag verbatim in If-Match (weak tags are passed through);
creation uses If-None-Match: *. Wildcard or malformed response validators are refused.
Governing validators and discovery are re-read before writes.
A 412 produces a typed conflict naming the resource URL, stops writes for that URL, and
appears in `failed: [{ url, error }]`; successful URLs appear in `applied`. Missing validators
refuse writes. Self manager/Control access is checked across the entire batch before any
PUT; removing it rejects with `owner-lockout`. A directly established inherited ACP Control
can preserve the caller's management access. Public, group or app access is not an adequate
substitute for the caller's own identity in this guard.

The batch and resource/comments documents are **not transactional**. A failed URL can have
an earlier successful auxiliary write; inspect failures and re-read before retrying. There
is no automatic retry or rollback. Revalidation reduces races but cannot atomically lock
ancestor documents together with an own ACL/ACR PUT. `notify` and `message` are accepted and
recorded in `result.notification`, with `delivered: false`; SDK-APP-07 will add delivery.

All requests use the required injected guarded/authenticated fetch, disable redirects and
caching, and restrict discovery to `root` (default the origin root). Supply the actual pod
root when a host serves several pods. Access RDF is limited to 1 MiB, 10,000 quads and a
64-step ancestor walk; remote JSON-LD contexts and named graphs are refused. No group or
app identifier is fetched. RDF edits use typed wrappers and n3.Writer. The roles tests use
in-memory HTTP fixtures only.

### Moves that preserve sharing

```ts
import { movePreservingAccess } from "@jeswr/pod-access/roles";

const moved = await movePreservingAccess(storage, resourceUrl, destinationContainer, {
  fetch: authenticatedFetch, root: storage.root, webId, name: "renamed.txt", signal,
});
// Persist moved.url. Drive shows its sharing-reset warning only if !moved.preserved.
```

`MovePreservingAccessOptions` extends `GrantMutationOptions`: the guarded authenticated fetch,
caller WebID, root and trusted implementation are the usual role options. As with `storage.move`,
`to` is a destination container; optional `name` is a decoded name hint. Always use the returned
`url`. An advertised native move bypasses access entirely and returns `preserved: true`, with
empty `reapplied` and `dropped` arrays. This supports native LWS moves without treating ODRL as WAC.

Emulated Solid moves run a staged copy inside pod-access; they never call `storage.move`.
Before any write, the destination container must establish caller (`webId`) manager/Control
access, even when the source has no own grants. An advertised WAC-Allow denial refuses too.
Every planned own-access replacement runs the roles lockout check; the moved root and all
moved descendants must retain caller management. `acceptReset` never bypasses these checks.

The snapshot includes each item's resource ETag, advertised own ACL/ACR URL, document ETag
and document presence/absence. All validators must be strong. Own grants must round-trip
through roles without losing modes or folder/member scope. Separate comments-container
moves are refused. Source validators are re-read before each access application and across
the entire source tree immediately before deletion. A changed resource, changed access
document, or an own ACL/ACR appearing/disappearing aborts with `StorageError('conflict')`.

Staging proceeds root first, parents before children:

1. Create an exact-name empty placeholder with `storage.create` (Solid `If-None-Match: *`).
   Resource placeholders retain the source Content-Type; containers use `kind: 'container'`.
2. When the source has an own ACL/ACR, apply its own selection with `setGrants({ ownOnly: true })`
   and read it back. Verify document presence and equality of the own role rows. No content
   is written, and no child is created, until the parent's access has been verified.
3. Stream one source resource at a time through `storage.read` and conditional `storage.write`,
   using the placeholder's ETag. Recheck destination access and caller management after staging.
4. Recheck every source validator, then delete source items bottom-up with `If-Match`.
   Resources use their snapshot ETags. Child deletion changes container ETags, so containers
   require a fresh verified-empty, server-managed RDF representation and its strong ETag.

The traversal cap is 2,000 entries including the root and auxiliaries. As in storage-client,
non-server-managed container RDF is refused; advertised access/metadata documents and
`.acl`/`.acr` descendants are excluded from copying, and describedby metadata is dropped.
Source access auxiliaries are deleted after their protected data; placements that cannot
satisfy that order are refused. The backend's container allow-list is private, so pod-access
mirrors it using public `listAll`/`readRdf` calls with their existing response bounds. Resource bytes stream without
whole-tree buffering. Unlike the backend's private exact-URL helper, public `create` takes
decoded names: names whose encoding cannot be reproduced exactly are refused before writes.

Inherited grants follow the destination ancestors; they are neither copied nor reported as
dropped, and can change. Unsupported own grants refuse before writes. With `acceptReset: true`,
expressible own grants are staged and unexpressible grants appear in
`dropped: [{ url, grant, reason }]`, naming original URLs. `preserved` is false exactly when
`dropped` is nonempty. Unreadable or unrepresentable source policies always refuse.
`reapplied` lists destination URLs whose own ACL/ACR selection was installed and verified;
items without own access documents retain inheritance and are omitted. Empty own ACP
selections still create and verify an own document; empty WAC selections refuse caller lockout.

A `MovePreservingAccessError` is a non-retryable `StorageError('conflict')`, with `from` and
`to` naming both roots and the original failure in `cause`:

- `step: 'reapply'`: staging, verification or cancellation failed before deletion. Sources
  are untouched; destination copies were conditionally removed bottom-up. `url` is `from`.
- `step: 'rollback-failed'`: best-effort cleanup failed; `url` is `to`. An `AggregateError`
  retains the staging and cleanup causes. Content-bearing residuals already have verified
  own access, or inheritance when the source had no own document. An access-installation
  failure can leave only an empty placeholder for that item.
- `step: 'source-delete'`: deletion has started and failed or was cancelled. The destination
  with verified access is retained in full; some source items may remain. `url` is `to`.
  No data is recreated, no move-back is attempted, and no destination cleanup runs.

Cleanup ignores the caller's spent abort signal and never deletes a resource without its
last acknowledged strong write validator, or a container without verifying it is empty.
These operations are not transactional: concurrent ancestor changes and races between the
last access check and deletion cannot be made atomic through the public APIs. No retries
are automatic. Native moves retain the existing storage backend path unchanged.

### Solid access requests

```ts
import { listRequests, decide, accessModel } from "@jeswr/pod-access/requests-solid";

const options = { fetch: authenticatedFetch, webId, storage };
const requests = await listRequests(options);
const request = requests.find((entry) => entry.status === "pending");
if (request) {
  const result = await decide(request, {
    approve: true,
    role: "viewer",
    dataTypes: request.dataTypes,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
  }, options);
  // result.status, grantUrl, receiptUrl, notified, expiryEnforced
}
// Deny: await decide(request, { approve: false }, options).
// Detect: await accessModel({ fetch: authenticatedFetch, storage, target? }).
```

`listRequests({ fetch, webId, storage, inbox?, profile?, publicFetch?, signal? })` discovers
`ldp:inbox` unless supplied. A WebID profile inside `storage` is read with `fetch`; one hosted
elsewhere is read only through `publicFetch` (never the session), and is skipped without it. It visits at most 100 inbox members and reads at most 256 KiB per RDF document,
including streamed responses. Results can be incomplete at these caps. A malformed, oversized,
missing, or non-request member becomes `{ id, status: "unreadable" }`; containers and ACLs are skipped.
Other statuses are `pending`, `approving`, `approved`, and `denied`. Entries carry `requester`,
notification-local `requesterName?`, `purpose?` (IRI or label), `dataTypes`, `modes`
(`read`, `write`, `append`), `modesByType` (a rule targeting a data type applies to that type
only; a rule with any other target applies to every requested type), `requestedDuration?`, `expiresAt?`, `created?`, and `decidedAt?`.
Foreign dates and durations retain lexical strings. Listing never dereferences requesters or purposes.
Discovery/listing failures and cancellation propagate; an individual bad notification does not.

`decide(entry, { approve, role?, expiresAt?, dataTypes? }, options)` re-reads `entry.id`.
`dataTypes` must be a nonempty requested subset, and each approved type grants only its own
`modesByType` entry on its own targets, granted as a sharing role: a target whose requested
modes include Write is granted Editor (Read, Write, Append), otherwise Viewer (Read); an
append-only request is refused before any write. `role: "viewer"` narrows to requested Read, and no
approval ever grants Control. The owner Type Index resolves classes
to registered instances and bounded, recursively listed instance-container members. Unknown classes
and off-storage targets fail before the Approving CAS, and so do targets an approval may never
share: the storage root itself (with or without its trailing slash), anything under
`<storage>settings/` (Type Indexes, preferences, the access records), and access-control or
metadata documents (`.acl`, `.acr`, `.meta`). Targets are compared by their
decoded path, case-insensitively, never as raw strings, so dot segments, case or encoding cannot
hide a refused path. A target with a query, a fragment, an empty path segment (`//`), or a
percent-encoding a server may decode into another name (an unreserved character, `%`, `/`, `\`, a
control character, or invalid UTF-8), or a segment ending in a dot or space or containing `::`
(names Windows backends alias to another file), is refused outright; ordinary encoded names such as
`John%20Smith.ttl` or `caf%C3%A9.ttl` stay shareable. A requested type that grants no mode (it has no permission of its own, or
`role: "viewer"` drops its only mode) is left out of the approval rather than blocking it. `options.typeIndex` accepts an owner-controlled
dataset or in-storage index URL; otherwise discovery reads profile public/private links and
`pim:preferencesFile` → private index. All authenticated discovered URLs stay in `storage`, with
redirects refused. Options also accept `publicFetch?`, `now?: () => Date`, and `signal?`.

Approval resolves once, then CASes Pending → Approving with a pinned snapshot and deterministic
SHA-256 grant ID. The grant ID is derived from the owner's decision record (below), whose address
names the requester, so identical requests from different requesters never share a grant or receipt
ID; a denial receipt is named the same way. It creates the ODRL grant and DPV receipt under `settings/access-records/` using
`If-None-Match: *`, grants each role with `addGrant` from `./roles`, then CASes to Approved. The
role layer is additive (it never downgrades an existing role), writes conditionally, materialises a
missing own ACL keeping the owner's Control, and refuses a legacy `acl:defaultForNew` ancestor on
CSS. Each grant is planned (without writing) before anything is recorded, so a refusal the role
layer can foresee (`owner-lockout`, `unsupported`, an unknown ACL construct) stops the decision while
the request is still pending. A refusal that only appears later (for example a `conflict` from a
concurrent edit) is rethrown unchanged and never retried; the approval stays Approving and can be
retried, and a lost race against another approver that finished reports the approval. Initial CAS races throw `RequestConflictError` with
the re-read winner's status. Explicitly retrying resumes the pinned decision without resolving
again or rolling back ACLs. A retry may repeat the same choices or leave them out, but if it passes
different `dataTypes`, `role` or `expiresAt` it fails with an error saying an earlier approval is
still finishing, rather than silently granting something other than what the owner just chose. Completed decisions are idempotent; reversing
approval/denial is rejected. Denial receipt writes can also be retried. Requester-supplied grant/receipt
references never select write locations.

**WAC does not enforce expiry.** An explicit decision `expiresAt` is receipt metadata, persisted in
the recovery snapshot. It does not expire or automatically revoke WAC access; results always report
`expiryEnforced: false`. Requested expiry is displayed but never silently adopted. Purpose is DPV
metadata too; this client does not enforce purposes or authenticate the claimed requester identity.

After committing, requester inbox discovery and ActivityStreams `Accept`/`Reject` delivery are best
effort and happen only when the caller passes an unauthenticated `publicFetch` (forced to
`credentials: "omit"` and `redirect: "error"`); global fetch is never used, since an application
may have patched it with authentication. Requester profile and inbox URLs must be public HTTPS:
loopback, private, link-local and local-name hosts are refused. That check reads only the URL: a
public name can still resolve to a private address. On a server (Node), pass a DNS-checking fetch
such as `createGuardedFetch()` from `@jeswr/guarded-fetch` as `publicFetch`; in a browser, where
names cannot be resolved, the URL check is the only guard. Failures and a missing `publicFetch`
return `notified: false` without rollback.

Grant records, consent receipts and each approval's pinned decision live in
`<storage>settings/access-records/`. Before writing there, `decide` creates the folder with an
owner-only ACL, or checks that its existing ACL names only the owner and gives them Read, Write
and Control over the folder and its contents; a shared folder stops the decision. A folder that
exists without its own ACL is made private only while it lists as empty, because anything already in
it may have been written by someone else: its new ACL is marked unverified, and the mark is removed
(with a conditional write) only once the folder still lists as empty. A crash or a failed check
leaves the mark, so later calls check again and keep refusing while anything is inside; a folder
that cannot be listed is refused. (A server that lists the folder's own ACL as a member is fine.)

When the mark is removed, `decide` also stores a random **records key** in the folder's ACL. Only
the owner can read that ACL, and the key is created only after the folder is known to be private,
so nobody else can predict where a decision record lives, and nothing written before the folder was
sealed (or slipped in while it was being sealed) can sit at one. A key found next to the unverified
mark is not trusted and is replaced. A private folder with no key (sealed before keys existed, or
whose key went missing) gets one only while it holds nothing but its ACL; if it holds other files,
`decide` refuses ("The access records folder has records this version can't read; move them out of
settings/access-records/ first") rather than silently orphaning them. Looking up a decision creates nothing on a pod that has no records folder ACL
yet.

Each decision is a **decision record** in that folder, named from the records key, the request URL,
its requester, what it asks for and a generation number. A record says `approving` (the decision is
pinned: targets, modes, expiry and the owner's own choices), `approved` or `denied`. Approval first
pins its decision in a create-only `approving` record, then moves the request to Approving, and
marks the record `approved` once the request is Approved. A retry resumes only from an `approving`
record (even when the crash came before the request changed state, so the Type Index is not read
again): a notification that claims to be Approving or Approved without one was written by the
requester, so `decide` refuses to approve it (it can still be denied). Denying a request whose
approval was pinned but never reached Approving turns that record into `denied`, so it can never be
resumed. A finished record only matches a request in the same state, so when a new request arrives
at a reused notification URL, even an identical one, it is decided afresh under the next generation
and never reuses the old decision. A pinned decision must name this requester, stay within the role
its request maps to, and pass the same target checks as a new one. After 32 decisions at one
request URL, `decide` refuses that URL.

One limit follows from the request status being requester-authored. If a new notification at a
reused URL, asking for the same thing as an earlier approved one, itself claims `approved`, it
matches the earlier `approved` record: `decide` returns that earlier grant and grants nothing new.
The owner also cannot record a denial for that notification, since denying a finished approval is
refused; remove the notification (and revoke the earlier grant if it should end) instead.

Every document the pipeline writes back (including the requester-authored request during CAS) is
serialised with regenerated blank-node labels, validated language tags and no named graphs, so a
foreign JSON-LD label or tag cannot inject Turtle.

`accessModel({ fetch, storage, target?, signal? })` returns `wac`, `acp`, or `unknown`. An ACP
`accessControl` link means `acp`. ACP servers such as ESS also advertise their access control
resources with `rel="acl"` (ESS as `?ext=acr`), so an `acl` link alone is not taken as WAC: the
advertised document is read with the roles layer's detection (its RDF vocabulary and ACP type
links, walking to the nearest existing ancestor) to tell the two apart. Only an existing, non-empty
access document decides: a missing or empty one never counts as WAC. No access link, no deciding
document, or documents that mix models (both vocabularies, or ancestors of different models) are
`unknown`; any other discovery failure propagates. Decisions throw typed
`UnsupportedAccessModelError` for ACP or unknown models before writing anything, and the model is
enforced again where writes happen: the records folder's ACL is used only once its document is
shown to be WAC (a folder that advertises no ACL is refused rather than guessed at), and grants go
through `./roles` pinned to WAC, which refuses an ACP target before writing. ACP materialisation
remains follow-up work.

Inbox children and `settings/access-records/` must be owner-write-only; public Append to the inbox
is fine. A deterministic hash is an idempotency key, not an authenticity proof for requester-writable
snapshots. Resume only as an explicit user-confirmed decision, never an automatic inbox sweep.

The subpath exports frozen `ACCM`, `DPV`, `ODRL`, `ACL`, `LDP` and supporting vocabulary constants,
`MAX_MEMBERS`, `MAX_NOTIFICATION_BYTES`, `deriveGrantId`, public option/result types, and canonical/legacy
accm helpers. RDF uses `@jeswr/fetch-rdf`, typed accessors/RDF factories, and `n3.Writer`.
Access Manager imports shared vocabulary and
canonicalisation; its UI-specific request/approval interfaces remain deprecated compatibility code.
