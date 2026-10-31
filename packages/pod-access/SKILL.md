---
name: pod-access
description: Work on @jeswr/pod-access, the pod sharing and permissions across access-control models package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-access

T-050 implements Solid WAC/ACP sharing via `createAccessClient({ storage })`. Design of record:
SDK core ADR-001 D4 and `ADR-003-storage-client.md` §9 in `solid-suite-planning/specs/sdk-core/`.
Read this repository's `AGENTS.md` and the package README before edits.

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
co-agents, co-selectors and other targets. ACP revoke unlinks local controls, preserving shared
definitions; multi-policy control revocation is unsupported. RevocationKey accepts grant ids,
agent/group IRIs, `{ public: true }` and `{ authenticated: true }`. Explicit selectors also
revoke blank-node rules, which have no stable grant id. Validate and snapshot selector keys
before storage operations; shared WAC targets still fail closed.
Purpose/expiry and ACP groups/reserved agent IRIs passed as WebIDs are unsupported.

`effective()` uses only HEAD's caller `allow` booleans, without adding implied modes. It returns
null when absent; `public: []` means unknown because StorageClient exposes no anonymous modes.
LWS access grants/requests and testing fakes are deferred to T-051.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and
adversarial tests with implementation changes. Tests use the public memory storage backend
with a HEAD link seam, independent RDF fixtures and byte snapshots; no live service is needed.
Keep development tool versions aligned with the root. Validate `lint`, dependency-first `build`,
`typecheck` and `test`, then the repository gate.
