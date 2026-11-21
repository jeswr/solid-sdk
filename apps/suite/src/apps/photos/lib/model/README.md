<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
# Photos model (PHO-00)

Hook-free model for PHO-01. The EXIF and photograph accessors were ported from
`apps/pod-photos/src/photos`; albums retain legacy `schema:hasPart` reads and write ordered
`schema:ListItem` membership. `parsePhotos` also reads the Pod Manager Google Photos connector's
multi-subject `schema:ImageObject` documents. New photos use `schema:Photograph`; videos use
`schema:VideoObject` with the same descriptive, dimension, date and location predicates, and
`schema:duration` as a typed `xsd:duration`. Bare VideoObject type markers without a content URL
are ignored. `duration.ts` accepts fixed ISO durations (days, hours, minutes and fractional seconds),
without calendar-dependent years/months, signs or exponent notation; writes use seconds only.
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

MP4, MOV and WebM share this upload path and use encoder dimensions with orientation 1.
MP4/MOV capture dates, legacy QuickTime coordinates and movie duration come from `mp4.ts`;
sidecars fill missing capture fields and the encoder fills missing duration. WebM uses sidecars
and encoder metadata directly. The bounded BMFF walker supports ordinary, extended and to-end
box sizes, both movie-header versions and the 1904 epoch, QuickTime and ISO `meta` layouts,
and zero terminators inside containers only when followed entirely by zero padding. Nested
size-0 boxes with nonzero bytes are ambiguous with terminators and are refused; top-level
to-end boxes remain supported. The lazy walker limits total box visits to
100,000 and never descends into `mdat`. Invalid extents or excessive box counts yield no metadata.
Location stripping validates the complete layout and rebuilds it in place using a contextual
allow-list of playback boxes: movie/track headers, audio/video/timecode sample entries, their
known codec configuration children, sample tables, data references and fragment/index boxes.
Every non-allow-listed box is renamed `free` and its entire payload is zero-filled, including
title/comment boxes, XMP, Exif, UUID/vendor boxes, `udta` and both QuickTime and ISO `meta` forms.
Existing `free`, `skip` and `wide` payloads are also zero-filled. Within retained boxes, handler
names, visual sample entries' 32-byte compressor names and trailing payloads of self-contained
`alis`/`url `/`urn ` data references are zero-filled. Non-self-contained data references are
refused. Optional timecode reel-name atoms and `sbgp`/`sgpd` boxes with grouping types other than
`roll`, `prol`, `rap `, `sync`, `tele`, `alst`, `tscl`, `stsa` and `sap ` are neutralised as `free`.

Only `vide`, `soun` and `tmcd` tracks with allow-listed sample formats survive. Other tracks,
including iPhone `mebx` orientation tracks and vendor telemetry, are removed together with their
sample bytes in `mdat`. Every `mdat` payload byte outside retained tracks' sample ranges is
zero-filled too, including unreferenced gaps left by editors and entire unused payloads.
Static ranges are resolved from `stsc`, `stsz`/`stz2` and `stco`/`co64`;
fragment ranges use `tfhd`/`trex` defaults and `trun` offsets, including implicit base offsets.
File-backed `iloc` item extents in removed metadata are erased too. Bounds, counts, offsets and
sample aliasing are validated before mutation. Inconsistent or unresolved layouts fail closed
with `VideoLocationError` and instructions to disable Remove location; refusal leaves the buffer
untouched. No sizes change, so retained media and chunk offsets stay valid.

The codec bitstreams of retained audio/video samples are not inspected: embedded metadata such
as SEI user data inside H.264/HEVC frames may remain. `readVideoMetadata` still reads legacy
location atoms for display before stripping. Upload preparation reads the MP4/MOV file once,
extracts metadata, then scrubs the same caller-owned buffer without another full-buffer copy.
The input Blob remains immutable.
WebM/Matroska location stripping is refused.

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
