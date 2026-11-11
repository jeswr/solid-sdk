---
name: solid-mcp
description: Use when implementing Solid MCP tools, portable pod data access, or stdio server integration.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Solid MCP

Read README.md and the W9 `specs/mcp/DESIGN.md` in the planning repository.
All server/tool data access uses PodPort. createStoragePodPort discovers Solid or LWS
through storage-client; createFetchPodPort retains the guarded legacy implementation.
Storage discovery may use an explicitly injected anonymous same-origin transport outside
the pod root; never send pod credentials there. Propagate discovery failures. LWS exact
create-only writes are unsupported because Slug is only a hint; refuse before mutation. Do not create sdk-core
packages in this package. The legacy fetch configuration remains supported.

Register tools through createPodToolRegistry/registerPodTools. Each entry owns its
name, Zod schema (the SDK emits JSON Schema), handler and readOnly flag. Keep the
solid_* aliases for v0.2, with the same schema, result and write enforcement as their
pod_list/pod_read/pod_write/search names. No new tools belong to MCP-01.
Shared-context tools (decisions/0004) live in context-tools.ts and register beside the pod
tools. context_read takes no arguments. Discover SharedContext only through the configured
owner WebID's PRIVATE Type Index (including preferences-file links), using pod-type-index
through the current PodPort. Only an absent pointer/registration permits the conventional
SHARED_CONTEXT_PATH fallback. Require one HTTP(S), pod-scoped instance without a fragment
or container identity. Duplicate registrations, unsafe instances and unreadable or
malformed linked documents return `{status:"error",reason}` without registration URLs.
Classify registrations with suite-vocab's `canonicalize`, as pod-type-index does; legacy
SharedContext aliases count toward ambiguity and receive every canonical validation.
Public indexes never select context. Reject redirects and aliases for every discovery/ACL/
context read without requesting their targets. Redact with pkg-memory's shared Unicode
card detector; retain original UTF-16 spans and the exported CARD_REDACTION marker.
Before returning text reject public Write/Append/Control in WAC-Allow and verify the
advertised effective WAC ACL using pkg-memory's validators. Follow absent own ACLs to
ancestor default/defaultForNew rules. Other agents, public/authenticated classes, groups,
origin rules, malformed ACLs and unreadable evidence yield `{status:"untrusted",url,reason}`
with no text. `aclVerified:true` means owner-only mutation authority was proven. A port
with neither private pointers nor an exposed ACL capability may return conventional-path text
with `aclVerified:false`; header evidence
of public mutation still denies. Missing owner identity cannot verify an advertised ACL.
Private index/preferences pointers require `verifyContextAcl` to return true, including
inherited default/defaultForNew evidence. Untrusted or unavailable pointer ACL evidence
returns `{status:"error",reason:"pointer_acl_untrusted"}` with no context text. Keep the
public-profile exception. Reuse storage-capabilities' `parseWacAllow` for header checks.
`setupSharedContext(pod,{webId,initialText?})` and `solid-mcp context-init
[--initial-text TEXT]` are owner-facing setup only, never MCP tools. Create private ACLs
before content, use only advertised WAC URLs, preserve dedicated ACLs with strong ETags,
and write the document with If-None-Match:*. Never replace an existing document or a
different registration. Register through pod-type-index, provisioning private bootstrap
destinations before mutation; index bootstrap requires observed root Write+Control.
Preserve public profile pointers and unrelated RDF. A successful rerun performs no writes.
Never modify ACLs of existing private indexes/preferences; verify them during discovery
and again before conditional updates. Refuse unsafe evidence with `pointer_acl_untrusted`
and tell the owner to fix the effective pointer ACLs. Provision ACLs only for new resources.
The explicit CLI subcommand enables setup writes; ordinary stdio retains its read-only default.

The server and fetch adapter default to read-only independently. Scope-check tool
and resource URLs even with injected PodPorts. The fetch adapter permits only the
operator-configured WebID outside the pod, for best-effort Type Index discovery;
never let client-selected tool URLs use this exception. Refuse off-pod profile redirects
and drop discovered off-pod URLs.
Guard read redirects; refuse mutation redirects, root mutations and root aliases.
Generic PodOutput access must refuse the personal-data prefix derived from
NanopubStore's layout (`private/pkg/`, including policy, locks, audit and local
ACLs). Audit must derive its container from the same layout. Deny generic reads,
writes and deletes with `Personal data requires a purpose-limited tool`; never
echo rejected URLs. Refuse ancestor mutations too. Filter protected listing/search
candidates, Type Index hints, container projections and MCP resource enumeration.
Check redirects and final aliases, slashless containers, case variants, repeated
percent encoding and normalized dot segments at the shared output/operation
boundary. Only memoryContext and audit may opt into internal personal access;
all personal disclosure retains purpose checks and verified sensitive-read audits.
Apply the same generic boundary to the configured WebID's profile document when
it lies inside the pod: refuse reads/writes/deletes with the fixed personal-data
diagnostic and omit it from listings, search and resource enumeration. Preserve
internal storage-root, Type Index and issuer discovery, and Contact-authorized
`profile_get`. Off-pod WebIDs add no in-pod profile restriction. Type Index profile
discovery may bypass only the profile restriction; it must still exclude memory.
Preserve ETags and conditional mutation headers. Use PodReadOptions.accept for RDF/profile
reads; generic byte reads must retain the backend default representation.

