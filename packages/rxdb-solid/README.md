<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/rxdb-solid

An RxDB replication plugin that synchronizes one pod resource per document with a Solid container.

It supports incremental pull, conditional push, tombstone deletes, RxDB conflict handlers, and an
optional RDF serialization seam.

> Experimental. Inject an authenticated fetch; this package performs no login or token handling.

## Install

```sh
npm install github:jeswr/rxdb-solid#main "rxdb@^16" @rdfjs/types
```

`rxdb` is a peer dependency. Requires Node.js 20 or newer, or a modern browser.

## Minimal usage

```ts
import { replicateSolid } from "@jeswr/rxdb-solid";

const replication = replicateSolid({
  collection: items,
  container: "https://alice.example/app/items/",
  fetch: authenticatedFetch,
});

await replication.awaitInitialReplication();
await items.insert({ id: "a", title: "Hello, Solid!" });
```

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
