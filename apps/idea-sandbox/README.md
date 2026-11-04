<!-- AUTHORED-BY Claude Opus 5.5 -->

# Agent Sandbox (IDEA demo)

An explorable demo of policy as code for AI agents, built for the ODI IDEA programme and aimed
at people who do not write code. Harbour & Finch is a fictional company; its support agent,
Finch Assist, works across ten connected systems. Every decision on the page is made by the
real policy engine, [`@jeswr/agent-sandbox`](../../packages/agent-sandbox), in the browser.

| Tab               | What it shows                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Stories           | Eight short stories played step by step: each action is allowed, held for a person, or stopped, with every check explained. With your own Claude API key, a live agent can attempt the task. |
| Rules             | The agent's global rules and each record's rules, in plain English generated from the same ODRL the gate enforces. Sliders and switches change them live. |
| Connected systems | The MCP lockdown console: switch a system off, or set one kind of action to follow the rules, ask a person or be blocked; see the tools a real MCP server (the lockdown proxy) offers, fetched over MCP in the browser. |
| Code box          | A script the agent wrote, run in QuickJS (WebAssembly) where every `tools.<name>()` call goes through the same gate. |
| Compare           | Every story played under each mode (no guardrails, rules as code, an AI judge, rules plus AI), and every refused action retried by tool call, agent code and MCP client. |
| Audit log         | The hash-chained decision log, with a tamper demonstration.                                    |

A visitor's API key stays in `sessionStorage` and is sent only to `api.anthropic.com`. Without
a key, the AI modes use a keyword stand-in that the page labels as not a model.

```sh
pnpm --filter @jeswr/app-idea-sandbox... build
pnpm --filter @jeswr/app-idea-sandbox dev
```

GitHub Pages serves it at `/solid-sdk/idea-sandbox/` (see `scripts/build-pages.mjs`). It has no
Solid login, so its `scripts/vercel-apps.json` entry sets `clientIdDocument: false`.