Use fetch-rdf and typed wrappers for RDF reads, rdf-serialize for serialization.
Tests use fake fetch and portable pods only. Run lint, build, typecheck and test;
exercise canonical tools and aliases, read-only enforcement and SSRF regressions.
The stdio CLI must keep stdout exclusively for MCP messages.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Memory tools use `NanopubStore` through the current PodPort and PodOutput. Trusted
`clientInfo.clientId` is an absolute IRI; tool input must never select deletion
authority. Model and optional conversation metadata belong in publication info;
assertion attribution is always the owner. Quoted unhedged facts are explicit,
hedged facts are hedged, other facts inferred; embedded solid-memory notes are
always Mentioned and uncategorized. Never infer a permissive category from prose.
Recall requires a closed purpose and defaults to definitely plus Current. Reuse
`purposeFilter` per call and preserve edited policies. Recall must never create a
missing policy, including on a writable server. Retraction is append-only; deletion
requires this client's pubinfo attribution and a strong conditional ETag. Private pkg-memory is bundled
without leaking its imports into public declarations or mirror manifests.

Personal reads (`profile_get`, `address_get`, `health_query`) require the same
trusted client identity, closed purpose and existing policy. Profile reads are
confined to the configured in-pod WebID and project only Contact fields. Address
and health reads use definitely-true Current owner assertions; address `at` is
an additional inclusive validFrom/validThrough filter, retaining calendar
granularity and exact datetime microseconds. Reject ambiguous temporal bounds.
Check all candidate categories before content filters. Never disclose special
data, including through recall, unless its monthly private PROV audit append
succeeds and is verified. Audit uses the current PodPort and its optional HEAD
metadata to discover a unique server-advertised WAC `rel="acl"` URL for each
protected target, including on 404. Require a pod-scoped ACL URL and write the
owner-only WAC authorization there; never guess a `.acl` URL. Additionally require
the ACL itself to lie inside the protected memory area derived from NanopubStore's
layout, using the same prefixes as the generic guard. Refuse other in-pod ACL
locations without fallback, using `Audit protection unavailable`. Missing or unsafe
WAC links, ACP-only storage and custom ports
without HEAD metadata fail closed with `Audit protection unavailable`, withholding
the sensitive read. Do not add ACP support. Preserve strong conditional ETags and
bounded retries. A read-only server must withhold results that require auditing.
Keep shared internal helpers stripped from declarations so private pkg-memory
types remain bundled.

Memory writes forward the current port's HEAD capability into `NanopubStore`.
Require unique server-advertised, pod-scoped WAC ACLs for every protected container,
policy, lock and nanopub, including on 404. Missing discovery and ACP fail closed
before private content with `Memory protection unavailable`; never guess `.acl`.
Pass the same protected-area ACL predicate via pkg-memory's `WacDiscoveryOptions`
to both memory and audit discovery, including newly protected ancestors. Reject
ACLs outside that area before reading or writing them, without falling back.
Both memory and audit reuse pkg-memory's `validateDedicatedWacAcl` checks before
replacing an existing ACL. All accessTo/default/defaultForNew scopes must name only
the target, with no unscoped, malformed or unknown rules; otherwise leave the ACL
untouched and return the fixed protection diagnostic. Read existing ACLs with strong
ETags and mutate with `If-Match` / `If-None-Match: *`. Test ports explicitly advertise
WAC metadata via `test/wac-memory-pod.ts`.


Generic mutations re-read private context discovery on each operation. They refuse the
registered context, its ancestors and advertised ACL, and private index/preferences
pointers and their advertised ACLs. Unprovable discovery with a configured owner blocks
generic mutations with the fixed personal-data diagnostic. Setup uses its separate
owner-facing capability; it is never registered as an MCP tool.
Governing ancestor ACL mutation protection for pointer/profile documents is deferred to
PR #447's advertised-link guard; do not add an ACL-suffix guard. Pointer trust checks
deny unsafe effective ACLs meanwhile. ChatWriter keeps `contextGuard` off for its scoped,
create-only agent/account identifiers. Read/ACL-check races remain a documented limitation.

`PodHeadResult.aclError` distinguishes malformed, ambiguous or unsupported ACL-link
evidence from absent ACL capability. Trust checks deny this evidence rather than
returning unverified text.
