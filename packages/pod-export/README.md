<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/pod-export

Read-only Solid pod Takeout with bounded breadth-first discovery and streaming ZIP output.
Inject the current session's authenticated `fetch`; the library scopes every request to the
storage origin and path and refuses redirects. It uses `@jeswr/ldp-container` for listings.
The migrator's traversal remains separate because migration translates permissions and
intentionally omits auxiliaries, whereas Takeout preserves their served bytes.

```ts
import { planExport, exportPod } from '@jeswr/pod-export';

const plan = await planExport({ fetch, root, signal });
const manifest = await exportPod({
  fetch, root, plan, signal, concurrency: 4,
  onProgress: ({ files, totalFiles, bytes }) => console.log(files, totalFiles, bytes),
  sink: async (chunk) => { await destination.write(chunk); },
});
```

`sink` receives ZIP chunks and may return a promise for backpressure. Node callers can write
them directly to a file. Browsers may collect these ZIP chunks into a Blob; the library never
collects resource bodies or the entire archive. Up to `concurrency` GETs prefetch responses
(default 4, maximum 32); bodies enter `Zip` through `ZipPassThrough` in order, so fflate never
buffers a later file behind an earlier unfinished file. Files are stored without compression.
Memory includes bounded listings, the inventory/manifest, ZIP directory records, and stream
buffers. The classic fflate ZIP format supports files/archive offsets below 4 GiB and up to 65,534 pod entries; exceeding either limit rejects. ZIP64 and
multipart exports are not supported. Use an appropriately sized destination.

Both operations accept `include` / `exclude` arrays of scoped URLs or root-relative paths.
A trailing slash selects a subtree; a file path selects that exact resource. Exclusion wins.
Omitted include selects everything; an empty array selects nothing. Ancestor folders are
visited to reach selected files. Linked ACL/describedby documents follow their selected
resource independently of include, but still obey exclude and storage scope. No auxiliary
suffix is guessed. Queries are refused and fragments collapse to their resource identity.

`maxDepth` defaults to 32 path segments below the root; `maxEntries` defaults to 10,000 distinct
URLs, including root, failed entries, and auxiliary documents. Exceeding either limit rejects,
never silently truncates. Listing parsing retains the helper's 16 MiB / 1,000,000 quad bounds.
A plan reports resources, HEAD sizes, known estimated bytes, and unknown-size counts. HTTP
errors, transport failures and malformed listings are recorded per resource; unreadable
containers cannot disclose their unknown descendants. HEAD 405 permits a later GET.
Auxiliary inventory entries record their advertising resources in `auxiliaryFor`, so changing
filters on a reused plan keeps only selected resources and their auxiliary chains.
A supplied plan is revalidated for scope, filters and bounds, and ZIP paths are always derived
again. It is an estimate, not a transactional snapshot of a changing pod.

The archive has `export-manifest.json` at its root, with `exportedAt`, `root`, and entries
containing `url`, `path`, `contentType`, `bytes`, `kind` and optional `{ message, status? }`
`error`. Containers are empty folders beneath `pod/`; their byte count is zero. RDF GETs
request `text/turtle` and preserve exactly the served body; binary bytes are unchanged.
The manifest records actual response types/bytes. Failed HTTP reads have no ZIP member.
A body failure after streaming began leaves a partial member, explicitly marked with its
error and actual byte count. Cancellation or sink failure rejects the operation; discard
its incomplete output. Abort cancels readers and rejects even if a transport stalls.

Paths decode each URL segment once, normalise Unicode to NFC, replace unsafe characters,
remove dot/empty names and trailing dots/spaces, and cannot be absolute. Case-insensitive
collisions, including file/folder collisions, receive deterministic `~2`, `~3` suffixes;
child paths follow their allocated parent. Original URLs remain in the manifest.
