<!-- AUTHORED-BY Claude Opus 5.5 -->
# Answerable agent explorer

A no-build static site that replays `agent-trace/0.1` traces of software agents handling a mortgage request: every message, every inbound and outbound gate check, every decision. It also explains the reference architecture, the verifiable message, the spec layers and suites, the requirements, the specifications and the roadmap.

- Run: `node scripts/bundle-data.mjs` once, then open `index.html` in a browser (works from `file://`), or serve the folder from any static host. No dependencies, no network.
- Data: `node scripts/bundle-data.mjs` (or `pnpm run bundle`) writes `data/bundle.js` (everything but the traces) and `data/traces-1.js` to `traces-4.js` (the traces, split so no file nears a host's size limit) from `data/model.json`, `data/scenarios.json`, `data/roadmap.json`, `traces/*.json`, `tours/*.json` and `../../docs/specs/agent/*.md`. Rerun it after any change to those files.
- Real traces: `node scripts/import-traces.mjs [dir]` copies `aa-trace-*.json` (default `/mnt/project-files`) into `traces/` and rebundles.
- Fixtures: `node scripts/make-fixture.mjs` writes development traces marked `generated.core: "fixture"`; it never overwrites a real trace.
- Links: the URL hash holds the state, for example `#/explore?scenario=mortgage-core&config=baseline&step=5&level=checks`; add `&play=1` to play and `&present=1` for a recording view.
- Navigation: every link and control goes through `AX.go` (js/util.js). The page routes from its own copy of the hash and mirrors it to the address bar, so it also works inside a framed viewer that passes only a plain `#name`.
- Hosted copy: `node scripts/build-artifact.mjs <out-dir>` writes a copy whose `index.html` has no document skeleton, for hosts that add their own.
- Specifications: `../../docs/specs/agent/`. Suite ids in `data/model.json` must match the layer documents.
