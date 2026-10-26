<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/storage-client

> **Experimental — AI-agent-generated.** Scaffold only; no runtime API is implemented.

Protocol-neutral storage clients for Solid and LWS. Design of record: SDK core `ADR-003-storage-client.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

Reserved entry points: `@jeswr/storage-client`, `@jeswr/storage-client/solid`, `@jeswr/storage-client/lws`, `@jeswr/storage-client/memory`, `@jeswr/storage-client/errors`, `@jeswr/storage-client/helpers`, `@jeswr/storage-client/testing`.
All currently export nothing; implementations and fakes arrive in later tasks.

From the workspace root:

```sh
pnpm --filter @jeswr/storage-client run lint
pnpm --filter @jeswr/storage-client run build
pnpm --filter @jeswr/storage-client run typecheck
pnpm --filter @jeswr/storage-client run test
```

The smoke test loads the empty entry points. Coverage is enabled with 100% thresholds
for branches, functions, lines, and statements; this scaffold does not validate protocol behavior.
