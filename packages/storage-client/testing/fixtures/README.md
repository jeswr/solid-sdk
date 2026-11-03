<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Recorded conformance exchanges

`css/baseline` was captured from in-process Community Solid Server 7.2.0 with pod-auth
client credentials on 2026-11-01. `sparq-solid/baseline` uses the fixed-owner
`@sparq-org/solid-server@0.1.6` WASM dispatcher. All account names, WebIDs, bodies and URLs
are disposable test data. Credential headers are omitted; account/token API calls and
initial private ACL seeding are outside these recordings. No live server is used in replay.

`setup` records `createPodClient` discovery. CSS scenario directories record the identically
named public conformance cases; storage-client unit tests consume discovery, RDF patch and
missing-metadata-validator captures. The conformance tool replays all six captured CSS cases.
Sparq's root PUT succeeds but the following HEAD has no discovery link; its fixture locks in
that limitation and the expected `no-storage-link` error without synthesizing advertisements.

Run `RECORD=1 pnpm run conformance -- --target css,sparq-solid` from the repository root to
produce fresh UUID directories. Copy `setup` and the matching scenario directories into
`baseline` after inspecting headers and decoded base64 bodies, then run both packages' tests.
The full conformance reports retain upstream failures. See tools/storage-conformance/README.md
for runtime and the current CSS RDF negotiation and metadata validator limitations.
