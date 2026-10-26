<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-lkde — upload planning interpretations

1. **Folder and batch collisions** (04-drive §4.1.2/§4.1.5; DRV-L4): should two
   distinct dropped folders that normalize to the same path merge, rename, or fail?
   Conservative choice: reject ambiguous folder merges, duplicate source paths,
   file/folder collisions, and Replace targeting another pending upload. Ordinary
   file-name collisions support Keep both/Replace/Skip in input order.
2. **Chunk-plan bounds** (DRV-L4; 12-pure-libraries-4): should chunk ranges be
   unbounded arrays, lazy iterators, or bounded plain data? Conservative choice:
   materialize at most 100,000 ranges per file; reject larger plans with a typed
   error. Byte sizes and chunk sizes must be safe integers; empty files have no
   byte ranges but still receive a create/replace action.
3. **Listing completeness and replacement** (04-drive §4.1.5; 00-sdk-assumptions
   A-8/A-10): infer missing ancestors and allow ETag-free replacement, or require
   explicit evidence? Conservative choice: accept a complete, flattened listing
   relative to the target, with explicit parent folders and an ETag for each
   resource selected for replacement. Target URLs are requested Solid paths/Slug
   hints; callers must use actual server-returned identifiers on LWS.
