<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.18.2 compatibility questions

1. **VC embedded tab/LF/CR rejection.** The shared `safeHttpIri` accepts and
   percent-encodes embedded tab, LF, and CR in paths, queries, and fragments; the
   former VC guard rejects them. Options: adopt escaping, or keep the existing
   strip-divergence pre-check and delegate validation. Chosen: keep the pre-check
   (brief: Task, “If rdf-serialize ACCEPTS something the old copy rejected, do not
   loosen”). Differential tests cover every C0 byte at edges and in scheme,
   authority, path, query, and fragment positions. No decision blocks this lane.

2. **Pod connectors drop-on-invalid policy.** Shared `safeIri` escapes embedded
   Turtle-forbidden characters, while the former connector guard drops any value
   containing them. Options: accept escaped values, or reject when the shared
   `escapeIri` would change the input, then delegate to shared `safeIri`. Chosen:
   preserve rejection using shared `escapeIri` as the pre-check (same brief rule).
   Relative, empty, and malformed absolute IRIs now fail the shared parser. Open
   schemes, including `javascript:`, and userinfo retain their existing behavior;
   scheme policy changes are outside this lane. No decision blocks this lane.
