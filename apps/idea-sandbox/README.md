<!-- AUTHORED-BY Claude Opus 5.5 -->

# Agent Sandbox (IDEA demo)

An explorable demo of policy as code for AI agents, built for the ODI IDEA programme and aimed
at people who do not write code. Harbour & Finch is a fictional company; its support agent,
Finch Assist, works across ten connected systems. Every decision on the page is made by the
real policy engine, [`@jeswr/agent-sandbox`](../../packages/agent-sandbox), in the browser.

The page is laid out like a chat assistant: a sidebar on the left, the conversation in the
middle.

| Page | What it shows |
| --- | --- |
| New automation | Describe a process in your own words, typed or dictated (browser speech recognition). Claude drafts an automation rule and shows its reasoning; the rule opens in a "New automation rule" pop-up with four tabs: Overview, How it runs (the code or the model's instructions), Systems (which tools it can reach and which are hidden) and Policies (its own policy on top of the organisation's rules, also as ODRL). Without a key, the closest built-in example stands in and is labelled. |
| Your automations | Each rule you turned on. Try it on sample emails (or run it now) and watch the trace: the agent's thinking, each action, and the policy check that passes, holds or blocks it. Held actions can be approved in place. The side panel shows what changed in the simulated Gmail, HubSpot, Jira and Slack. |
| Stories | Eight short stories that play as a live trace when opened, each action labelled with what Harbour &amp; Finch wants. With your own Claude API key, a live agent can attempt the task. |
| Under the hood: Rules | The agent's global rules and each record's rules, in plain English generated from the same ODRL the gate enforces. Sliders and switches change them live. |
| Under the hood: Connected systems | The MCP lockdown console: switch a system off, or set one kind of action to follow the rules, ask a person or be blocked; see the tools a real MCP server (the lockdown proxy) offers, fetched over MCP in the browser. |
| Under the hood: Code box | A script the agent wrote, run in QuickJS (WebAssembly) where every `tools.<name>()` call goes through the same gate. |
| Under the hood: Compare | Every story played under each mode (no guardrails, rules as code, an AI judge, rules plus AI), and every refused action retried by tool call, agent code and MCP client. |
| Under the hood: Audit log | The hash-chained decision log, with a tamper demonstration. |

Automation rules are plain data (`AutomationRule` in `@jeswr/agent-sandbox`). Claude fills a
fixed schema; `validateRule` checks every part against the connected tools before the rule can
run, and the rule's policy is built from a closed vocabulary (who it may write to, how often,
what needs a person), never as free-form ODRL from the model.

A visitor's API key stays in `sessionStorage` and is sent only to `api.anthropic.com`. Without
a key, the AI modes use a keyword stand-in that the page labels as not a model.

```sh
pnpm --filter @jeswr/app-idea-sandbox... build
pnpm --filter @jeswr/app-idea-sandbox dev
```

GitHub Pages serves it at `/solid-sdk/idea-sandbox/` (see `scripts/build-pages.mjs`). It has no
Solid login, so its `scripts/vercel-apps.json` entry sets `clientIdDocument: false`.
