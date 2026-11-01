<!-- AUTHORED-BY Claude Opus 5.5 -->

# 2. Your first app: a reading list

This chapter builds the data layer of a reading-list app: save links, list them, mark them as
read, delete them. It is about 120 lines of TypeScript and runs unchanged against Solid pods, LWS
storage and an in-memory pod.

The complete code is
[`tools/guide-examples/src/reading-list.ts`](../../tools/guide-examples/src/reading-list.ts),
and its tests are in
[`tools/guide-examples/test/reading-list.test.ts`](../../tools/guide-examples/test/reading-list.test.ts).
Run them from the workspace root:

```sh
pnpm install
npx turbo run test --filter=@jeswr/guide-examples
```

## The plan

- Each saved link is one small RDF document, a bookmark, in a `reading-list` container.
- `@jeswr/solid-bookmark` turns bookmarks into RDF and back, so we never write RDF by hand.
- `@jeswr/storage-client` does the storage. The code only sees its `StorageClient` interface, so
  tests can pass an in-memory pod and the app can pass a real one.

The public shape:

```ts
import type { BookmarkData } from '@jeswr/solid-bookmark';

export interface ReadingItem {
  readonly url: string; // Where the bookmark lives in the pod.
  readonly etag: string; // The version we read; needed to edit it.
  readonly bookmark: BookmarkData; // url, title, tags, archived (read), created, …
}

export interface ReadingList {
  readonly container: string;
  list(signal?: AbortSignal): Promise<ReadingItem[]>;
  add(data: BookmarkData): Promise<ReadingItem>;
  update(item: ReadingItem, changes: Partial<BookmarkData>): Promise<ReadingItem>;
  remove(item: ReadingItem): Promise<void>;
}
```

Notice that every item carries its `etag`. That is how the app proves which version the user saw
when they edit it.

## Step 1: open or create the container

```ts
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;
declare const remembered: string | undefined; // From the app's settings, if saved before.

const container =
  remembered ??
  (await storage.create(storage.root, null, { kind: 'container', name: 'reading-list' })).url;
// Save `container` in the app's settings for next time.
```

The first time, we create the container and keep **the URL the server returns**. On a Solid pod it
will end in `reading-list/`. On LWS the server may choose something else entirely: `name` is only a
hint. So the app stores this URL and passes it back next time, rather than looking for a folder
called `reading-list`.

## Step 2: add a link

```ts
import { type BookmarkData, parseBookmarkTtl, serializeBookmark } from '@jeswr/solid-bookmark';
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;
declare const container: string;
interface ReadingItem { readonly url: string; readonly etag: string; readonly bookmark: BookmarkData }

export async function add(data: BookmarkData): Promise<ReadingItem> {
  // 1. Create an empty document, so the server tells us its URL.
  const created = await storage.create(container, null, { contentType: 'text/turtle' });
  const etag = created.etag ?? (await storage.head(created.url)).etag;
  if (etag === null) throw new Error('The server gave no ETag');

  // 2. Describe the bookmark. Its RDF subject is `<url>#it`, so it needs the URL from step 1.
  const turtle = await serializeBookmark(created.url, { ...data, created: data.created ?? new Date() });

  // 3. Write it, saying which version we are replacing.
  await storage.write(created.url, turtle, { contentType: 'text/turtle', ifMatch: etag });

  // 4. Read back what is stored now, content and ETag together, so the item we return is
  //    exactly the version a later edit will replace.
  const stored = await storage.read(created.url, { accept: 'text/turtle' });
  const bookmark = await parseBookmarkTtl(created.url, await stored.text(), stored.contentType);
  if (bookmark === undefined || stored.etag === null) throw new Error('The bookmark did not save');
  return { url: created.url, etag: stored.etag, bookmark };
}
```

Why create, then write? The bookmark's RDF names itself with its own URL, and on LWS we cannot
know that URL until the server has assigned it. Creating first, then writing, works everywhere.

Why read it back? Some servers do not return an ETag from a write. Asking for it separately could
pick up someone else's change made in between, and pairing their ETag with our data would let the
next edit overwrite their change unseen. Reading content and ETag in one request avoids that, and
also gives us the bookmark exactly as stored (the model trims tags and drops unsafe links). The
full code also refuses a link that is not `http` or `https` before it writes anything.

## Step 3: list the links

```ts
import { parseBookmarkTtl } from '@jeswr/solid-bookmark';
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;
declare const container: string;

