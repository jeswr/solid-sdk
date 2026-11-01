<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# fetch-rdf engine integration tests

Experimental — AI-agent-generated. Private test workspace; never published.

Runs fetch-rdf's shared parse/fetch contracts and engine-specific checks against
the real Node WASM engine. It consumes both packages' built public entry points.
Keeping the engine dependency here avoids the workspace cycle
`fetch-rdf → rdf-engine → solid-odrl → fetch-rdf`.

Run the suite and its prerequisites from the repository root:

```sh
pnpm exec turbo run lint build typecheck test --filter=@jeswr/fetch-rdf-engine-tests
```
