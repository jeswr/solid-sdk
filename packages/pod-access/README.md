<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

> **Experimental — AI-agent-generated.** Security-critical WAC/ACP translation extracted from Pod Migrator.

Pure, offline access-control readers, writers, a neutral policy model, conservative translation,
inheritance composition, and bounded symbolic access proofs. Pod Migrator consumes this package;
Migration HTTP, group fetching, planning, decisions, conditional writes, and execution remain in the app.
The separate `./requests-solid` entry provides the Solid request inbox and WAC decision pipeline.

Private at version 0.1.0. Requires Node.js >=24 and the root pnpm workspace tooling.
The broader sharing client in SDK core `ADR-003-storage-client.md` §9 remains unimplemented.

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
`modesByType` entry on its own targets. `viewer` narrows to requested Read; `editor` and
an omitted role retain only requested modes, never Control. The owner Type Index resolves classes
to registered instances and bounded, recursively listed instance-container members. Unknown classes
and off-storage targets fail before the Approving CAS. `options.typeIndex` accepts an owner-controlled
dataset or in-storage index URL; otherwise discovery reads profile public/private links and
`pim:preferencesFile` → private index. All authenticated discovered URLs stay in `storage`, with
redirects refused. Options also accept `publicFetch?`, `now?: () => Date`, and `signal?`.

Approval resolves once, then CASes Pending → Approving with a pinned snapshot and deterministic
SHA-256 grant ID. It creates the ODRL grant and DPV receipt under `settings/access-records/` using
`If-None-Match: *`, grants WAC access, then CASes to Approved. Existing ACL updates require a strong
ETag and `If-Match`; missing own ACLs are materialised create-only from the nearest ancestor while
preserving existing access and owner Control. Initial CAS races throw `RequestConflictError` with
the re-read winner's status. Explicitly retrying Approving resumes the stored snapshot, ignoring new
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
loopback, private, link-local and local-name hosts are refused. Failures and a missing
`publicFetch` return `notified: false` without rollback.

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
SDK-APP-04 can replace the internal `applyGrant` seam. Access Manager imports shared vocabulary and
canonicalisation; its UI-specific request/approval interfaces remain deprecated compatibility code.
