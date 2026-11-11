<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/pod-export

Read-only Solid pod Takeout with bounded breadth-first discovery and streaming ZIP output.
Inject the current session's authenticated `fetch`; the library scopes every request to the
storage origin and path and refuses redirects. It uses `@jeswr/ldp-container` for listings.
`inventoryPod` supplies the shared traversal used by Takeout and pod-migrator; migration
opts into strict direct children, fail-fast reads and auxiliary omission.

```ts
import { planExport, exportPod } from '@jeswr/pod-export';

const plan = await planExport({ fetch, root, signal });
const manifest = await exportPod({
  fetch, root, plan, signal,
  onProgress: ({ files, totalFiles, bytes }) => console.log(files, totalFiles, bytes),
  sink: async (chunk) => { await destination.write(chunk); },
  // Rewrite previously delivered header bytes; restore the append position afterwards.
  patch: async (offset, chunk) => { await destination.patch(offset, chunk); },
});
```

`sink` receives ZIP chunks and may return a promise for backpressure. Node callers can write
them directly to a file. Browsers may collect these ZIP chunks into a Blob; the library never
collects resource bodies or the entire archive. Each GET starts immediately before its body
is consumed; no later response sits unread behind a large file. `concurrency` (1–32) is
retained for call compatibility but requests are sequential. Files are stored without compression.
Memory includes bounded listings, the inventory/manifest, ZIP directory records, and stream
buffers. The classic fflate ZIP format supports files/archive offsets below 4 GiB and up to 65,533 pod entries; exceeding either limit rejects. ZIP64 and
multipart exports are not supported. Use an appropriately sized destination.

Both operations accept `include` / `exclude` arrays of scoped URLs or root-relative paths.
A trailing slash selects a subtree; a file path selects that exact resource. Exclusion wins.
Omitted include selects everything; an empty array selects nothing. Ancestor folders are
visited to reach selected files. Linked ACL/describedby documents follow their selected
resource independently of include, but still obey exclude and storage scope. Advertisements
from unselected ancestor containers are ignored. Targets must be siblings of, or below the
parent of, the advertiser; a Link can never relabel a container or an already processed file. No auxiliary
suffix is guessed. Queries are refused and fragments collapse to their resource identity.

`maxDepth` defaults to 32 path segments below the root; `maxEntries` defaults to 10,000 distinct
URLs, including root, failed entries, and existing auxiliary documents. Advertised auxiliaries
returning 404/410 are absent, omitted entirely, and consume no budget. Planning limit failures
reject; Link overflow, depth or entry-limit failures discovered during export are recorded
on the advertising entry so other members can finish. Listing parsing retains the helper's 16 MiB / 1,000,000 quad bounds.
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
error, `partial: true`, actual byte count and `.partial` suffix. Clean EOF shorter than an
unencoded Content-Length is also partial. Members start with provisional `.partial` headers.
A supplied `patch(offset, chunk)` rewrites a successful member's local header, and the ZIP
central directory receives the same completed name. Header padding preserves every offset.
This keeps streaming and indexed ZIP readers consistent without buffering bodies. Forward-only
sinks without `patch` retain conservative `.partial` names even on successful members; consult
the manifest's `partial` flag. The suite supplies patching for both its save-file and Blob paths.
Cancellation or sink failure rejects the operation; discard
its incomplete output. Abort cancels readers and rejects even if a transport stalls.

Paths decode each URL segment once, normalise Unicode to NFC, replace unsafe characters,
remove dot/empty names and trailing dots/spaces, prefix Windows reserved basenames with `_`,
and cannot be absolute. Partial names are reserved alongside real names to avoid collisions. Case-insensitive
collisions, including file/folder collisions, receive deterministic `~2`, `~3` suffixes;
child paths follow their allocated parent. Original URLs remain in the manifest.

`inventoryPod({ ...options, directChildren?, skipAuxiliaries?, failFast?, readMembers?,
onHead?, onSkipAuxiliary?, onProgress?, numericContentLength? })` returns the same plan shape.
`readMembers` can supply a semantic/completeness-checked iterable of raw membership URLs;
the inventory still enforces pod scope, direct-child policy and budgets. Migration keeps its
independent RDF completeness reader through this seam. `numericContentLength` preserves its
legacy Number-based estimates. The ordinary export path keeps strict decimal lengths and the
shared LDP listing helper. `createPodFetch({ root, fetch, signal?, canonical? })` supplies the
shared redirect-refusing transport, validates Request URLs, response URLs and Location, and
allows migration's stricter URL validator without weakening the pod fence.

The suite asks for a save file before exporting when the browser supports it and streams ZIP
chunks there. Its Blob fallback refuses estimates or actual archive bytes at 1 GiB and warns
when sizes are unknown. Progress uses running totals and callbacks at most every 100 ms, plus
a final update. Account changes cancel work; status flickers for the same account pause new
requests. A beforeunload warning protects running exports and ready downloads.
