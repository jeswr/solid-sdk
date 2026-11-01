---
name: fetch-rdf-engine-tests
description: Maintain fetch-rdf's real Node WASM parser integration tests without introducing a reverse engine dependency in fetch-rdf.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# fetch-rdf engine integration tests

This private test workspace depends on fetch-rdf and rdf-engine. Keep the real
engine dependency here: rdf-engine depends on solid-odrl, whose tests depend on
fetch-rdf. A fetch-rdf dependency on rdf-engine creates a Turbo package cycle,
including when declared only in devDependencies.

Reuse `packages/fetch-rdf/test/{parse,fetch}-cases.ts` so default and real-WASM
parsers run the same contract. Import the packages through their public exports;
use `@jeswr/rdf-engine/node`, and dispose engines after testing. Keep fixtures
local and inject fetch so tests need no network.

Run this workspace's lint, build, typecheck and test scripts after building its
workspace dependencies. The root graph regression test verifies Turbo can order
the integration suite and both packages.
