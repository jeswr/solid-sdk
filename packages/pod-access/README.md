<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

> **Experimental — AI-agent-generated.** Security-critical WAC/ACP translation extracted from Pod Migrator.

Offline access-control readers, writers, a neutral policy model, conservative translation,
inheritance composition, and bounded symbolic access proofs. Pod Migrator consumes this package;
migration HTTP, group fetching, planning, decisions, and execution remain in the app.
The `./roles` subpath adds injected-fetch Solid sharing with conditional persistence, and
`./requests-solid` provides the Solid request inbox and decision pipeline on top of it.

Private at version 0.1.0. Requires Node.js >=24 and the root pnpm workspace tooling.
The role layer implements the Solid sharing portion of SDK core ADR-003 §9; the broader
AccessClient and LWS grants remain separate work.

Readers can return resource, member, and combined rules. `translatePolicy` and `assertNotWider`
require every grant and denial to be normalized to resource scope; they throw otherwise.
Use `scopePolicy` to select and normalize each scope, then translate and prove the two separately.
`policiesEqual` likewise requires normalized policies and returns false for invalid scopes.

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

<!-- AUTHORED-BY Codex -->
<!-- AUTHORED-BY Codex GPT-6 -->

`@jeswr/pod-access/roles` exports `rolesToModes`, `modesToRole`, `grantsWithRoles`,
`readGrants`, `setGrants`, `addGrant`, `removeGrant`, `isRoleError`, and their documented types
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
`implementation` (`css` by default, or `ess`) to both mapping helpers.

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
container defaults, unrelated targets and annotations. Inherited rows are read-only and
must match their governing source. They never overwrite an explicit selection for the same
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
and off-storage targets fail before the Approving CAS. `options.typeIndex` accepts an owner-controlled
dataset or in-storage index URL; otherwise discovery reads profile public/private links and
`pim:preferencesFile` → private index. All authenticated discovered URLs stay in `storage`, with
redirects refused. Options also accept `publicFetch?`, `now?: () => Date`, and `signal?`.

Approval resolves once, then CASes Pending → Approving with a pinned snapshot and deterministic
SHA-256 grant ID. It creates the ODRL grant and DPV receipt under `settings/access-records/` using
`If-None-Match: *`, grants each role with `addGrant` from `./roles`, then CASes to Approved. The
role layer is additive (it never downgrades an existing role), writes conditionally, materialises a
missing own ACL keeping the owner's Control, and refuses a legacy `acl:defaultForNew` ancestor on
CSS. Its refusals (`isRoleError`, for example `owner-lockout`, `conflict` or `unsupported`) are
rethrown unchanged and never retried; the approval stays Approving and can be retried once the cause
is fixed. Initial CAS races throw `RequestConflictError` with
the re-read winner's status. Explicitly retrying resumes the pinned decision, ignoring new
overrides, without resolving again or rolling back ACLs. Completed decisions are idempotent; reversing
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
exists without its own ACL is made private only while it is empty, because anything already in it
may have been written by someone else. Approval first pins its decision (targets, modes, expiry) in a
create-only record in that folder, then moves the request to Approving. A retry resumes only from
that record (even when the crash came before the request changed state, so the Type Index is not
read again): a notification that claims to be Approving or Approved without one was written by the
requester, so `decide` refuses to approve it (it can still be denied).

Every document the pipeline writes back (including the requester-authored request during CAS) is
serialised with regenerated blank-node labels, validated language tags and no named graphs, so a
foreign JSON-LD label or tag cannot inject Turtle.

`accessModel({ fetch, storage, target?, signal? })` returns `wac`, `acp`, or `unknown` from Link
relations; ACP wins if both are advertised. Decisions throw typed `UnsupportedAccessModelError` for
ACP or unknown models; ACP materialisation remains follow-up work. HTTP discovery errors propagate.

Inbox children and `settings/access-records/` must be owner-write-only; public Append to the inbox
is fine. A deterministic hash is an idempotency key, not an authenticity proof for requester-writable
snapshots. Resume only as an explicit user-confirmed decision, never an automatic inbox sweep.

The subpath exports frozen `ACCM`, `DPV`, `ODRL`, `ACL`, `LDP` and supporting vocabulary constants,
`MAX_MEMBERS`, `MAX_NOTIFICATION_BYTES`, `deriveGrantId`, public option/result types, and canonical/legacy
accm helpers. RDF uses `@jeswr/fetch-rdf`, typed accessors/RDF factories, and `n3.Writer`.
Access Manager imports shared vocabulary and
canonicalisation; its UI-specific request/approval interfaces remain deprecated compatibility code.
