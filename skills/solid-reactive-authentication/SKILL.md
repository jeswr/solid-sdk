---
name: solid-reactive-authentication
description: Use when maintaining code that directly integrates the external @solid/reactive-authentication package, its authorization-code-flow element, global fetch patch, or legacy token-provider lifecycle. Prefer @jeswr/solid-auth-core for new suite applications.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Maintain reactive-authentication integrations

`@solid/reactive-authentication` is external to this workspace. New suite code should use `@jeswr/solid-auth-core`, which centralizes the provider, pristine-fetch pin, session restore, proactive auth, and React glue.

For existing direct consumers, treat `ReactiveFetchManager` as an app-lifetime singleton. Register its global patch once; logout clears provider session state rather than stacking another manager or wrapper on the next login.

## Load-bearing rules

- Capture a pristine fetch before global patching. Use it for OIDC discovery/token HTTP and every foreign-origin request.
- Do not rely on `credentials: "omit"` to bypass a patched global; the wrapper can still upgrade a 401.
- Keep provider login, restore, refresh, and reset generation-fenced. Re-check the generation after every await before writing state.
- Single-flight same-WebID login and reject simultaneous different-WebID login.
- Tear down only the session ID owned by the stale operation so an old failure cannot log out a newer session.
- Detect successful login by a token attached during that attempt, not by a public `2xx` response or a sticky historical flag.
- Do not correlate probes with custom headers; cross-origin headers can trigger rejected CORS preflights. Keep DPoP `htu` free of query and fragment.
- Lazy-read methods from dynamically defined custom elements; an eager `.getCode.bind(...)` can run before upgrade.
- Fail closed when UI state is unauthenticated but the auth boundary was armed.
- Restore must produce an authenticated, refresh-capable fetch, not only a WebID.
- Keep proactive token attachment restricted to proven resource origins. Never include a foreign service or issuer solely because it returned a 401.

Do not fork token-provider or session-provider files into another app. When touching an existing fork, migrate it toward `@jeswr/solid-auth-core` and keep cross-account, stale-operation, pristine-fetch, and login-stall tests adversarial.

## Agent persona

When this work is delegated to a sub-agent, spawn the `solid-frontend-dev` persona from
[`.claude/agents/solid-frontend-dev.md`](../../.claude/agents/solid-frontend-dev.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.
