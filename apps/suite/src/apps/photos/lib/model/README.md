<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Photos model (PHO-00)

Hook-free model for PHO-01. The EXIF and photograph accessors were ported from
`apps/pod-photos/src/photos`; albums retain legacy `schema:hasPart` reads and write ordered
`schema:ListItem` membership. `parsePhotos` also reads the Pod Manager Google Photos connector's
multi-subject `schema:ImageObject` documents. All new photos use `schema:Photograph`.
Album ListItems and capture points may be named or blank RDF nodes; reads preserve their terms.
Optional technical metadata is converted field by field, dropping invalid values/dates while
retaining valid fields and other photos in the same document.

`index.ts` exports the model, EXIF, album, timeline, upload, I/O, and trash functions.
`photoStorage(authenticatedFetch, storageRoot)` scopes all requests and redirects to `photos/`.
Upload preparation canonicalizes the storage base before minting resource URLs and RDF subjects,
so default ports and hostname casing agree with storage requests, listings, and managed purge paths.
Reads retain ETags; writes require `{ create: true }` or `{ etag }`. A server without ETags can
support create/read, but cannot safely support the model's destructive trash operations.
`ensureContainers` creates intermediate containers with create-only semantics. `list` reads an
LDP container; callers load only the relevant resources and group them with `groupPhotos`.

`preparePhoto` accepts an explicit identifier, timestamp, and `ImageEncoder`. Its raw dimensions
must precede orientation; `thumbnail` must apply the requested EXIF orientation exactly once,
including mirrored orientations, and emit metadata-free WebP at the requested dimensions.
No browser APIs or real image encoding belong here. When `stripLocation` is enabled,
`stripLocation` must remove location metadata from the original binary while preserving its type,
pixels and orientation; the model removes location from RDF too. The Node tests use real minimal
TIFF/EXIF bytes with an encoder double. No EXIF reader is mocked. WebP containers skip EXIF
extraction because the pinned reader does not support them; the encoder still decodes/validates
pixels and supplies dimensions. WebP EXIF fields are omitted, and thumbnail orientation defaults
to 1.

`uploadPhotos` writes each original, thumbnail, then metadata with create-only preconditions.
An error stops the batch; earlier writes remain, and errors propagate with their HTTP status.
Callers must retain the input identifiers and reconcile partially uploaded binaries before retrying.
No metadata is published for a photo whose thumbnail upload failed.

`trashPhoto` copies the supported metadata and a PROV record into `.trash/` before conditionally
replacing the original description with a receipt-bearing tombstone. Original subject identity is
retained. Each trash cycle assigns a fresh `prov:wasGeneratedBy` activity shared with its tombstone.
Restore and purge claim the trash record with an ETag-conditional state write before changing photo
resources, and delete the trash copy using the claim's ETag. State is stored as
`schema:creativeWorkStatus` on the PROV record; legacy records without it remain readable.

Restore creates an absent legacy description or conditionally replaces only its own generation's
tombstone using that tombstone's ETag. Live descriptions carry the same activity. A retry recognizes
the receipt and retries conditional trash cleanup, including after a lost creation response.
`savePhoto` retains the receipt through ordinary edits using the matching revision. An unrelated live
description (even an identical photo without the receipt) preserves the copy in `restoring` state,
which forbids purge. Legacy restoring records without a receipt retain create-only collision
protection.

Purge removes matching app-owned original/thumbnail binaries, then the trash copy; it retains the
item tombstone permanently. Readers see no photo at that URL, while stale restore writes remain
fenced across subsequent trash/purge cycles. The item URL therefore stays occupied and cannot be
reused by a create-only upload. Imported binary paths, existing live descriptions, and tombstones
from a different generation are refused. A `purging` record can only retry purge, including after
partial binary deletion; it permanently forbids restore. Failed moves may leave a live description
and a recovery copy, so callers can reconcile without losing metadata. Existing album memberships
and favourite values are not rewritten by trash; they reference the stable original subject.

`setFavourite` returns a new preference value; preference persistence and account isolation belong
to PHO-01's SDK adapter. Day/month groups use UTC keys; fixed item URLs stay as specified in
07-parity-backlog. See repository `QUESTIONS.md` for conservative interpretations.

Run `pnpm --filter @jeswr/app-suite test:coverage` for a per-file 100% statement, branch,
function, and line coverage gate over this directory.
