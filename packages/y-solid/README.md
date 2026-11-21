<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/y-solid

Persist a Yjs document as an append-only update log in a Solid pod.

Local updates are written automatically; initial hydration, incremental sync, and explicit
compaction preserve Yjs convergence without a last-write-wins snapshot race.

> Experimental. Inject an authenticated fetch; this package performs no login or token handling.

## Install

```sh
npm install github:jeswr/y-solid#main yjs @rdfjs/types
```

`yjs` is a peer dependency. Requires Node.js 20 or newer, or a modern browser.

## Minimal usage

```ts
import { SolidPersistence } from "@jeswr/y-solid";
import * as Y from "yjs";

const doc = new Y.Doc();
const provider = new SolidPersistence({
  doc,
  container: "https://alice.example/documents/my-note/",
  fetch: authenticatedFetch,
});

await provider.whenSynced;
doc.getText("body").insert(0, "Hello, Solid!");
await provider.flush();
```

## Key API

- `SolidPersistence`: `whenSynced`, `sync`, `compact`, `persistFullState`, `flush`, `destroy`, and
  `synced`/`error` events.
- `SolidUpdateStore` from `@jeswr/y-solid/store`: direct update-log operations.
- Scope helpers: `normalizePodBase`, `assertWithinPodScope`, `isContainerUrl`, `PodScopeError`.

Call `sync()` after a Solid notification or on a polling interval to apply remote updates appended
since the last load.

Listing membership parsing uses `@jeswr/ldp-container`. The update store keeps its capped
streaming reads and redirect refusal, skips sub-containers, and sorts update URLs locally.

## Links

- [Source](https://github.com/jeswr/y-solid)
- [Issues](https://github.com/jeswr/y-solid/issues)
- [Yjs](https://github.com/yjs/yjs)
- [Solid Notifications](https://solidproject.org/TR/notifications-protocol)

## License

[MIT](./LICENSE) © Jesse Wright

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

### Browser mirrors (`@jeswr/y-solid/local`)

The optional `y-indexeddb` peer supplies `IndexeddbPersistence`, `storeState` and
`clearDocument` through this subpath. The main provider entry point does not load it.
`hasUnconfirmedLocalState(mirror, loadConfirmed?)` checks persisted updates, including
pending dependent structs and deletions, against a confirmed full Yjs update.
`loadPersistedLocalState(doc, mirror)` refreshes the whole shared update store after
another tab compacts it. `coversUpdates(confirmed, updates)` exposes the same coverage
comparison for atomic acknowledgement transactions.

Use `prepareLocalMirror(namespace, instanceName)` before attaching the instance mirror
to a live document. Scope both names to the authenticated WebID and resource URL, and
include the immutable resource instance ID in `instanceName`. Obsolete and unversioned
mirrors are read into isolated documents; only unconfirmed state is retained under
`<old-name>:retired`. It is never merged into the replacement. Call
`clearLocalMirrors(namespace)` after closing publishers when the user deletes the
resource. These helpers require IndexedDB and propagate storage failures.

Use `openLocalMirror(name, doc)` to check database access and validate persisted
updates before attaching the provider. This contains initialization rejections
discarded by the pinned y-indexeddb version. `waitForLocalMirror(mirror)`
races readiness against database-open rejection, hydration rejection, provider
errors and database error/abort events. Initialization failure destroys the
provider and rejects with `LocalMirrorError` (including the mirror name and cause).
An app can then continue online and tell the user that offline edits will not be
kept on the device. `retireLocalMirror(namespace, instanceName)` archives only
unconfirmed state after a superseded publisher has closed; the archive stays in
the namespace registry for later explicit deletion.
