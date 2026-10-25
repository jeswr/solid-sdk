<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/rdf-engine

> **Experimental — AI-agent-generated.** Scaffold only; no runtime API is implemented.

Lazy RDF engine facade for local query and validation. Design of record: SDK core `ADR-007-sparq-wasm.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

Reserved entry points: `@jeswr/rdf-engine`, `@jeswr/rdf-engine/browser`, `@jeswr/rdf-engine/node`, `@jeswr/rdf-engine/testing`.
All currently export nothing; implementations and fakes arrive in later tasks.

From the workspace root:

```sh
pnpm --filter @jeswr/rdf-engine run lint
pnpm --filter @jeswr/rdf-engine run build
pnpm --filter @jeswr/rdf-engine run typecheck
pnpm --filter @jeswr/rdf-engine run test
```

The smoke test loads the empty entry points. Coverage is enabled with 90% thresholds
for branches, functions, lines, and statements; this scaffold does not validate protocol behavior.
