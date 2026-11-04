<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/agent-sandbox

A fail-closed policy gate for AI agents, built for the ODI IDEA programme. Every tool call an
agent makes, whether through a model's tool use, code the agent wrote, or an MCP client, passes
through one gate that checks three kinds of rule:

- **Global rules**: what the agent may do on its own, only with a person's approval, or never.
  These are an [`@jeswr/agent-mandate`](../agent-mandate) mandate (ODRL 2.2 with the agent
  profile), plus run-time grants such as a colleague's delegation.
- **Rules attached to the data**: each record carries its owner's ODRL policy
  (evaluated by [`@jeswr/solid-odrl`](../solid-odrl)). The agent cannot read a record its
  policy forbids, and once it has read one, that policy applies to every message or upload
  it sends to a person or outside service afterwards.
- **Limits**: messages a day, contacts per person per day, money a day. A hard limit stops; a
  soft limit asks a person.

The strictest answer wins, and anything no rule covers is refused (closed world). Every
decision is written to a hash-chained `DecisionRecord` before anything runs.

This package is `securityCritical` and private (not mirror-published).

## The gate, step by step

1. **Catalogue**: tools the rules never allow are not offered at all (`sandbox.tools()`), and
   `sandbox.catalogue()` says why each one is hidden.
2. **Global rules**, checked per recipient.
3. **Data rules**: on read, each returned record is filtered through its own policy
   (`withheld` counts what was dropped); on send, every record read in the session, plus any the
   tool sends on the agent's behalf (`CallContext.uses`), must allow the recipient, purpose and
   region.
4. **Limits**, counted per recipient (a channel counts as one).
5. **Record**, then run, hold for a person (`held()`, `approve()`, `decline()`), or stop. An
   approved call is checked again before it runs.

## Who decides

`EnforcementMode` sets who makes the call:

| Mode     | Decides                                                                                 |
| -------- | --------------------------------------------------------------------------------------- |
| `off`    | Nobody: every call runs (the baseline).                                                 |
| `policy` | The rules, as code.                                                                     |
| `llm`    | A model reading the rules as text (`JudgeModel`).                                       |
| `hybrid` | The rules, after a model classifies what a message is really for (its purpose). A model can only make the answer stricter. |

`standInJudge` is a keyword stand-in for tests and offline demos. It is not a model.

## Entry points

| Import                          | What                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `@jeswr/agent-sandbox`          | `createSandbox`, the record, plain-English rule text (`describeMandate`, `describePolicy`), the story and agent runners. |
| `@jeswr/agent-sandbox/world`    | Harbour & Finch, a fictional company: 17 tools over 10 systems, people, data policies and nine scenarios. |
| `@jeswr/agent-sandbox/code`     | `runCode`: runs agent-written JavaScript in QuickJS (WebAssembly) with no network, files or timers, CPU, memory, call and wall-clock limits, and `tools.<name>()` as its only way out. |
| `@jeswr/agent-sandbox/mcp`      | `createMcpProxy` (an MCP server offering only permitted tools) and `upstreamTools` (wrap a real MCP server's tools; unmapped tools are never offered). |

```ts
import { createSandbox } from "@jeswr/agent-sandbox";

const sandbox = createSandbox({
  tools,                      // ToolSpec[]: system, action, context(args), run(args)
  rules: () => ({ mandate, currency: "GBP" }),
  directory,                  // names for IRIs, and group membership
  agent: "https://example.org/agents/assist#me",
  purpose: "https://w3id.org/dpv#CustomerCare",
  mode: "policy",
});
const result = await sandbox.call({ tool: "email_send", args: { to: ["x@example.org"] } });
```

## MCP lockdown proxy

```sh
pnpm --filter @jeswr/agent-sandbox build
node packages/agent-sandbox/dist/mcp/cli.js --story injected-refund --mode policy
```

This runs a stdio MCP server for the demo world. Add it to Claude Desktop or Claude Code as an
MCP server; each decision is printed to stderr.

## Known gaps

- Limits are daily windows held by the sandbox. ODRL has no standard rate term, so the
  mandate's `limits` use the agent-mandate profile.
- `solid-odrl` does not yet evaluate `odrl:and`/`odrl:or` constraint groups, so policies here
  avoid them.
- The onward check covers calls with recipients (messages, uploads, posts). Writes back into
  the organisation's own systems (a ticket update, a database change) and payments are not
  checked against the labels the session carries.
- Tools wrapped from another MCP server with `upstreamTools` return unlabelled content, so
  nothing they read constrains later sends.
- Calls are decided one at a time per sandbox, so limits hold under concurrent calls; the
  record is in memory and not signed, so it shows tampering only to someone holding an
  independent copy of the fingerprints.
- Duties are reported as `obligations()` but not enforced or tracked to completion.
- The demo uses unsigned mandates; production use goes through `agent-mandate`'s signed
  credential and verifier.

The demo app is [`apps/idea-sandbox`](../../apps/idea-sandbox).
