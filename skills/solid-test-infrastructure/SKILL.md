---
name: solid-test-infrastructure
description: Use when creating Solid package or app tests, running Vitest against injected fetch seams, starting a local Community Solid Server for Playwright, seeding accounts and profiles, or preventing flaky/vacuous authenticated integration tests.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Test Solid code against real protocol behavior

Use two layers:

- Vitest for pure logic and data layers with injected fetch, clock, storage, crypto, and network seams.
- Playwright or integration tests against one long-lived local Community Solid Server for actual HTTP, OIDC, DPoP, LDP, ETag, and browser behavior.

## Harness rules

- Start the server once per suite/worker, not once per test. Isolate writes with fresh accounts or pod roots.
- Give CSS and the app distinct fixed ports. Probe the CSS account API rather than treating any HTTP 200 as the right service.
- Seed fresh profiles with the WebID data tests require, including name and `pim:storage`; bare profiles make otherwise-correct application tests appear broken.
- Use client-credentials DPoP fixtures for data arrangement. Keep one focused browser test for the real interactive popup path.
- Before claiming an authenticated read worked, assert the resource is actually private with an anonymous 401/403.
- Pin the CSS version used in CI.
- Never skip a non-completing login implicitly. A login timeout is a test failure unless an explicit opt-in skip is part of the test contract.
- Avoid fixed sleeps. Wait on observable state, responses, or lifecycle seams.

## Non-vacuous security tests

- Drive real OAuth/DPoP code over a stub transport rather than mocking away the library under test.
- Verify signatures, `htm`/`htu`, `ath`, `jkt`, nonce retry, token rotation, and replay behavior.
- Exercise logout/account-switch races and delayed stale operations.
- For 401-budget tests, seed several private resources, count response statuses under the storage origin, and prove challenges do not scale per resource.
- Match exact RDF namespace schemes in fixtures so a successful empty query cannot pass the test accidentally.

In ESM packages, keep Playwright config/setup ESM-safe: use relative module paths, derive paths from `import.meta.url`, and avoid `require`/`__dirname`. Keep test helpers reviewable text—write escaped separators rather than literal NUL bytes.

## Agent persona

When this work is delegated to a sub-agent, spawn the `solid-test-engineer` persona from
[`.claude/agents/solid-test-engineer.md`](../../.claude/agents/solid-test-engineer.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.
