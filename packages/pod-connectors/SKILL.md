---
name: pod-connectors
description: Use when maintaining source adapters, injected PodWriter/SourceAuth ports, connector configuration, registry, PKCE, file imports, or connector fixture tests.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Maintain Pod connectors

Read README.md and src/core/types.ts before changing the public contract. The package was
moved from apps/pod-manager/src/lib/integrations; retain registry/types exports and the
app's compatibility shims. Hosts create an isolated createRegistry(config); never read
process environment or install host-specific global configuration here.

Runners receive PodWriter and SourceAuth explicitly. Every adapter uses ctx.api for source
I/O and ctx.write for Pod I/O. Keep credentials on their own transport. Fetch-backed writes
are confined to the adapter container; Type Index documents must be within a `pim:storage`
or `solid:storage` root advertised by the user's WebID, independently of the import destination.
Preserve ETags and conditional PUT semantics. Runners allow one run per connector container
at a time (an overlapping run in the same process is refused); hosts sharing a pod across
processes must serialise runs of the same connector. Use typed RDF wrappers and N3 Writer, never inline quads.
Hosts pass the canonical `profileDocumentUrl` from their existing profile load into
createFetchPodWriter. Pin profile reads and updates to that document while keeping the WebID
as the RDF subject. Do not resolve redirects or fetch an unauthenticated profile during
registration; authenticated profile and Type Index operations refuse redirects.

All tests use recorded fixtures and memory Pods. Use ./testing for consumers. Run lint,
build, typecheck and test, then the workspace gates before completing a change.

CON-02 adds the shared incremental write pipeline, host-owned ConnectorState, PROV activity
recording and per-adapter vocab-map.ts hooks. Preserve ETags on automatic merges and never
advance checkpoints on failure. The fixture recorder exposes only allowlisted non-personal JSON
fields under configured public route prefixes; it never saves headers or dynamic URLs. Detailed
adapter mappings and Node CLI remain owned by their follow-on connector tasks.

CON-14 adds the optional `PodWriter.writeBinary`/`remove` ports and `ctx.writeBinary`/`ctx.remove`
for non-RDF resources and source deletions. Keep binaries inside the connector container, never send RDF through it, default
to create-only, and replace only under a strong ETag.

Mail sources (Gmail, Takeout mbox) go through `src/mail/writer.ts` so the pod-mail layout and
vocabulary (`http://schema.org/`, matching apps/suite's mail model) stay identical. Keep Message-ID
document ids, write `.eml` create-only, and flush thread/folder membership once per run.
