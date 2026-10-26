<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-channels

> Experimental — AI-agent-generated. Scaffold only; no runtime capabilities are implemented.

Channel bindings and carriage profiles, reserved for the agent layer (DESIGN §2.1, A-003 / sst-z1d).

The root and `./testing` exports are empty modules. Binding and send subpaths are also empty; only `@jeswr/agent-executor` may import send subpaths (besides channel tests).

No credentials, network requests, policy decisions, or transmissions are available.
Implementation belongs to the later agent tasks. New packages remain private per ADR-001 D5.

Run `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, and `pnpm run test` here.

Tests enforce 100% coverage in every metric; empty modules have no executable branches yet.
