<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Upload planning (DRV-L4)

Pure snapshot planning: no browser File objects, React, storage calls, or network I/O.
Import from `./index`.

```ts
const plan = planUploads({
  targetContainer: "https://pod.example.org/drive/",
  entries: [
    { kind: "folder", path: ["Reports 2026"] },
    { kind: "file", path: ["Reports 2026", "Report.pdf"], size: 9 },
  ],
  existing: [],
  policy: "keep-both",
  chunkSize: 4,
});
// folders[0]: create Reports%202026/
// files[0]: create Reports%202026/Report.pdf, ifNoneMatch: "*"
// chunks: [0,4), [4,8), [8,9)
```

Inputs use decoded relative **segment arrays**, including the dropped root folder.
Adapters split browser relative paths before calling this library. A slash inside
an individual dropped name is a reserved character to replace, not a separator.
`sourcePath` preserves the input for pairing a planned file with its caller-held
blob. Folder records represent empty folders; file paths also infer parent folders.

`existing` is a complete flattened listing for the relevant destination tree;
include each ancestor folder. Listing order does not matter, existing names are
literal (never normalized), and matching is case-sensitive without Unicode
normalization. The planner cannot detect a conflict omitted from a listing. New
files retain `ifNoneMatch: "*"`; replacement requires a strong quoted ETag and
returns `ifMatch`. A stale listing must be refreshed and replanned on failure.

`folders` contains only folders touched by the drop, in deterministic depth-first
order, with create/skip actions. Execute all folder actions before files; files
retain input order. Folder creates also need create-only SDK semantics. There are
no deletes. `diffFolderTree(entries, existing)` returns the folder-only diff.

`normalizeUploadName` implements 04-drive §4.1.3: reserved `/ \ : # ? % *` and
C0/C1 controls become `-`, names are trimmed and capped at 180 Unicode code points,
case/spaces/Unicode are preserved. Files preserve their complete extension chain
(the first dot after any leading dots starts the chain); folders are capped as a
whole. An extension leaving no room for a stem is rejected, as is capping that
would change which dots start the file's extension chain. `encodeUploadPath`
applies that policy to each segment and uses `encodeURIComponent`, adding `/`
for folders. There is no lowercase slug conversion.

`keepBothName` finds the first free `name (n).ext`, starting at 1 and retaining the
whole extension chain and cap. An already numbered stem stays literal.
`planUploads` reserves existing names, planned folders, and preceding file targets.
`replace` cannot overwrite another pending upload; `skip` emits an explicit skip
with no chunks. Different dropped folders that normalize to the same path,
duplicate source paths, and file/folder collisions are typed errors.

`planChunks(size, chunkSize)` returns indexed half-open byte ranges. Both sizes
must be safe integers (file size >= 0, chunk size > 0). Empty files have no ranges
and still need the planned create/replace operation. At most `MAX_UPLOAD_CHUNKS`
(100,000) ranges are materialized per file; larger plans are rejected. Chunking
describes byte partitioning only, without assuming server resumable-upload support.

All failures use `UploadPlanningError` with a stable `code`; messages omit names,
URLs, and ETags. Traversal segments, malformed Unicode, noncanonical or unsafe
destination URLs, unknown record fields, and inconsistent listings fail closed.
The destination must be a canonical absolute HTTP(S) container URL, without
credentials, query, fragment, encoded separators, or empty path segments.

Paths/URLs are requested Solid targets or Slug hints. LWS may assign different
identifiers: callers must follow actual returned container/resource URLs (SDK A-10),
and must not execute descendant URLs unchanged after a server renames a container.
