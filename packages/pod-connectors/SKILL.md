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
Source API and document-bound fetch wrappers snapshot native Requests before validating
their URLs and forward the snapshots, preserving effective bodies and policies. Mutable
URL inputs become checked strings before any asynchronous transport work.

All tests use recorded fixtures and memory Pods. Use ./testing for consumers. Run lint,
build, typecheck and test, then the workspace gates before completing a change.

CON-02 adds the shared incremental write pipeline, host-owned ConnectorState, PROV activity
recording and per-adapter vocab-map.ts hooks. Preserve ETags on automatic merges and never
advance checkpoints on failure. The fixture recorder exposes only allowlisted non-personal JSON
fields under configured public route prefixes; it never saves headers or dynamic URLs. Detailed
adapter mappings remain owned by their follow-on connector tasks.

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
Resolve In-Reply-To through the writer's run-local Message-ID map, then the optional
`MailItem.resolveParent(messageId)` hook. Gmail resolves from validated thread metadata via
`ctx.api`/`getJson`, cached once per thread per run. Omit unresolved parent links for explicit
document ids; only Message-ID-keyed file imports retain the Message-ID-derived fallback.

Additions commit RDF, then `.eml`/attachment bytes, then thread/folder memberships in `flush()`.
Retire dropped attachments and remove a changed thread's old membership conditionally before
replacing the RDF that records them; flush only visits known threads. Deletions queue until 100
messages or `flush()`, which processes the remainder before reconciliation. Read each queued
message and each affected collection once per batch, listing stored folders once. Persist all
membership removals conditionally before deleting any message's attachments, `.eml`, then RDF.
Flush rereads its folder listing and each collection it reconciles; never reuse a deletion
batch's dataset after a write has cleared the import session's retained precondition.
Keep each message document available for retries until its cleanup succeeds;
a missing document is a no-op. Reconcile all stored folders, including vanished labels, so
interrupted relabeling cannot strand memberships. Preserve one run per connector container.

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

Google Contacts (CON-05) writes the SolidOS vCard address book under `contacts/`, with
`index.ttl#this`, `people.ttl`, and `Person/<pathId>/index.ttl#this`. Use its typed wrappers;
keep vCard as the write model (V10). Register only the address-book class for `contacts/`.
Encode email addresses for RFC 6068 with `encodeURIComponent` on either side of the final `@`.
Buffer every People API page and require the final sync token before applying writes or
deletions. Use one shared `RunBudget` across all pages and retries, counting every request
and buffered person. Read 400 error details through the shared byte-capped `readJson` too.
An expired token (410, or 400 with the documented `EXPIRED_SYNC_TOKEN` error
detail) discards partial increments and retries a full snapshot once. Retain unchanged
members on increments, remove source deletions with `ctx.remove`, and rewrite `people.ttl`
once. Full snapshots reconcile actual canonical person documents via `Container` listings,
including unindexed writes left by failed runs. Validate `metadata.previousResourceNames`
with `personId` and conditionally remove former documents and memberships. Keep malformed-person
skip counting and the synthetic sorted Turtle mapping snapshot covered by fixture tests.
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
Rely on the shared runner's per-container claim to refuse overlapping in-process imports;
hosts sharing a pod across processes must serialize runs. After every store,
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
