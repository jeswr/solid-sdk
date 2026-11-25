<!-- AUTHORED-BY Claude Sonnet 5.5 -->
# @jeswr/pod-media-store

**Experimental, AI-agent-generated. Security critical.** A generic, framework-free store for
"a binary resource plus one RDF description document" in a Solid or LWS pod. It knows no
vocabulary: the caller injects `parse`, `build` and `locate` for its own description model.
It generalises the app-private store in `apps/pod-photos/src/photos/store.ts`.

All storage I/O goes through `@jeswr/storage-client`; discovery through `@jeswr/pod-type-index`.
There is no raw `fetch`, no RDF construction and no ACL write in this package.

```ts
import { createPodClient } from '@jeswr/storage-client';
import { createTypeIndex } from '@jeswr/pod-type-index';
import { exposureFromOwnerOnly, openMediaStore } from '@jeswr/pod-media-store';
import { checkOwnerOnly } from '@jeswr/pod-access';

const { storage, features } = await createPodClient({ fetch: auth.fetch, storage: storageRoot });
const opened = await openMediaStore<MyModel, MyInput>({
  storage, features,
  typeIndex: createTypeIndex({ storage, features, profile: webId, fetch: auth.fetch }),
  classes: ['https://schema.org/ImageObject'],
  defaultContainerName: 'pictures',
  parse: async (url, body, contentType) => myParse(url, body, contentType), // undefined: not mine
  build: async (url, binaryUrl, input, ctx) => ({ body: myTurtle(url, binaryUrl, input, ctx), contentType: 'text/turtle' }),
  locate: (model) => ({ binaryUrl: model.contentUrl, thumbnailUrl: model.thumbnail }),
  exposure: exposureFromOwnerOnly((url) => checkOwnerOnly({ storage, url, ownerWebId: webId })),
});
if (!opened.ok) throw new Error(opened.error.kind);
const store = opened.value;

const put = await store.put({ bytes: blob, contentType: 'image/png', extension: '.png',
  createdAt: new Date(), description: { title: 'Sunset' }, thumbnail: { bytes: thumb }, signal });
if (put.ok) console.log(put.value.descriptionUrl, put.value.binaryUrl, put.value.existed);
```

Every operation returns `Result<T>`: `{ ok: true, value }` or `{ ok: false, error: { kind, reason, orphans? } }`.
`kind` is the closed union `not-found | conflict | offline | forbidden | too-large | unsupported |
exposed | failed`. `reason` is a fixed vocabulary; no server message, URL query or credential is ever
included. An abort is `failed` / `aborted`. `put` never throws; neither does any other operation.

## Layout and discovery

- The library container is found through the Type Index (private index by default) for the first
  of `classes` that has a container. An existing registration always wins. Nothing is created or
  registered on open; the first `put` creates `<root>/<defaultContainerName>/` and registers every class.
  On LWS the class is declared in the container's create hint instead (no index write).
- Month shards `<library>/<yyyy>/<mm>/` by the item's UTC creation time, created as needed. Binary,
  thumbnail and description sit side by side in the shard; descriptions are told apart from binaries
  by the listing content type, then by `parse`.
- No URL is derived from container plus name after creation: the URL a create returned is the one used.
  The one exception is finding a resource that already holds a deterministic name on Solid, which is
  done by reading the shard listing, never by concatenation.

## put

`put({ bytes, contentType, extension, createdAt, description, thumbnail?, signal? })`:

1. The size is checked first (`maxBytes`, `too-large`), then the bytes are sniffed. The declared type and
   extension are not trusted: the injected `sniff` (default `defaultSniff`) decides, a `undefined` answer is
   `unsupported`, and a declared type that disagrees with the sniffed one is `unsupported` too.
2. SHA-256 (WebCrypto). Requested names: `<hex><ext>` for the binary, `<hex>-thumb<ext>` for the thumbnail
   and `<hex>` for the description. Order: binary, thumbnail, description.
3. The description is created empty (a "pending" document), then written with `build`'s output on the
   response ETag, because its URL must exist before its content can name itself (D8 in the review).
