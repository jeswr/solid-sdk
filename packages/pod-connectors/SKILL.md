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
vocabulary (`http://schema.org/`, matching apps/suite's mail model) stay identical. Gmail supplies
`documentId: "gmail-" + id` and a source-native thread key; validate opaque ids against
`[A-Za-z0-9_-]{1,256}` and skip invalid ones. File/mbox imports keep Message-ID document ids with
collision fallback and References/In-Reply-To ancestry. Gmail history deletions resolve slugs
directly; full syncs list the account's `messages/` container and sweep unseen Gmail message RDF
documents. There is no Gmail source index. Keep Spam/Trash in the full source listing.

Additions commit RDF, then `.eml`/attachment bytes, then thread/folder memberships in `flush()`.
Retire dropped attachments before replacing the RDF that records them. Deletions reverse the
order: read the message, persist membership removals conditionally, delete attachments and `.eml`,
and delete message RDF last. Keep that document available for retries until cleanup succeeds;
a missing document is a no-op. Reconcile all stored folders, including vanished labels, so
interrupted relabeling cannot strand memberships. Preserve one run per connector container.
adapter mappings remain owned by their follow-on connector tasks.

CON-03 implements `./node` and the `pod-connectors` bin. Keep its imports separate from
browser entry points. Read `src/node/config.ts` and the README's Node CLI section before
changing the provisional MCP JSON schema. Never read process environment in this package;
use the 0600 owner-held config descriptor, with no symlink following. Reuse solid-dpop for
Pod client credentials and preserve its guarded discovery, transport separation, nonce
retries, memory-only cache, and redirect refusal. CON-12 owns the later pod-auth migration.
Preserve the effective request signal in the exported Pod fetch, including refresh and
nonce retry transports; reject already-aborted requests before sending. Use per-request
transport closures so concurrent callers keep separate signals, and compose any internal
signal with the caller's using AbortSignal.any.

Source login binds only `127.0.0.1`, with `/oauth-callback` as the fixed callback path.
`connectors[id].callbackPort` (also accepted by authorizeLoopback's NodeOAuthConfig) selects
a fixed port, validated as an integer from 1024 to 65535; omission uses an OS-assigned port.
Adapters with OAuth `requiresCallbackPort: true` (Twitch) require this setting for both
direct and proxy exchange: fail with a clear configuration error before opening the browser
if missing. Register `http://127.0.0.1:<callbackPort>/oauth-callback` with the provider; never
fall back to another port if binding fails. Validate Host, path, state,
and code before S256 exchange. Reserved OAuth parameters cannot be overridden. Always
close the listener on completion, timeout, cancellation, and errors. Never persist tokens.
The state store requires an advertised in-container WAC ACL and installs owner-only grants
before accessing JSON. Keep ETags and create-only writes; a failed import retains its prior
successful cursor/counts/time, and failed state persistence must produce a nonzero exit.
CLI tests use fixture source transports and a memory Pod; only callback tests open loopback
sockets. Never include arbitrary server/exception text in CLI diagnostics.
