---
name: pod-export
description: Use when planning or streaming whole-pod ZIP Takeout with @jeswr/pod-export, selecting export subtrees, or maintaining export security and manifests.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Pod Takeout

Read [README.md](./README.md) for the full contract. `planExport({ fetch, root, include?,
exclude?, signal?, maxDepth?, maxEntries? })` returns a breadth-first resource inventory and
size estimate. `exportPod({ ...options, plan?, concurrency?, onProgress?, sink })` returns
the completed manifest and awaits each sink chunk for backpressure.

Inject one session's authenticated fetch. Scope with guarded-fetch; refuse all redirects.
Use ldp-container for listings; never parse RDF memberships manually. Enforce the entry/depth
limits on plans and linked auxiliaries too. Never trust supplied ZIP paths. Linked ACL/meta
resources remain within root and obey excludes. HTTP failures are per-entry errors; a failed
container cannot reveal its descendants. Plans are estimates, not snapshots.

ZIP bodies must enter fflate sequentially: concurrently pushing later ZIP members causes
fflate to buffer entire files. Concurrency prefetches response headers only. Retain bounded
listing/manifest metadata, not pod bodies. Callers choose a streaming file destination or a
browser Blob and own download URL revocation. Abort must reject stalled reads/transports and
cancel bodies; sink errors must propagate, never become resource errors.

Containers become folders under `pod/`; the manifest stays at the ZIP root. Preserve served
RDF and binary bytes. Mid-stream failures leave explicitly marked partial entries. Keep
safe Unicode path allocation, file/folder collisions, limits, every HTTP failure, byte-exact
unzip, backpressure and account cancellation covered by tests. This package is security critical.
