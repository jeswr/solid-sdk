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

## Shared tables (40x)

<!-- AUTHORED-BY Codex GPT-6 -->

The importer copies each scenario table once and the bundler puts it at
`data/traces/linked/<scenario>.json`. Both enforce a 12,000,000-byte limit per
table. The explorer requests a relative table URL when it opens a trace and
reuses the request for the scenario's other traces. An unavailable table
leaves the inspector open with a plain note. Legacy traces keep their
existing views.

| Hand-run file | Explorer bytes before | Explorer bytes with shared tables |
| --- | ---: | ---: |
| `age-check--baseline.json` | 182,615 | 184,759 |
| `age-check--branch-1--baseline.json` | 57,864 | 58,751 |
| `mortgage-core--baseline.json` | 465,022 | 470,610 |
| `mortgage-core--authenticity-data-integrity.json` | 286,253 | 291,841 |
| `linked/age-check.json` (31 keys) | — | 402,324 |
| `linked/mortgage-core.json` (67 keys) | — | 817,248 |

With just the four hand-run samples replaced, the explorer trace directory
was 165,810,747 bytes, up from 164,576,968 bytes. The estimate for full
regeneration is **209 MB** for the explorer and **723 MB** for the engine.
It applies the average sample increase per trace to 272 live traces and the
average table size to 72 scenarios, with the six joint recordings held fixed.
The two scenarios make this an estimate in decimal MB.

The importer and public build ran in a disposable directory. The public
build indexed 278 traces and copied both tables byte for byte.
`check-public-bundle.mjs` scanned 306 files, including the tables, and found
zero roadmap text matches or symlinks. The committed explorer traces and
data matched HEAD.

All 57 explorer tests passed with the committed traces and with the imported
samples. They cover a single fetch shared across paths, the missing-table
note, the size limit, and rejection of missing keys and unsafe table paths.
The linked view and its test passed Biome. The touched legacy explorer files
have the same lint diagnostics as HEAD.

## Review 40r11 fixes

<!-- AUTHORED-BY Codex GPT-6 -->

The importer validates each shared reference against its manifest group and
copies the table once. The explorer shares the fetch across branches of that
configuration and continues to render traces without a table. The importer
and bundler require regular files inside `traces/linked` and keep the
12,000,000-byte limit per table.

The public checker parses JSON, scans its string values and checks RDF text
after unescaping literals. Its regression test embeds both roadmap strings
from the review independently in linked JSON-LD, Turtle and TriG views.

The largest table measured across all 38 mortgage-main groups and 12
other groups was
`linked/mortgage-main--accountability-reputation-post.json`. It stores
417 views in **4,157,963 compact bytes** or **4,172,563 engine bytes**.
The 38 mortgage-main tables sum to 95,514,367 compact bytes.

The projected trace directories are **294 MB for the explorer** and
**809 MB for the engine**. The estimate uses all 38 measured mortgage-main
table sizes and weights the other 12 measured groups by whether their
existing engine traces total at least 1 MB. It includes the added event
keys and references and holds the six joint recordings at their original
sizes. All sizes use decimal MB.

All 59 explorer tests passed on the committed fixtures and with populated
tables in a disposable copy. The importer and public bundler processed
278 traces and all 50 measured tables, including the largest table. The
public bundle checker scanned 333 files and found zero roadmap matches
or symlinks. The Biome error check passed for the changed hand-written
JavaScript and TypeScript.
