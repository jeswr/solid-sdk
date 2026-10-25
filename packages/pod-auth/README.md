<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-auth

> **Experimental — AI-agent-generated.** Scaffold only; no runtime API is implemented.

Suite client authentication and session lifecycle. Design of record: SDK core `ADR-004-auth.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

Reserved entry points: `@jeswr/pod-auth`, `@jeswr/pod-auth/react`, `@jeswr/pod-auth/node`, `@jeswr/pod-auth/testing`.
All currently export nothing; implementations and fakes arrive in later tasks.

From the workspace root:

```sh
pnpm --filter @jeswr/pod-auth run lint
pnpm --filter @jeswr/pod-auth run build
pnpm --filter @jeswr/pod-auth run typecheck
pnpm --filter @jeswr/pod-auth run test
```

The smoke test loads the empty entry points. Coverage is enabled with 100% thresholds
for branches, functions, lines, and statements; this scaffold does not validate protocol behavior.
