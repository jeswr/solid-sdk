<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/storage-capabilities

> **Experimental — AI-agent-generated.** Scaffold only; no runtime API is implemented.

Storage description discovery and feature flags. Design of record: SDK core `ADR-002-capabilities.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

Reserved entry points: `@jeswr/storage-capabilities`, `@jeswr/storage-capabilities/cache`, `@jeswr/storage-capabilities/vocab`, `@jeswr/storage-capabilities/testing`.
All currently export nothing; implementations and fakes arrive in later tasks.

From the workspace root:

```sh
pnpm --filter @jeswr/storage-capabilities run lint
pnpm --filter @jeswr/storage-capabilities run build
pnpm --filter @jeswr/storage-capabilities run typecheck
pnpm --filter @jeswr/storage-capabilities run test
```

The smoke test loads the empty entry points. Coverage is enabled with 90% thresholds
for branches, functions, lines, and statements; this scaffold does not validate protocol behavior.
