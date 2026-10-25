<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-notifications

> **Experimental — AI-agent-generated.** Scaffold only; no runtime API is implemented.

Pod change subscriptions across notification transports. Design of record: SDK core `ADR-005-live-updates.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

Reserved entry points: `@jeswr/pod-notifications`, `@jeswr/pod-notifications/channels/websocket2023`, `@jeswr/pod-notifications/channels/streaming-http`, `@jeswr/pod-notifications/channels/lws-sse`, `@jeswr/pod-notifications/channels/lws-websocket`, `@jeswr/pod-notifications/channels/webhook-relay`, `@jeswr/pod-notifications/channels/poll`, `@jeswr/pod-notifications/channels/legacy-ws`, `@jeswr/pod-notifications/testing`.
All currently export nothing; implementations and fakes arrive in later tasks.

From the workspace root:

```sh
pnpm --filter @jeswr/pod-notifications run lint
pnpm --filter @jeswr/pod-notifications run build
pnpm --filter @jeswr/pod-notifications run typecheck
pnpm --filter @jeswr/pod-notifications run test
```

The smoke test loads the empty entry points. Coverage is enabled with 100% thresholds
for branches, functions, lines, and statements; this scaffold does not validate protocol behavior.
