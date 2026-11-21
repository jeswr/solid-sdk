<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Phase 4 (40w)

Step 1 is complete. The inspector shows packets and linked store views with
highlighted JSON-LD and Turtle or TriG in separate scrollable panes. The
context is folded by default. Its setting follows the reader between events.
The wide dialog uses the same panes and opens bundled context documents.
Older traces still show their existing fact and record summaries.

`node scripts/bundle-data.mjs` indexed 278 traces and copied the four context
files byte for byte. The largest trace in the sample bundle was 3,483,992
bytes, within the 12,000,000-byte limit. The four hand-run engine traces were
copied through the existing attachment and repeated-value encoding for the
test. The full importer was reserved for the orchestrator.

`node --test --test-isolation=none test/*.test.mjs` passed all 53 tests with
those four copies and with the committed traces restored. The source trace
directory is 164,576,968 bytes. The four samples grew from 991,754 to
2,725,137 bytes. Extrapolating that increase while holding the six joint
recordings fixed puts the full directory at roughly 429 MB.

Check the layout at 360, 700 and 1280 pixels. The panes should stack in the
narrow inspector and sit beside each other when it has 620 pixels of content
width. Long lines should scroll within each pane. Check the context fold
across events, opening a context in the dialog, and focus after Close and
Escape in both colour themes.
