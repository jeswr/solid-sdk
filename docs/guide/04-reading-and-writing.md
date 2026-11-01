<!-- AUTHORED-BY Claude Opus 5.5 -->

# 4. Reading and writing data

`@jeswr/storage-client` is one API over a Solid pod or an LWS storage. You get it from
`createPodClient`, with the safe fetch from chapter 3. The package skill,
[storage-client](../../packages/storage-client/SKILL.md), has the full contract.

## Connect to a pod

```ts
import type { PodAuth } from '@jeswr/pod-auth';
import { createPodClient } from '@jeswr/storage-client';

declare const auth: PodAuth;
declare const storageRoot: string; // For example identity.storages[0].

const { storage, description, features } = await createPodClient({
  fetch: auth.fetch,
  storage: storageRoot,
});

console.log(storage.protocol); // 'solid' or 'lws'
console.log(storage.root); // The storage's root container.
console.log(description.protocol === storage.protocol); // true
console.log(features.move.state); // 'available', 'unavailable' or 'unknown'
```

`createPodClient` asks the server what it is and what it supports, then picks the right back end.
If discovery fails it throws; it never guesses.

`features` tells you what this server can do: search, moves, notifications, access control and
more. Each feature has a `state`. Turn on an optional control only when the state is
`'available'`; `'unknown'` means "no evidence", not "yes".

## Containers and listings

```ts
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;

for await (const entry of storage.listAll(storage.root)) {
  console.log(entry.url, entry.kind, entry.contentType, entry.size, entry.modified);
}
```

`listAll` follows pages for you. LWS servers page large containers and may not tell you the total.
If you page by hand with `list`, pass the `next` cursor back unchanged and stop only when it is
`null`.

Use `entry.kind` to tell containers from files. On LWS, a container URL need not end in `/`.

## Read a resource

```ts
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;
declare const url: string;

const result = await storage.read(url);
const text = await result.text(); // Or bytes(), blob(), or the body stream.
const etag = result.etag; // Keep this: you need it to edit the resource.
```

`readRdf` parses RDF for you and returns an RDF/JS dataset. Chapter 5 shows how to turn that into
typed objects. Pass `ifNoneMatch: etag` to skip the download when nothing changed.

## Create a resource

```ts
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;

const folder = await storage.create(storage.root, null, { kind: 'container', name: 'notes' });
const note = await storage.create(folder.url, 'Buy milk', {
  name: 'shopping.txt',
  contentType: 'text/plain',
});
console.log(note.url, note.etag);
```

**Keep the URL that `create` returns.** On Solid, `name` sets the last part of the URL. On LWS,
`name` is only a suggestion and the server picks the URL. Code that builds
`folder.url + 'shopping.txt'` works on one and breaks on the other.

Save the URLs your app needs to find again, such as the container for each collection, somewhere
it can read on the next start. The Type Index (a pod's directory of where each kind of data lives)
is the standard place; its SDK client is **not ready yet**, so for now keep the URL in your app's
settings.

## Edit a resource

Every edit is **conditional**: you pass the ETag you read, and the server refuses the edit if
the resource changed since. This stops two apps, or two tabs, silently overwriting each other.

```ts
import { StorageError, type StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;
declare const url: string;

const current = await storage.read(url);
if (current.etag === null) throw new Error('The server gave no ETag');
try {
  await storage.write(url, 'Buy milk and eggs', { contentType: 'text/plain', ifMatch: current.etag });
} catch (error) {
  if (error instanceof StorageError && error.code === 'precondition-failed') {
    // Someone else changed it. Re-read, then reapply the change or ask the user.
  } else {
    throw error;
  }
}
```

When your change can be reapplied safely, `retryOnConflict` does the re-read for you:

```ts
import type { StorageClient } from '@jeswr/storage-client';
import { retryOnConflict } from '@jeswr/storage-client/helpers';

declare const storage: StorageClient;
declare const url: string;

await retryOnConflict(
  async (etag) => {
    if (etag === null) throw new Error('The server gave no ETag');
    const text = await (await storage.read(url)).text();
    return storage.write(url, `${text}\nand bread`, { contentType: 'text/plain', ifMatch: etag });
  },
  () => storage.head(url),
);
```

For RDF documents, `patch` changes individual statements instead of rewriting the whole file, and
`writeRdf` writes a dataset as Turtle. Both need `ifMatch` too.

`ifMatch: '*'` means "whatever is there" on `write` and `writeRdf`. Avoid it: on Solid it skips
the check entirely, and on LWS it cannot create a missing resource.

## Move and delete

```ts
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;
declare const note: { url: string; etag: string };
declare const archive: string;

if (storage.features.move.state === 'available') {
  const moved = await storage.move(note.url, archive, { ifMatch: note.etag });
  console.log(moved.url); // The new URL. Sharing settings do not move with it.
}
await storage.delete(archive, { recursive: true });
```

On Solid, a move is a copy then a delete, so it changes the URL and can fail halfway; the client
rolls back what it can and reports a partial move. Recursive deletes walk the tree from the
bottom up.

## Errors

Every failure is a `StorageError` with a `code`, a `status` and the `url`. The codes apps usually
handle:

| Code | What happened | What to do |
| --- | --- | --- |
| `precondition-failed` | Changed since you read it | Re-read and reapply, or ask the user |
| `unauthenticated` | Not signed in, or the session expired | Offer sign-in |
| `forbidden` | Signed in, but no permission | Say so; do not retry |
| `not-found` | It is gone | Remove it from the view |
| `conflict` | A name is taken, or a container is not empty | Pick another name, or delete recursively |
| `unsupported` | This server lacks the feature (`error.feature` says which) | Hide the control |
| `network` | Offline, or the request was aborted | Keep local state; retry if `retryable` |
| `scope` | The URL is outside this storage | Treat it as a bug or a hostile link |

`result.allow` (Solid only) may tell you what the current user can do with a resource. `null` means
the server did not say. It does not mean "no".

## Rules of thumb

- Keep the URL and ETag the server gives you, exactly as given.
- One small document per record works well for lists of things. Split very large collections by
  date or by hash; see [solid-scale-and-sharding](../../skills/solid-scale-and-sharding/SKILL.md).
- Every URL you pass must be absolute and inside `storage.root`. The client refuses anything else
  before it sends a request.
- Pass an `AbortSignal` to long reads and listings, and abort them when the view goes away.

Next: [modelling data as RDF](05-modelling-data.md).
