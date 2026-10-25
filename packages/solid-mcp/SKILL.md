---
name: solid-mcp
description: Use when implementing Solid MCP tools, portable pod data access, or stdio server integration.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Solid MCP

Read README.md and the W9 `specs/mcp/DESIGN.md` in the planning repository.
All server/tool data access uses PodPort; createFetchPodPort retains the guarded
fetch implementation until MCP-15 supplies storage-client. Do not create sdk-core
packages in this package. The legacy fetch configuration remains supported.

Register tools through createPodToolRegistry/registerPodTools. Each entry owns its
name, Zod schema (the SDK emits JSON Schema), handler and readOnly flag. Keep the
solid_* aliases for v0.2, with the same schema, result and write enforcement as their
pod_list/pod_read/pod_write/search names. No new tools belong to MCP-01.

The server and fetch adapter default to read-only independently. Scope-check tool
and resource URLs even with injected PodPorts. The fetch adapter permits only the
operator-configured WebID outside the pod, for best-effort Type Index discovery;
never let client-selected tool URLs use this exception. Drop discovered off-pod URLs.
Guard read redirects; refuse mutation redirects, root mutations and root aliases.
Preserve ETags and conditional mutation headers.

Use fetch-rdf and typed wrappers for RDF reads, rdf-serialize for serialization.
Tests use fake fetch and portable pods only. Run lint, build, typecheck and test;
exercise canonical tools and aliases, read-only enforcement and SSRF regressions.
The stdio CLI must keep stdout exclusively for MCP messages.
