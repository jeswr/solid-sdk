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
included. An abort is `failed` / `aborted`. No operation throws, whatever it is given.

## Layout and discovery

- The library container is found through the Type Index for the first of `classes` that has a container.
  The Type Index API merges the public and private indexes, so discovery cannot tell them apart. The
  store compensates in three ways: it registers only in the **private** index (`index: "private"`); when
  several containers are registered it prefers the one called `defaultContainerName`, then the first in
  URL order; and it never writes into a container (the library or a shard) before the exposure probe has
  said it is private (below). A planted registration therefore cannot receive media silently; at worst it
  makes `put` fail closed.
- Nothing is created or registered on open; the first `put` creates `<root>/<defaultContainerName>/` and
  registers every class. On LWS the class is declared in the container's create hint instead.
- Month shards `<library>/<yyyy>/<mm>/` by the item's UTC creation time, created as needed. Binary,
  thumbnail and description sit side by side in the shard. On Solid shards are matched by URL segment. On
  LWS identifiers are the server's, so after creating a shard the store checks the identifier and, if the
  server picked another, stores the name as the container's title (`setMetadata`); if it cannot, the put
  fails with `failed` / `shard-title` rather than creating shards no later session can find.
- **Not supported: an existing flat or differently laid-out library.** Anything outside `<yyyy>/<mm>/`
  shards (including Pod Photos' present data) is not listed; it is counted as `foreign` in `skipped`. A
  migration is outside this package (known limit, tracked for the Pod Photos port).

## put

`put({ bytes, contentType, extension, createdAt, description, thumbnail?, signal? })`:

1. The size is checked first (`maxBytes`, `too-large`), then the bytes are sniffed. The declared type and
   extension are not trusted: the injected `sniff` (default `defaultSniff`) decides; an `undefined` answer is
   `unsupported`, and a declared type that disagrees with the sniffed one is `unsupported` too. A
   thumbnail is sniffed and validated the same way and must be an image.
2. SHA-256 (WebCrypto). Names: `<hex><ext>` for the binary, `<hex>-thumb<ext>` for the thumbnail and
   `<hex>` for the description.
3. The probe is asked about the library and the shard (see Exposure) before anything is written into them.
4. The binary is created (on Solid with `If-None-Match: *`). A name already taken is adopted only if the bytes
   there hash to the expected value; otherwise `conflict` / `hash-mismatch` and nothing is overwritten.
5. **Solid: one atomic create.** The description's URL is known (`<shard>/<hash>`), so `build` runs first and the
   complete document is created at that name with create-if-absent. No empty or half-written description is ever
   visible. If the name is taken, the existing description is adopted when it parses and `locate`s our binary
   (`conflict` / `description-mismatch` otherwise); an empty shell left by an older writer is taken over with a
   write conditional on its own ETag.
6. **LWS: create, then fill.** The server picks the identifier, so an empty description is created, `build` runs on
   the returned URL, and the body is written with `If-Match` on that document's own validator (the create
   response's, or a `HEAD`'s when the response had none). Never `*`. A server that can give no validator fails
   with `no-validator`. If anything fails in between, the empty shell is removed (conditional on the ETag just
   observed, and only while still empty); one that cannot be removed is listed in `error.orphans`, remains
   visible as `pending` in `list`, can be removed with `remove`, and is collected by `sweepOrphans`.
7. **A failed put deletes no media.** Media are named by their content, so on Solid a retry adopts what was left.
   Nothing is deleted by guesswork, so there is no window in which one writer deletes bytes another writer's
   description is about to point at. What a failed put created and left is reported in `error.orphans`; the
   `sweepOrphans` maintenance call removes media no description references (below).

**Thumbnails for items that already exist.** If the description already exists and does not link a thumbnail, the
put adopts it and returns `thumbnailMissing: true` and `thumbnailUrl: undefined` (no thumbnail is uploaded in
that case). Call `attachThumbnail(descriptionUrl, { bytes, mutate })` to store the image and link it through a
conditional edit; `mutate(current, thumbnailUrl)` returns the new description body and must `locate` that URL.

**LWS gap.** The server chooses names, so two puts of the same bytes make two pairs and the store cannot find
the first by name. Inject `findByHash(sha256, signal) => { descriptionUrl } | undefined` to dedupe. A hit is
used only if it is a member of the library, its binary hashes to the expected value and its description
parses; a hit that is stale, foreign or from before the library exists is a miss, not a failure. The same
bytes with `createdAt` in two different months are stored twice (one shard per month).

## list, get, update, remove, attachThumbnail, sweepOrphans

