<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->
# Answerable agent explorer

A no-build static site that replays `agent-trace/0.1` traces of software agents handling a mortgage request: every message, every inbound and outbound gate check, every decision. It also explains the reference architecture, the verifiable message, the spec layers and suites, the requirements, the specifications and the roadmap.

- Run: `node scripts/bundle-data.mjs` once, then `python3 -m http.server` and open `http://localhost:8000/`, or serve the folder from any static host. No dependencies or external network calls. Trace loading needs HTTP; browsers block `fetch` from `file://`.
- Data: `node scripts/bundle-data.mjs` (or `pnpm run bundle`) writes `data/bundle.js` (metadata and trace summaries) and one JSON document per trace in `data/traces/`, from `data/model.json`, `data/scenarios.json`, `data/roadmap.json`, `traces/*.json`, `tours/*.json` and `../../docs/specs/agent/*.md`. Rerun it after any change to those files.
- Real traces: `node scripts/import-traces.mjs [dir]` copies `aa-trace-*.json` (default `/mnt/project-files`) into `traces/` and rebundles.
- Fixtures: `node scripts/make-fixture.mjs` writes development traces marked `generated.core: "fixture"`; it never overwrites a real trace.
- Links: the URL hash holds the state, for example `#/explore?scenario=mortgage-core&config=baseline&step=5&level=checks`; add `&play=1` to play and `&present=1` for a recording view.
- Navigation: every link and control goes through `AX.go` (js/util.js). The page routes from its own copy of the hash and mirrors it to the address bar, so it also works inside a framed viewer that passes only a plain `#name`.
- Hosted copy: `node scripts/build-artifact.mjs <out-dir>` writes a copy whose `index.html` has no document skeleton, for hosts that add their own.
- Specifications: `../../docs/specs/agent/`. Suite ids in `data/model.json` must match the layer documents.

## Brief 30

The page loads a metadata index in `data/bundle.js`. Explore fetches the selected
`data/traces/<scenario>--<configuration>.json` by relative URL through `AX.loadTrace`.
In-flight and completed loads share a memory cache. Loading and retryable errors are
visible; navigating away prevents a late response from repainting the view. The matrix,
catalogue, architecture and requirements links use summaries computed when bundling,
so they do not fetch event data. Tours wait for the selected trace before placing a stop.
Publish the per-trace files beside the page, preserving their relative paths.

Import engine runs with
`python3 scripts/import-engine-runs.py <traces-dir> <scenario-runs.json>`.
The explorer copy replaces attachment base64 `bytes` longer than 2 KB (2048 bytes)
with `null` and `bytesOmitted: true`, retaining `digest`, `mediaType` and `byteLength`.
The inspector explains the omission and points to the engine repository's full trace.
Smaller attachments are unchanged. Repeated objects and long strings are stored once
within each trace and restored before any view reads them. Packet `jsonld` and `rdf`,
checks, decisions, reasons, captions, and settlement `objects` and `facts` remain exact,
apart from the stated attachment-byte omission. This shrinks the published copy while
leaving the engine record untouched.

The imported 205 engine runs total **298,730,669 bytes** before copying; compact trace
files total **80,304,023 bytes**. The full Artifact build is **81,591,140 bytes
(81.59 MB), 220 files**; the public build is **81,575,209 bytes (81.58 MB), 220 files**.
The largest published file is `salary-benchmark--baseline.json`, **3,483,987 bytes
(3.48 MB)**, below the bundler's 12 MB limit. Either build fits in two uploads under
64 MB and 255 files each. Both build scripts print actual total bytes, file count and
largest file. Run regression checks with `pnpm test` (Node 24 and Python 3).
