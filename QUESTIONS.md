<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.58 — decision required

1. **Which constraint should change: the required Sparq version or the size budget?**
   ADR-007 §D3 and T-070 require `@sparq-org/sparq@0.1.5` and a passing installed
   WASM size check with raw ≤ 2.5 MiB (2,621,440 bytes), gzip ≤ 900 KiB
   (921,600 bytes). The registry's 0.1.5 tarball contains identical browser and
   Node WASM files of **3,909,895 bytes raw** and **1,444,432 bytes gzip** at level 9
   (1,445,125 bytes at the default compression level). The WASM alone exceeds
   both limits, before counting any JavaScript. The downloaded tarball's SHA-512
   integrity matches the npm registry metadata.

   Options requiring maintainer direction:

   - Keep the required 0.1.5 release and authorize revised size limits.
   - Keep the size limits and authorize a different prebuilt release/artifact
     that meets them, including its exact version and provenance. ADR-007 §D3
     excludes a GitHub pin requiring a Rust build under `ignore-scripts=true`.

   Implementation is stopped under the lane's ambiguity/contradiction rule;
   neither the pin nor the acceptance limits have been changed.