- `list({ cursor?, limit?, signal? })`: newest shard first, newest first within a shard, `concurrency` description
  reads at a time. The cursor is opaque and carries the shard container's URL, so two containers with one label
  (LWS) are both listed and resume correctly. Each member is checked and fails closed: unparseable descriptions
  are skipped and counted, an empty document counts as `pending`, sub-containers and non-shard children count as
  `foreign`, members outside the shard as `outOfScope`. A media URL a description gives is accepted only inside a
  shard of the library. An offline pod fails the page rather than reading as empty.
- `get(descriptionUrl)`: the URL must be a direct child of a shard of the library.
- `update(descriptionUrl, mutate, { signal? })`: conditional on the observed ETag, re-read and reapplied up to
  `updateAttempts` times. `mutate({ url, body, contentType })` returns the new serialised body (or `undefined` for
  no change). The store never rebuilds a description from a parsed value. The result must still parse, and must
  `locate` **the same binary and thumbnail**: an edit cannot repoint an item at another item's media (use
  `attachThumbnail` to add a thumbnail).
- `attachThumbnail(descriptionUrl, { bytes, mutate, signal? })`: see above. It probes exposure first.
- `remove(descriptionUrl)`: a journalled two-step delete. The entry is recorded with `phase: "intent"`; the
  description is deleted conditionally on its ETag (and only while it still locates the recorded binary); only
  once it is confirmed gone, and not recreated, are the binary and thumbnail deleted (HEAD, then `If-Match`
  delete) and the entry cleared. A definitive failure of the description delete (forbidden, ETag race lost
  repeatedly) withdraws the entry and leaves the item whole; being offline keeps it for `resumePending`.
  An empty (`pending`) description can be removed.
- Only an item's **own** media are ever deleted: in the description's shard, never the description itself or a
  description-typed resource, never an auxiliary name (`.acl`, `.meta`, any dot name), and on Solid only names
  of the form `<description name>[-thumb].<ext>`. On LWS names are opaque, so a description that a writer with
  access to the pod crafted to name another item's media in the same shard can still make `remove` delete
  that media; `update` and `put` never create such a description. This is a known limit.
- `resumePending()`: treats the journal as untrusted (shard and description must be inside the library). For an
  `intent` entry it deletes the description first (if it still locates the recorded binary; otherwise the entry
  is dropped as `rejected`), then the media.
- `sweepOrphans({ minAgeMs = 24 h, signal? })`: in every shard, deletes media no description references and
  empty descriptions, only if older than `minAgeMs` (the grace period that protects a concurrent put), and
  leaves a shard alone if any description in it cannot be read or understood (`shardsSkipped`). On Solid only
  names this store creates are candidates; on LWS only resources with an `image|audio|video|model` type.
  Returns `{ deleted, retained, shardsSkipped }`.

## Exposure

`@jeswr/pod-access` has a read-only effective-access query, `checkOwnerOnly`. `exposureFromOwnerOnly(check)`
adapts it (structurally) to `(containerUrl) => 'private' | 'exposed' | 'unknown'`. The store **fails closed**:
before writing into the library and before writing into a shard (`put`, `attachThumbnail`) the probe must say
`private`. `exposed` refuses with `exposed` / `library-exposed`. Anything else (`unknown`, a probe that throws,
any other value, or no `exposure` option at all) refuses with `exposed` / `exposure-unknown`, unless
`allowUnknownExposure: true` is set, which lets only the inconclusive cases through, never `exposed`. A `private`
answer is cached per container for `exposureTtlMs` (default 60 s); an inconclusive answer is never cached.
`checkExposure()` runs the probe on demand (on the library, or the storage root before it exists). The package
never writes `.acl` or `.acr`. On LWS the adapter answers `unknown`, so LWS needs `allowUnknownExposure` or a
probe of the caller's own.

## Containment

`isInsideLibrary(libraryUrl, url)` is the pure path check (Solid): same origin, a real segment boundary, absolute
`http(s)`, no credentials, query, fragment or backslash, no percent-encoded `.` `/` `\` `?` `#` or control
character, no `.`/`..`/empty segment, no dot-prefixed name below the library (`.acl`, `.meta`), and not the
library itself. `store.isInsideLibrary(url)` uses it on Solid. LWS identifiers are opaque, so there it answers
`true` only for URLs this store created or listed itself; the async operations prove containment through
`storage.parentOf`.

## Limits

- No offline outbox (writes fail with `offline`); no collection membership clean-up on delete.
- The cursor is positional within a shard, so items inserted while paging can shift a page by one.
- A cursor, a journal entry, a type index entry and a description are all untrusted input.
- Fit for Pod Photos: its `PodStore` is dataset based, flat and holds description-only items (albums); this
  package needs a binary and `yyyy/mm` shards, so porting it needs a data migration and a model for
  description-only items. Not done here.
- Each `list` page re-lists the library and year containers; large libraries cost listing requests.
