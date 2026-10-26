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
Preserve ETags and conditional PUT semantics. Use typed RDF wrappers and N3 Writer, never inline quads.
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

CON-06 adds `googleDriveAdapter` and `createGoogleDriveAdapter({ maxBytes })` (25 MiB default),
using the shared Drive OAuth configuration. Keep it Tier B. Files live at
`drive/files/<pathId(id)>/meta.ttl`; tree membership uses `schema:isPartOf` links to parent
metadata subjects. Files are `schema:DigitalDocument`, folders only `schema:Collection`;
register DigitalDocument for `drive/` through `registrationContainer`. Typed Drive accessors
keep checksum/copy-state glue in `https://jeswr.org/ns/pod-drive#`.

Capture the start token before full listing, stage every changes page before applying it,
and only fall back once on changes-feed HTTP 404/410. Reconcile absent files after a valid
full listing; malformed envelopes, missing arrays, or invalid pagination tokens must fail
before pruning or checkpoint advancement. Use one shared RunBudget for every source request
and page's item count, passing it to `readJson` for every JSON response so cumulative response
bytes are bounded too. Retain the budget across an expired-cursor fallback. Owned binaries require
a known size under the cap; supported Google Workspace exports have capped PDF/text responses. Read with a byte
cap and cancel oversized responses. Stage create-only `content-<v>[.pdf|.txt]` representations,
where `<v>` is 24 SHA-256 hex characters of checksum, else modified time, else downloaded bytes
(the first representation for exports). Without source version fields, download on every import. Commit
their links through the conditional metadata write before deleting previous versions; on
failure, best-effort roll back staging without deleting currently linked representations.
Serialize each file's Pod mutations and cleanup within the runtime. After every store,
reconcile canonical representation children through an @solid/object Container listing,
including legacy paths and orphaned exports regardless of previous encoding links.
For deletions, conditionally rewrite existing metadata first: clear all encoding links, set
`contentSkipped` to `"pending-deletion"`, and retain the source id and provenance. Remove
representations next, then re-read metadata to conditionally delete it under the updated ETag.
Failed cleanup leaves a discoverable tombstone for replay or full reconciliation. Pending
deletion or missing expected encoding links must force a returning file to download again,
even when its source version is unchanged.
A policy omission writes explanatory metadata without incrementing `skipped`.
Drive tests wrap JSON `fixtureFetch` with synthetic media/export responses; do not broaden
fixtureFetch or call live Google APIs. True streaming bodies await a future PodWriter port.
