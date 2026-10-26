<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/storage-conformance

> **Experimental — AI-agent-generated.** Scaffold only; no runtime API is implemented.

Shared storage conformance suite. Design of record: SDK core `ADR-009-test-strategy.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private conformance tool at version 0.1.0 (ADR-009).
Requires Node.js >=24 and the root pnpm workspace tooling.

Reserved entry points: `@jeswr/storage-conformance`, `@jeswr/storage-conformance/testing`.
All currently export nothing; implementations and fakes arrive in later tasks.

From the workspace root:

```sh
pnpm --filter @jeswr/storage-conformance run lint
pnpm --filter @jeswr/storage-conformance run build
pnpm --filter @jeswr/storage-conformance run typecheck
pnpm --filter @jeswr/storage-conformance run test
```

The smoke test loads the empty entry points. Coverage is enabled with 90% thresholds
for branches, functions, lines, and statements; this scaffold does not validate protocol behavior.