4. "Already exists" (Solid) is success only if the existing binary's bytes hash to the expected value, and the
   existing description parses and `locate`s that binary. Anything else is `conflict` and nothing is overwritten.
   A description still empty (another writer is filling it) is polled (`pendingPolls`, `pendingDelayMs`, injected
   `sleep`), then reported as `conflict` / `description-pending`. An existing thumbnail is adopted when it sniffs
   as an image.
5. On any failure the store deletes only the resources this call created, description first, each conditional on
   the ETag of this call's own create response (`etagSource === "response"`). A resource without such an ETag, or
   one someone changed since, is left and listed in `error.orphans`. A binary or thumbnail is also left when another
   description now carries the content name (the race where writer A's compensation would delete bytes writer B's
   description points at). Cleanup ignores the caller's abort so an aborted put does not leak.

**LWS gap.** The server chooses names, so two puts of the same bytes make two pairs and the store cannot find the
first by name. Inject `findByHash(sha256, signal) => { descriptionUrl } | undefined` (for example from a local
journal or an index) to dedupe; hits are verified (binary bytes hash, description parses and `locate`s the binary)
before being reported as `existed`. The shard containers are looked up by name or display title, so a server that
ignores the requested container name leaves shards undiscoverable across sessions (they are remembered within one).

## list, get, update, remove

- `list({ cursor?, limit?, signal? })`: newest shard first, newest first within a shard, `concurrency` description
  reads at a time, opaque cursor. Each member is checked per item and fails closed: unparseable descriptions are
  skipped and counted, an empty just-created document counts as `pending`, sub-containers and members outside the
  shard count as `foreign` / `outOfScope`. A media URL that a description gives is accepted only inside a shard of
  the library; an item whose binary points elsewhere is skipped, a bad thumbnail is dropped. An offline pod fails the
  page rather than reading as empty.
- `get(descriptionUrl)`. The URL must be a direct child of a shard of the library.
- `update(descriptionUrl, mutate, { signal? })`: conditional on the observed ETag, re-read and reapplied up to
  `updateAttempts` times. `mutate({ url, body, contentType })` returns the new serialised body (or `undefined` for no
  change), so it can keep other apps' triples; the store never rebuilds a description from a parsed value. The result
  must still parse and `locate` a media URL inside the library, or nothing is written.
- `remove(descriptionUrl)`: records the delete in the `journal`, deletes the description, then the binary and
  thumbnail (each by HEAD then `If-Match` delete, only inside the description's own shard, a missing one counts as done),
  then clears the journal entry. `resumePending()` finishes entries a crash left; it treats the journal as untrusted
  and deletes only inside a shard of the library. `createMemoryJournal()` is the in-memory implementation; implement
  `DeleteJournal` over durable storage for crash resistance.

## Exposure

`@jeswr/pod-access` has a read-only effective-access query, `checkOwnerOnly`. `exposureFromOwnerOnly(check)` adapts it
(structurally; this package does not depend on pod-access) to the `ExposureCheck` shape
`(containerUrl) => 'private' | 'exposed' | 'unknown'`. `put` refuses (`exposed`) when the probe says `exposed`,
before it creates anything, and optionally when it is `unknown` (`refuseUnknownExposure`). A `private` answer is
reused for `exposureTtlMs`. Before the library exists the probe is asked about the storage root, which the new
container inherits. `checkExposure()` runs the probe on demand. The package never writes `.acl` or `.acr`.

## Containment

`isInsideLibrary(libraryUrl, url)` is the pure path check (Solid): same origin, a real segment boundary, absolute
`http(s)`, no credentials, query, fragment, backslash or encoded delimiters, and not the library itself.
`store.isInsideLibrary(url)` uses it on Solid. LWS identifiers are opaque, so there it answers `true` only for URLs this
store created or listed itself; the async operations prove containment through `storage.parentOf`.

## Limits

No offline outbox (writes fail with `offline`); no collection membership clean-up on delete; no
thumbnail backfill; the cursor is positional, so items inserted while paging can shift a page by one.
