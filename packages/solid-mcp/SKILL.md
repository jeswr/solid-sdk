---
name: solid-mcp
description: Use when implementing Solid MCP tools, portable pod data access, or stdio server integration.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

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

The server and fetch adapter default to read-only independently. Scope-check tool
and resource URLs even with injected PodPorts. The fetch adapter permits only the
operator-configured WebID outside the pod, for best-effort Type Index discovery;
never let client-selected tool URLs use this exception. Refuse off-pod profile redirects
and drop discovered off-pod URLs.
Guard read redirects; refuse mutation redirects, root mutations and root aliases.
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
succeeds and is verified. Audit uses the current PodPort, owner-only ACLs,
strong conditional ETags and bounded retries. A read-only server must withhold
results that require auditing. Keep shared internal helpers stripped from
declarations so private pkg-memory types remain bundled.
