---
name: pod-connectors
description: Use when maintaining source adapters, injected PodWriter/SourceAuth ports, connector configuration, registry, PKCE, file imports, or connector fixture tests.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Maintain Pod connectors

Read README.md and src/core/types.ts before changing the public contract. The package was
moved from apps/pod-manager/src/lib/integrations; retain registry/types exports and the
app's compatibility shims. Hosts create an isolated createRegistry(config); never read
process environment or install host-specific global configuration here.

Runners receive PodWriter and SourceAuth explicitly. Every adapter uses ctx.api for source
I/O and ctx.write for Pod I/O. Keep credentials on their own transport. Fetch-backed writes
are confined to the adapter container; Type Index links remain in the active Pod. Preserve
ETags and conditional PUT semantics. Use typed RDF wrappers and N3 Writer, never inline quads.

All tests use recorded fixtures and memory Pods. Use ./testing for consumers. Run lint,
build, typecheck and test, then the workspace gates before completing a change.

CON-01 only extracts the framework and ports. Incremental merge, provenance, recorder,
vocabulary remapping and Node CLI are owned by later connector tasks.
