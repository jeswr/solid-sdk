<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/rxdb-solid

An RxDB replication plugin that synchronizes one pod resource per document with a Solid container.

It supports incremental pull, conditional push, tombstone deletes, RxDB conflict handlers, and an
optional RDF serialization seam.

> Experimental. Inject a StorageClient or authenticated fetch; this package performs no login or token handling.

## Install

```sh
npm install github:jeswr/rxdb-solid#main "rxdb@^16" @rdfjs/types
```

`rxdb` is a peer dependency. Requires Node.js 24 or newer, or a modern browser.

## Minimal usage

```ts
import { replicateSolid } from "@jeswr/rxdb-solid";
import { createPodClient } from "@jeswr/storage-client";

const { storage } = await createPodClient({ storage: "https://alice.example/app/items/", fetch: authenticatedFetch });

const replication = replicateSolid({
  collection: items,
  container: "https://alice.example/app/items/",
  storage,
});

await replication.awaitInitialReplication();
await items.insert({ id: "a", title: "Hello, Solid!" });
```

`SolidDocStore` and `replicateSolid` accept an existing `StorageClient`. The legacy `fetch`
option discovers a client lazily through `createPodClient`; discovery errors propagate.
Reads, paginated listings and conditional mutations use the public storage interface.
Key encoding, metadata counters, checkpoints, tombstones and RxDB conflict handling are unchanged.
GC reads an ETag before deleting and refuses deletion when no validator is available.

The persisted layout requires stable child names. Both memory protocols support this layout;
an LWS server that replaces a name hint with another identifier is refused. Such a failed create
may leave an unindexed resource; the adapter never deletes an unfamiliar returned identifier.
Supporting opaque identifiers needs a separate persistent key index and is outside this migration.

The return value is an RxDB `RxReplicationState`; subscribe to its streams or call `reSync()` and
`cancel()` using the normal RxDB replication API.

## Key API

- `replicateSolid(options)`: configure pull, push, batching, retries, live mode, and RDF codecs.
- `SolidDocStore`: lower-level pod document and metadata store from `@jeswr/rxdb-solid/store`.
- `keyToResourceName`, `resourceNameToKey`: reversible resource-name encoding.
- Scope helpers and `PodScopeError`: re-exported fail-closed pod-boundary checks.
- `SolidCheckpoint`, `SolidReplicationOptions`, `RdfSerialization`: public configuration types.

## Links

- [Source](https://github.com/jeswr/rxdb-solid)
- [Issues](https://github.com/jeswr/rxdb-solid/issues)
- [RxDB replication](https://rxdb.info/replication.html)
- [Solid Notifications](https://solidproject.org/TR/notifications-protocol)

## License

[MIT](./LICENSE) © Jesse Wright
