<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-access

> **Experimental — AI-agent-generated.** Private at version 0.1.0 pending conformance (ADR-001 D5).

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

`requests()` returns `AccessRequest` values (`Grant` plus `target` and optional `inbox`). The
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

## Validation

From the workspace root, run `pnpm run gate`. Package tests use real memory storage, independent
RDF fixtures and byte snapshots. Coverage thresholds remain 100% for this security-critical
package. Direct scripts: `pnpm --filter @jeswr/pod-access run lint` (also `build`, `typecheck`, `test`).
