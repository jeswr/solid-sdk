<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/y-solid

Persist a Yjs document as an immutable update log on Solid or Linked Web Storage (LWS).

> Experimental — AI-agent-generated. Authentication is supplied by your StorageClient.

```ts
import { createPodClient } from "@jeswr/storage-client";
import { YSolidProvider } from "@jeswr/y-solid";
import * as Y from "yjs";

const { storage } = await createPodClient({
  fetch: authenticatedFetch,
  storage: "https://alice.example/",
});
const doc = new Y.Doc();
const provider = new YSolidProvider({
  doc,
  storage,
  container: documentLogContainer, // Use the URL returned by storage.create().
  mode: "log",
  notifications, // Optional NotificationsClient from @jeswr/pod-notifications.
});

await provider.whenSynced;
doc.getText("body").insert(0, "Hello, Solid!");
await provider.flush();
```

`yjs` is a peer dependency. Use Node.js 24 or a modern browser, as required by storage-client.
Create the document's log container before constructing the provider. With LWS, keep the exact
container URL returned by storage: identifiers need not end in `/` or reflect containment.

## API

`SolidPersistence` and `SolidUpdateStore` keep their public class names. Construction now takes
`storage: StorageClient` instead of `fetch`. Advanced consumers can pass a configured `store`
to `SolidPersistence`. Existing scope-helper exports remain available.

`YSolidProvider` wraps `SolidPersistence` with the ADR-006 options and reports `mode: 'log'`.
`mode: 'auto'` (the default) selects log mode in this release. Explicit `mode: 'live'` throws;
live transport and awareness are outside T-060.

- `whenSynced` resolves after initial hydration, and rejects if loading cannot complete safely.
- `sync()` reconciles unread members; call it manually when no NotificationsClient is supplied.
- `flush()` persists pending edits immediately. It rejects on failure; the batch stays queued
  for a later flush or edit to retry. Local edits normally merge after a 300 ms debounce.
- `compact()` writes a snapshot and retires only the records folded into that snapshot.
  Empty and single-member logs are left alone. `compaction` defaults to
  `{ afterUpdates: 200, minIntervalMs: 60_000 }`; the next write or reconciliation checks the
  threshold and minimum interval. Manual compaction bypasses that policy.
- `persistFullState()` persists a document built before the provider was constructed.
- `disconnect()` flushes and closes notifications. Local edits made while disconnected stay
  queued; `connect()` reconciles and resumes persistence.
- `destroy()` stops subscriptions and future application/persistence, releases listeners and
  discards pending edits. Await `flush()` first when those edits must be stored. The caller owns
  the Y.Doc and the shared StorageClient/NotificationsClient.
- Events: `synced`, `error(Error)`, `status('connecting'|'connected'|'disconnected')`, and
  `conflict(StorageError)` for background conditional-deletion conflicts.

With notifications, Create hints read the new resource after checking storage scope and
logical container membership, even before it appears in a listing. Other changes and
reconnect/resync hints trigger an authoritative listing and ingestion. The NotificationsClient
chooses the transport and fallback cadence (the current core client polls every 30 seconds).

## Wire format and safety

Each resource starts with a 16-byte header: ASCII `JYU1` (update) or `JYS1` (snapshot), followed
by unsigned 64-bit milliseconds and 32 random bits, both big-endian. The remaining bytes are
an ordinary Yjs v1 update. New names are `<13-digit ms>-<8 base32 chars>.yupdate` or
`snapshot-<13-digit ms>-<8 base32 chars>.ysnap`. Names are hints passed to `storage.create()`;
the returned URL is authoritative. Headerless v0.1 logs still load in their original name order.

Loading applies **every snapshot first**, then every update, ordered by header time and random
value with a URL tie-break. It keeps older offline writes and concurrent snapshots. If a listed
member disappears (404/410), loading re-lists unread members, up to five passes by default;
it fails instead of reporting synced if no clean pass completes.

Compaction validates all payloads on scratch documents, encodes the current state, creates a
fresh `JYS1` snapshot, and requires `created: true` before any deletion. A snapshot larger
than the configured resource read cap is refused before creation or deletion. Deletes carry the exact
strong ETags read with the folded records. Records without strong validators remain in the log;
a changed validator fails closed. Concurrent appends stay untouched. Corrupt Yjs updates are
reported and skipped during ingestion; compaction refuses to retire any corrupt batch.

The store uses storage-client's public methods only. StorageClient enforces transport redirects,
storage scope and protocol listing parsing. The store additionally checks Solid document scope
or LWS `parentOf` membership, and caps each streamed resource at 64 MiB, including its header.
`maxListingBytes` bounds serialized Entry metadata accumulated from `listAll` (16 MiB by default);
it is no longer a raw HTTP listing-body limit. Transport/parser listing limits belong to the
StorageClient implementation. `listUpdateUrls()` returns URL-sorted membership; header ordering
is provided by `loadUpdates()`.

## License

[MIT](./LICENSE) © Jesse Wright
