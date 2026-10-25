<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Photos model (PHO-00)

Hook-free model for PHO-01. The EXIF and photograph accessors were ported from
`apps/pod-photos/src/photos`; albums retain legacy `schema:hasPart` reads and write ordered
`schema:ListItem` membership. `parsePhotos` also reads the Pod Manager Google Photos connector's
multi-subject `schema:ImageObject` documents. All new photos use `schema:Photograph`.

`index.ts` exports the model, EXIF, album, timeline, upload, I/O, and trash functions.
`photoStorage(authenticatedFetch, storageRoot)` scopes all requests and redirects to `photos/`.
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
TIFF/EXIF bytes with an encoder double. No EXIF reader is mocked.

`uploadPhotos` writes each original, thumbnail, then metadata with create-only preconditions.
An error stops the batch; earlier writes remain, and errors propagate with their HTTP status.
Callers must retain the input identifiers and reconcile partially uploaded binaries before retrying.
No metadata is published for a photo whose thumbnail upload failed.

`trashPhoto` copies the supported metadata and a PROV record into `.trash/` before conditionally
deleting the original description. Original subject identity is retained. Restore is create-only;
a collision preserves the trash copy. Purge removes matching app-owned original/thumbnail binaries,
then the metadata copy; imported binary paths and existing original descriptions are refused. Failed moves may leave both metadata
copies, so callers can reconcile without losing the recovery copy. Existing album memberships and
favourite values are not rewritten by trash; they reference the stable original subject.

`setFavourite` returns a new preference value; preference persistence and account isolation belong
to PHO-01's SDK adapter. Day/month groups use UTC keys; fixed item URLs stay as specified in
07-parity-backlog. See repository `QUESTIONS.md` for conservative interpretations.

Run `pnpm --filter @jeswr/app-suite test:coverage` for a per-file 100% statement, branch,
function, and line coverage gate over this directory.
