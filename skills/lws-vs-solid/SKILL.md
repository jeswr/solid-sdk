---
name: lws-vs-solid
description: Use when adapting a Solid app to LWS through the suite SDK, especially server-assigned identifiers, ETags, permission hints, grants, recursive notifications and paginated containers.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Build apps across Solid and LWS

## Quick reference

Use `createPodAuth` for bounded `auth.fetch`, `createPodClient` for storage operations, and
`createNotifications` for invalidation. Discover the protocol and branch on structured feature
states. These skills describe the public APIs in this checkout, including incomplete surfaces:

- [storage-capabilities](../../packages/storage-capabilities/SKILL.md): discovery, feature evidence and caches.
- [storage-client](../../packages/storage-client/SKILL.md): reads, listings and conditional mutations.
- [pod-auth](../../packages/pod-auth/SKILL.md): sessions, credential boundaries and agent identities.
- [pod-notifications](../../packages/pod-notifications/SKILL.md): push, polling and reconciliation.
- [pod-access](../../packages/pod-access/SKILL.md): Solid WAC/ACP and LWS ODRL sharing, access requests, offline policy translation and notifications.

For HTTP contracts and specification sources, read [solid-lws](../solid-lws/SKILL.md).
Keep protocol internals in the SDK; apps import the storage-client root entry point rather
than its `/solid` or `/lws` backends. Discovery failure is an error, not permission to guess.

## Changes app authors must make

| Concern | Solid SDK behavior | LWS SDK behavior | App rule |
| --- | --- | --- | --- |
| Creation and naming | A supplied `name` creates an exact encoded child with PUT and `If-None-Match: *`; unnamed creation POSTs. | Creation always POSTs; `name` is a Slug hint and the server chooses the identifier. PUT only updates existing resources. | Persist the returned `url`; never join a container URL and a proposed filename to predict identity. |
| Containment | Container membership corresponds to paths; `parentOf` uses path arithmetic. | Parentage comes from `up` and listings. Containers can have opaque, slashless identifiers. | Use `list` / `listAll`, `entry.kind` and `parentOf`; do not infer LWS kind or logical parent from a slash. |
| Conditional edits | Mutations require `ifMatch` at the SDK boundary. `write` / `writeRdf` with `'*'` omit the Solid precondition. | Mutations require `ifMatch`. `write` / `writeRdf` with `'*'` send `If-Match: *`, which still cannot create a missing resource. | Preserve the observed ETag verbatim and re-read on `precondition-failed` (412). Prefer that ETag over `'*'`. |
| Caller permission hints | `read` / `head` can populate `allow` from WAC-Allow when present. | `allow` is always `null`; there is no WAC-Allow-based permission result. | Null is unknown. Capability availability is server support, not proof that this caller can perform an operation. Handle 401/403. |
| Sharing | Discovered access-control models can be WAC or ACP. | Access control may advertise `odrl-grants` or `none`; request/grant services are optional. | Check `state`, model, supported profiles and endpoints; use `createAccessClient` from pod-access. |
| Container notifications | Container channels and polling cover membership; use `hot` for edits to specific resources. | Push retains recursive server semantics; polling still covers direct membership. | `depth: 'recursive'` is best effort and creates no client traversal. Reconcile after interruptions. |
| Container paging | Current Solid backend returns one page. | `next` cursors are opaque, and `total` can be absent or approximate. | Prefer `listAll`; for manual paging pass the returned cursor unchanged and stop only at `next === null`. |
| Moves | Copy+delete emulation changes identity and can fail partially. | Requires advertised MoveResource support; `name` is ignored and identity may change. | Check `features.move` details and retain the returned URL; do not promise atomic rename or preserved sharing. |

LWS logical containment does not broaden this client's credential boundary. All operation URLs
and cursors must still be absolute and within `description.root`; the storage identifier may
differ from that root but does not authorize foreign fetches. Use `storage.isWithinStorage`
for scope checks, and never pass linkset targets to fetch merely because they appeared in metadata.

## Create, enumerate and edit without predicting URLs

```ts
import type { PodAuth } from '@jeswr/pod-auth';
import { createPodClient, type Entry } from '@jeswr/storage-client';
import { createMemoryCache } from '@jeswr/storage-capabilities/cache';

export async function createNote(auth: PodAuth, storageUrl: string) {
  const { storage, description, features } = await createPodClient({
    fetch: auth.fetch,
    storage: storageUrl,
    capabilities: createMemoryCache(),
  });
  const created = await storage.create(storage.root, 'Draft', {
    name: 'note.txt',
    contentType: 'text/plain',
  });
  const current = await storage.head(created.url);
  if (current.etag === null) throw new Error('Re-read before editing: no ETag supplied');
  const updated = await storage.write(created.url, 'Revised draft', {
    contentType: 'text/plain',
    ifMatch: current.etag,
  });
  const entries: Entry[] = [];
  for await (const entry of storage.listAll(storage.root)) entries.push(entry);
  return { url: updated.url, parent: await storage.parentOf(updated.url),
    entries, protocol: description.protocol, features };
}
```

The cache here isolates one example operation. In an app, keep it for the account session and
share it across clients; discard or invalidate it on logout. `createPodClient`'s `signal` covers
discovery only; supply operation signals for subsequent work. Use streaming iteration rather
than collecting every entry in memory for large collections.

`patch`, `move`, `delete` and `setMetadata` require a nonempty, non-wildcard ETag too, even
where TypeScript options are optional. Metadata edits use `storage.metadata(url).etag`, not
the content ETag. A successful mutation can return a null ETag if its follow-up HEAD fails;
the write already committed, so obtain a new validator before another edit.

LWS RDF patches may use read-modify-write with one re-read/reapply on conflict. Use an explicit
conditional `writeRdf` when every intervening edit must be rejected. RDF content is opaque on
LWS unless content negotiation is advertised; `readRdf` parses an RDF representation, it does
not convert arbitrary JSON into RDF. Both current backends leave JSON-LD writing unsupported.

## Grants, authentication and missing features

Enable optional controls only for `state === 'available'`. Missing service entries remain
`unknown`, including in a fetched description. Inspect `detail.model`, profiles and endpoints;
do not branch on the diagnostic `evidence` string or assume every LWS server supports grants.

Access requests/grants require an advertised supported access profile. A grant is an
authorization record managed by the server, not an OAuth token to put in an Authorization
header. `pod-auth` owns protocol discovery and credential exchange. Agent identities can have
`webId: null`; use identity presence to recognize authentication and keep keys/tokens out of UI
state. Use `createAccessClient({ storage, storageId: description.id, identity })` for LWS grants
and requests; the identity callback returns the current caller identifier or null. These grant
records remain separate from the offline translation core's neutral policy rules.

Use `createNotifications` with the same fetch and storage client. Re-fetch on changes and
reconcile on `resync`; events are hints, not a resource snapshot or guaranteed replay log.
`plan()` may advertise webhook relay while the implemented subscription polls. Observe its
actual `channel` and `state`, and close it on teardown/logout. See the package skill for a
complete subscription example and the limits of `hot`, depth and disabled polling.

`features.recursiveDelete` describes a separate POST service, not permission to add Depth to
DELETE. Current `storage.delete(..., { recursive: true, ifMatch })` performs client traversal;
it can fail after deleting some descendants. Do not automatically repeat destructive work.

## Verify examples

Build the documented packages and their dependencies, then run
`node scripts/check-sdk-skill-examples.mjs` from the workspace root. The script typechecks
each TypeScript fence independently against the packages' exported declarations.
