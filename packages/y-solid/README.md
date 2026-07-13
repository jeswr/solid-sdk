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

## Links

- [Source](https://github.com/jeswr/y-solid)
- [Issues](https://github.com/jeswr/y-solid/issues)
- [Yjs](https://github.com/yjs/yjs)
- [Solid Notifications](https://solidproject.org/TR/notifications-protocol)

## License

[MIT](./LICENSE) © Jesse Wright