for await (const entry of storage.listAll(container)) {
  if (entry.kind !== 'resource') continue; // Skip sub-containers.
  const resource = await storage.read(entry.url, { accept: 'text/turtle' });
  const bookmark = await parseBookmarkTtl(entry.url, await resource.text(), resource.contentType);
  if (bookmark === undefined) continue; // Some other app's file: leave it alone.
  console.log(bookmark.title ?? bookmark.url, bookmark.archived ? '(read)' : '');
}
```

- `listAll` follows LWS pages for us.
- `entry.kind` tells containers from documents. Do not look for a trailing `/`.
- Pods are shared by many apps. A file we cannot parse as a bookmark, even malformed Turtle, is
  skipped, not an error. Network and permission errors still reach the caller.

The full code also skips non-Turtle files before downloading them, and sorts the newest first.

## Step 4: mark a link as read

```ts
import { type BookmarkData, serializeBookmark } from '@jeswr/solid-bookmark';
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;
declare const item: { readonly url: string; readonly etag: string; readonly bookmark: BookmarkData };

const changed = { ...item.bookmark, archived: true, modified: new Date() };
const turtle = await serializeBookmark(item.url, changed);
await storage.write(item.url, turtle, { contentType: 'text/turtle', ifMatch: item.etag });
```

If another tab or app changed this bookmark since we read it, the write fails with a
`StorageError` whose `code` is `'precondition-failed'`. That is the point: we never overwrite a
change we have not seen. The full code shows two ways to respond:

- `update` lets the error reach the caller, which can re-read and ask the user.
- `updateWithRetry` uses `retryOnConflict` to re-read and reapply automatically. Marking as read
  is safe to reapply, so this is fine here. A text edit would need the user to decide.

## Step 5: delete a link

```ts
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;
declare const item: { readonly url: string; readonly etag: string };

await storage.delete(item.url, { ifMatch: item.etag });
```

Deletes are conditional too, so you cannot delete something that changed under you.

## Step 6: test it on an in-memory pod

```ts
import { createMemoryStorage } from '@jeswr/storage-client/memory';

for (const protocol of ['solid', 'lws'] as const) {
  const storage = createMemoryStorage({ protocol });
  // Run the same tests against `storage` for each protocol.
  console.log(protocol, storage.root);
}
```

The memory pod enforces ETags and, in `lws` mode, picks its own URLs, so it catches the two most
common mistakes before you ever touch a real server. The tutorial's tests also cover a conflicting
edit and a stray non-bookmark file in the container.

## Step 7: connect a real pod

Only the start-up code changes. Sign the user in (chapter 3), then:

```ts
import type { PodAuth } from '@jeswr/pod-auth';
import { createPodClient } from '@jeswr/storage-client';

declare const auth: PodAuth;
declare function findStorages(auth: PodAuth): Promise<string[]>; // Chapter 3.
declare function chooseStorage(urls: string[]): Promise<string>; // Your UI.

(await auth.restore()) ?? (await auth.login());
const root = await chooseStorage(await findStorages(auth));
const { storage } = await createPodClient({ fetch: auth.fetch, storage: root });
// Pass `storage` to openReadingList, exactly as the tests pass the memory pod.
```

## What you learned

- Keep the URL and ETag the server gives you. Never build URLs from names.
- Create a document before writing RDF that names it.
- Every edit and delete is conditional; handle `precondition-failed`.
- Let a domain package write the RDF.
- Skip files you do not understand: the pod is shared.
- Test on the memory pod in both protocols.

Next: [signing people in](03-sign-in.md).
