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
exposed | failed`. `reason` is a fixed vocabulary (a storage 413 is `payload-too-large`, a 507
`insufficient-storage`, any other storage failure `storage`); no server message, URL query or credential is ever
included. An abort is `failed` / `aborted`. No operation throws, whatever it is given.

## Layout and discovery

- The library container is found through the Type Index for the first of `classes` that has a container.
  The Type Index API merges the public and private indexes, so **discovery cannot tell a public-index
  registration from a private one** (a follow-up in `@jeswr/pod-type-index`). Any app that can write the
  public index can therefore register a container that wins the preference below and silently takes over
  as the library (new items go there, and the old library disappears from `list`). The **exposure check on
  the discovered container is the control**: nothing is written into it unless the probe says private, so
  the effect is a library switch or a refused `put`, not a leak. Callers that must pin the library should
  check `store.library` against their expected URL after open. The store compensates in three ways: it registers only in the **private** index (`index: "private"`); when
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

1. The size is checked first (`maxBytes`, `too-large`, from `Blob.size` before any read), then the body is
   read once (see "Large bodies") and its leading bytes are sniffed. The declared type and extension are not trusted: the injected `sniff` (default
   `defaultSniff`) decides; an `undefined` answer is `unsupported`, and a declared type that disagrees with the
   sniffed one is `unsupported` too. A thumbnail is sniffed and validated the same way and must be an image.
   A sniffer receives at most the first `SNIFF_BYTES` (4096) bytes, never the whole body, and the declared
   extension as `hints.extension` (it selects one additional candidate, SPZ below; it never changes a type that has its own signature).
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

## Large bodies: memory and size limits

`put` and `attachThumbnail` read the caller's body **exactly once** into one buffer (a `File` is a handle to a
file on disk and may answer a second read differently, which would break content addressing; no engine
guarantee is assumed). The size check, the sniffed head, the SHA-256 and the length used for `build` all come
from that buffer, and what is uploaded is a **fresh `Blob` constructed from that same buffer**, so the bytes
that are hashed are the bytes that are sent. Nothing in the store reads the caller's `Blob` again, and a
caller's `Blob` that answers differently on a later read has no effect. A `Uint8Array` body is hashed in place
and wrapped in a fresh `Blob` the same way.

`@jeswr/pod-auth`'s `auth.fetch` replays a `Blob` body as it is and rejects other body kinds above
`maxReplayBodyBytes` (16 MiB default); because the store always uploads a `Blob`, uploads above 16 MiB work.
storage-client forwards a `Blob` body to `fetch` unchanged on both backends (`create` and `write`).

Real memory behaviour for a body of `n` bytes: one buffer of `n` bytes (the body as read), plus the `Blob`
built from it (the engine may copy rather than share, so count another `n`), plus whatever `crypto.subtle.digest`
copies internally (WebCrypto has no streaming digest and this package adds no hashing dependency). Plan for
about two to three times `n` during a `put`; the buffer is released when the digest is done, and the `Blob`
lives until the upload finishes. A `Uint8Array` input is not copied for the digest but is copied into the `Blob`.
Sizing is checked before reading (`Blob.size`) and again on the length actually read, so a body that lies about
its size is refused after at most one read.

- "Already exists" checks keep their bounded read: an existing binary is read through `maxBytes` (a thumbnail
  through `maxThumbnailBytes`), buffered in chunks and joined, so while that check runs it holds up to the size
  of the existing file, briefly twice. It happens only when a name is taken.

Effective limits: `maxBytes` (default 50 MiB; raise it for larger uploads) and `maxThumbnailBytes` (5 MiB) bound
what is accepted. Above that, the practical ceiling is the largest `ArrayBuffer` the runtime can allocate
(about 2 GiB in some browsers, larger in Node), the memory above, and the server's own upload limit. A server
refusal is reported as `too-large` with reason `payload-too-large` (HTTP 413, will not succeed for this body) or
`insufficient-storage` (HTTP 507, quota; may succeed after space is freed). A `Uint8Array` the caller mutates
during a `put` is the caller's bug.

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
  leaves a shard alone if any description in it cannot be read or understood (`shardsSkipped`). A candidate is selected by
  the store's hash name (64 hex characters, optionally `-thumb`, then an extension), whatever its content type, so
  PLY and SPZ orphans (`application/octet-stream`) are collected; on LWS, where the server picks names, a
  resource whose name or display name matches, or one with an `image|audio|video|model` type, is a candidate
  (an LWS orphan with a server-chosen name and an `application/octet-stream` type is not collected).
  Returns `{ deleted, retained, shardsSkipped }`.

## Exposure

`@jeswr/pod-access` has a read-only effective-access query, `checkOwnerOnly`. `exposureFromOwnerOnly(check)`
adapts it (structurally) to `(containerUrl) => 'private' | 'exposed' | 'unknown'`. The store **fails closed**:
before writing into the library and before writing into a shard (`put`, `attachThumbnail`) the probe must say
`private`. `exposed` refuses with `exposed` / `library-exposed`. Anything else (`unknown`, a probe that throws,
any other value, or no `exposure` option at all) refuses with `exposed` / `exposure-unknown`, unless the one
exception below applies. A `private` answer is cached per container for `exposureTtlMs` (default 60 s); an
inconclusive answer is never cached. `checkExposure()` runs the probe on demand (on the library, or the storage
root before it exists; a failed probe reads as `unknown`). `exposureFromOwnerOnly` returns `unknown` only for a
check that completed and could not tell; a check that throws or rejects is rethrown, which the store treats
as a failed probe that `allowUnknownExposureFor` can never lift. The package never writes `.acl` or `.acr`. On LWS the
adapter answers `unknown`, so LWS needs `allowUnknownExposureFor` or a probe of the caller's own.

`allowUnknownExposureFor?: (containerUrl: string) => boolean | Promise<boolean>` is the per-container override.
It is consulted only when the probe answered exactly `"unknown"` for that container (the library or one shard):
never for `"exposed"` (not even asked), and never for a missing probe, a probe that threw or an answer that is
not one of the three states (those stay refused). Only the value `true` lets the write proceed; `false`, a
throw, a rejection and any other value (a string, a number, `undefined`, an object) count as `false`, and its
errors are never surfaced. It is asked afresh for every refused write and the answer is never cached, so
approving the library does not approve its shards, or the reverse. There is no store-wide switch.

## Default sniffer

`defaultSniff(bytes, hints?)` is a short allowlist of magic bytes: PNG, JPEG, GIF, WebP, AVIF, HEIC, MP4, M4A,
QuickTime, WebM, GLB, MP3, WAV, Ogg Vorbis/Opus, FLAC, PLY and (only for a declared `.spz`) SPZ. SVG, HTML, XML
and script types are never returned, and bytes carrying markup in the first 512 bytes (an XML prolog in the
first 64) are refused, with NULs ignored so UTF-16 markup is seen. glTF JSON, OBJ and FBX are not recognised.

- **PLY** (`.ply`): the ASCII magic `ply` and a newline (`\n` or `\r\n`), then complete printable-ASCII header
  lines in which, after any `comment` / `obj_info` lines, the `format ascii|binary_little_endian|binary_big_endian
  1.0` line appears within the bytes sniffed (4096). Anything else before `format`, a cut-off format line or
  a non-printable header byte is refused; the markup guard applies as for every type.
- **SPZ** (`.spz`, compressed 3D Gaussian splats): accepted **only** when the caller's declared extension is
  `.spz` (any case, dot optional), never as a general gzip type. The public format documentation
  (nianticlabs/spz) specifies version 4 as a plaintext 32-byte header starting `NGSP` with version 4 (little endian) and an SH
  degree of at most 4, followed by ZSTD streams, and versions 1 to 3 as one gzip member. Both are accepted for
  `.spz`: the gzip form needs the deflate method byte and no reserved flag bits; the `NGSP` form needs a
  version of exactly 4.
- **Content type.** The same documentation names no media type, and no IANA registration for either format was
  found (the IANA site was not reachable from the authoring environment, so this is the absence from the
  format's own documentation rather than a registry lookup). Both are therefore reported as
  `application/octet-stream` with extensions `.ply` and `.spz`, so a declared type of `application/octet-stream` is
  what `put` expects. Neither is ever a renderable type.
- **Why a gzip that inflates to markup is acceptable.** The sniffer sees only the compressed bytes, so a
  `.spz` gzip whose inflated head is markup is accepted as opaque bytes. Likewise `.spz` accepts **any**
  gzip member or any bytes with an `NGSP` version 4 prefix as opaque data, not only valid splats: the store
  never inflates, decodes or renders it, and a consumer that does inflate it must bound the output (a small
  gzip can inflate to far more than `maxBytes`) and validate the inner header. That is harmless for a type that is never
  rendered as a document: it is stored and served as `application/octet-stream` (a browser does not sniff
  that into HTML, especially with `X-Content-Type-Options: nosniff`), and its only consumer decodes it as
  gaussian-splat data, not markup. The markup guard still refuses compressed bytes that carry markup in their
  first 512 bytes. Consumers must keep serving it as `application/octet-stream` and must not inflate it into
  a document.

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
