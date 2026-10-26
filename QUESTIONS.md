<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# T-071 / sst-8xm.59 design questions

Implementation is paused under the lane brief's requirement to stop and record
ambiguities in the design of record. No package code or dependencies were changed.

1. **Which browser-compatible zstd encoder should snapshots use?**
   ADR-007 D2 specifies `snapshot(): Promise<Uint8Array>` as "N-Quads zstd
   (fromCompressed-compatible)"; D3 and the lane require browser support. The
   installed, required `@sparq-org/sparq@0.1.5` exposes `decompress`,
   `decompressToString`, and `SparqStore.fromCompressed`, but no zstd encoder in
   its public JS or raw WASM bindings. Its `Store.loadCompressed` compresses
   the in-memory index, rather than exporting compressed bytes. Node's native
   zstd encoder does not provide the browser implementation. ADR-001 D4 and
   the lane prohibit adding an unnamed third-party dependency.

   Options:
   - Name and authorize a browser-compatible zstd encoder dependency, subject
     to `check:packages`, for both implementations to use.
   - Explicitly allow an in-repo zstd encoder, defining whether valid zstd
     frames containing only raw blocks satisfy the snapshot requirement
     despite not reducing the N-Quads payload size.
   - Amend D2 to allow single-member gzip, which `fromCompressed` already
     accepts and browser `CompressionStream` can produce without dependencies.

2. **What SPARQL and snapshot behavior must the WASM-free fake implement?**
   ADR-007's second 2026-10-25 amendment says the fake "stays tiny and adds no
   dependencies" and includes "LocalIndex behaviour" in the shared contract.
   D2 specifies SELECT, SELECT streams, ASK, CONSTRUCT, and zstd snapshot/restore.
   The package skill additionally requires the fake to never import Sparq at
   runtime. The existing fake only stores graph lifecycle state with n3;
   n3 supplies neither a SPARQL evaluator nor a zstd decoder. The amendment
   explicitly narrows other fake capabilities but does not narrow LocalIndex.

   Options:
   - Define a small supported SPARQL subset and snapshot codec for shared
     contract tests; reject other fake operations with
     `FakeEngineUnsupportedError`, as with existing unsupported features.
   - Permit injected query/snapshot handlers in the fake, analogous to its
     injectable validator, and run SPARQL semantics against the real engine.
   - Require full LocalIndex parity and authorize the additional evaluator
     and codec implementation or dependencies, relaxing the tiny-fake rule.
