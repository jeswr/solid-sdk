<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-access

> **Experimental — AI-agent-generated.** Private at version 0.1.0 pending conformance (ADR-001 D5).

Solid sharing through the public `@jeswr/storage-client` API, implementing SDK core ADR-003 §9
(T-050). Requires Node.js >=24. The storage client owns authentication, scope checks, RDF
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
`grants`, `share` and `revoke` support Solid WAC and ACP. LWS grant/request operations belong
to T-051; `./testing` remains reserved.

## Discovery and conditional edits

The client discovers the associated access document from HEAD: `rel="acl"` for WAC or
`rel="http://www.w3.org/ns/solid/acp#accessControl"` for ACP. It requires exactly one scoped
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

## Grants

Each `share` creates a new independent authorization or policy and returns its IRI in `id`.
A supplied `grant.id` never updates an existing grant. Agents may be a WebID string,
`{ public: true }`, `{ authenticated: true }`, or (WAC only) `{ group: groupIri }`.
Supported modes are `read`, `write`, `append` and `control`; purpose and expiry constraints
return `unsupported`. Mode lists round-trip explicitly without adding implied modes.

WAC uses `AclResource`/`Authorization` from `@solid/object`. With `inherit: true` on a
container it writes both `acl:accessTo` and `acl:default`. ACP uses one AccessControl, Policy
and Matcher per grant, with `acp:allow` ACL modes and `acp:allOf` matching a single agent.
Inheritance links the control through both `acp:accessControl` and `acp:memberAccessControl`.
Inherited entries here mean defaults on this document; ancestor grants are not resolved.

`revoke` accepts an authorization/policy IRI or an agent/group IRI. A matching rule id takes
precedence over the same IRI used as an agent. WAC retains co-agents and
unrelated resource targets; agent revocation on a rule shared with other targets is
`unsupported`. ACP unlinks this resource's control, retaining definitions that other resources
may reference. Revoking one policy of a multi-policy control is `unsupported`. No matching
grant means no write. Public/authenticated grants can be revoked by their returned ids.
Anonymous rules have no stable id and can be revoked by agent.

Listing never flattens unsupported conditions into unconditional grants: WAC origins/unknown
conditions and ACP deny/anyOf/noneOf/multiple matchers or conditional matchers return
`unsupported`. Malformed typed RDF returns `invalid-response`.

`effective(url)` reads only `storage.head(url).allow`. It returns `null` when unavailable,
otherwise `{ me, public: [] }`. The storage interface exposes only caller modes, so an empty
public list means **unknown**, and is not evidence that anonymous access is denied. It does
not infer public access from the caller's permissions or from access-document contents.

## Validation

From the workspace root, run `pnpm run gate`. Package tests use real memory storage, independent
RDF fixtures and byte snapshots. Coverage thresholds remain 100% for this security-critical
package. Direct scripts: `pnpm --filter @jeswr/pod-access run lint` (also `build`, `typecheck`, `test`).
