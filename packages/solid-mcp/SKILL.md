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
tools. context_read is the only shared-context read path; it takes no arguments and reads
only the fixed SHARED_CONTEXT_PATH. Keep model input away from the URL, and keep writes
to owner-approved proposals. It reads below the server's configured root (a sub-container
server looks under that sub-container), refuses
redirects/aliases (PodReadOptions.redirect "error"; no second request), and redacts
Luhn-valid card numbers before returning text.

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
Also reserve `agent/context/`, `agent/memory/` (including `health/`) and
`agent/accounts/` for all generic access. Keep the protected agent prefixes in
`agent-layout.ts`, sharing the context container with `SHARED_CONTEXT_PATH`.
Ancestor listings remain available but omit protected members and their metadata.
Generic writes to an ACL, ACR or `.meta` resource of the root, of an ancestor of a
protected area or of the area itself are refused (they govern the area by inheritance).
Keep that convention guard and also discover associations before every otherwise-allowed
generic write/delete: HEAD the pod root, each protected area (including the in-pod
WebID profile document and the separately governed `agent/memory/health/`) and all their
ancestor containers through the current PodPort.
Dedupe those HEADs within each mutation; never cache associations across calls.
Refuse normalized aliases of every advertised `rel="acl"` and `rel="describedby"`
target with the same fixed personal-data diagnostic. Missing HEAD capability or auxiliary metadata, failed
HEADs (except 404), malformed/ambiguous Links and off-pod associations fail closed.
Use Link metadata on 404 too; missing associations fail closed even on 404.
Share the existing Link parser with WAC discovery; memory/audit still require a unique
WAC ACL. Generic reads do not perform auxiliary discovery.
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
Chat saves explicitly use channel `mcp` and scope source IDs with
`chatConversationId(id, account)` before saving. Validate optional account inputs
with `normalizeChatAccount`; use ChatWriter for label redaction and immutable
first-write PROV/FOAF/DCMI metadata. Reads/exports use stored IDs and expose account
and channel; escape account transcript headers like titles. Keep no-account ID
derivation unchanged. Shared CLI config accepts `account` / `SOLID_MCP_ACCOUNT`
for capture/import callers, independently of the tool's explicit account input.
Tests use fake fetch and portable pods only. Run lint, build, typecheck and test;
exercise canonical tools and aliases, read-only enforcement and SSRF regressions.
The stdio CLI must keep stdout exclusively for MCP messages.

The HTTP transport exports `TemporarilyUnavailable` from `@jeswr/solid-mcp/http`.
Throw it from `authenticate` when a required dependency cannot be checked: return 503,
a fixed JSON-RPC error and `Retry-After: 5`, with no `WWW-Authenticate`, retaining allowed-origin
CORS. Other authentication throws remain 401 challenges. Never disclose callback diagnostics
or create a server after either failure.

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

## Packaging (prepared, not published)

Keep `packaging/server.json` as the sole registry source. Read `packaging/README.md`
before changing descriptors or builder/validator scripts. Use the vendored registry
2025-12-11 and MCPB v0.3 schemas offline. `packaging:check` derives environment names
from `cli-config.ts`, checks the real loader and compares both tool inventories to
an actual in-memory MCP `tools/list`, including aliases and read-only hints.
Run it after a fresh build. The package tests exercise it after the gate builds.
Keep package.json's `mcpName` equal to server.json's `name`; preserve it in mirrors.

The MCPB UI deliberately requires an issuer-based credential group; omit optional
empty env strings, keep secrets sensitive and read-only true. `packaging:build`
rebuilds the package, fully bundles the CLI's remaining runtime dependencies, refuses
non-builtin external imports, generates deterministic `THIRD_PARTY_NOTICES.txt`
from input packages' names, versions, license metadata and LICENSE files (fail
closed when missing), and writes a deterministic ZIP under ignored
`packaging/out/`. Smoke-test that archive outside the workspace without node_modules.
Never ship packaging through `files`. Keep two plugins: remote-only `solid-pod`
with capture hooks, and stdio-only `solid-pod-local`, forwarding only pod root
and read-only with `${SOLID_MCP_READONLY:-true}`. Other local settings use the
regular 0600 CLI config file. Plugin MCP/hook JSON must not carry `$comment`.
Hooks use the capture README's stdin interface, `solid-capture claude` on PATH,
and a 30-second timeout. Capture is private and not on npm; the documented npx
alternative needs future publication. Startup killed before queueing leaves no
snapshot. Verify Node >=24 against Desktop's bundled runtime before submission.
The ChatGPT JSON is our own planning descriptor, not an OpenAI schema.
These are local preparation artifacts;
do not publish, submit, upload, deploy or enable anything as part of this work.
