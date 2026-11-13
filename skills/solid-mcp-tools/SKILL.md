---
name: solid-mcp-tools
description: Use when connecting Claude, ChatGPT, Codex or another MCP client to a Solid pod through the suite's MCP server, choosing which pod tool to call, passing a purpose to personal-data tools, recording memories with the right epistemic status, or setting up conversation capture and the chat archive. For changing the server itself, read packages/solid-mcp/SKILL.md instead.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Using the Solid pod MCP tools

The suite exposes a person's pod to AI assistants through one MCP server,
[`@jeswr/solid-mcp`](../../packages/solid-mcp/README.md). This skill is for agents and
integrators who *use* it. Implementation rules live in the package skill.

## Quick reference

- Remote assistants (Claude custom connectors, ChatGPT developer-mode apps) connect to
  [`apps/mcp-server`](../../apps/mcp-server/README.md) over OAuth. Local clients (Claude
  Desktop, Claude Code, Codex) run the stdio CLI `packages/solid-mcp/dist/cli.js`.
- Everything is **read-only by default**. Writes need `readOnly: false` (`MCP_READ_ONLY=false`
  remotely, `SOLID_MCP_READONLY=false` locally).
- Generic tools never reach personal data. Memory, profile, address, health, chats and the
  shared context each have their own purpose-limited tool.
- Personal tools need `purpose`: `ServiceProvision` (doing what the person asked) or
  `Personalisation` (tailoring). The owner's policy decides; health and finance are denied
  by default.
- Sensitive reads are audited in the pod before the result is returned. A read-only server
  cannot audit, so it withholds them.

## Connecting

**Remote (OAuth).** The assistant discovers the server from the 401 challenge on `/mcp`,
registers (Client ID Metadata Document or dynamic registration), and sends the person
through Solid-OIDC login and an explicit consent page. MCP bearer tokens are never pod
credentials, and the person's pod session stays on the server.

**Local (stdio).** Create `~/.config/solid-mcp/config.json` with mode exactly `0600`
(`podRoot`, `webId`, `readOnly`, `oidcIssuer` or `tokenUrl`, and a CSS client-credentials
`clientId`/`clientSecret`), or set the `SOLID_MCP_*` environment variables. Then point the
client at the CLI; the package README has copyable Claude Desktop, Claude Code and Codex
entries. Stdout carries only MCP messages; diagnostics go to stderr.

## Tool catalogue

| Need | Tool | Notes |
| --- | --- | --- |
| Find something | `search` | `{query}` → `{results:[{id,title,url}]}`; Type Index and listings, bounded |
| Read one resource | `fetch` | `{id}` (pod URL) → text or Turtle, capped at 1 MiB |
| Browse | `pod_list` | One container |
| Read raw | `pod_read` | Any non-personal resource |
| Write | `pod_write` | Needs a writable server; keep the ETag from a read and pass it back |
| Shared context | `context_read` | No arguments; the owner's shared context card, with card numbers redacted |
| Remember | `memory_remember` | See epistemic rules below |
| Recall | `memory_recall` | `{purpose, query?, about?, categories?, include?, limit?}` |
| Forget | `memory_forget` | `{id, mode: "retract" \| "delete"}`; delete only what this client wrote |
| Contact details | `profile_get` | `{purpose}` → name, emails, phones |
| Addresses | `address_get` | `{purpose, at?}`; `at` is an ISO date or zoned datetime |
| Health | `health_query` | `{kind, purpose}`; kinds `conditions`, `allergies`, `medications`, `observations` |
| Archive a chat | `chat_save` | Writable server; see below |
| Chats | `chat_list`, `chat_get`, `chat_export` | `chat_export` gives a redacted Markdown transcript to paste elsewhere |

`solid_list`, `solid_read`, `solid_search` and `solid_write` are v0.2 aliases. Prefer the
canonical names.

Each tool's `readOnlyHint` annotation says whether calling it can change the pod. Expect
any permitted sensitive read (recall, address or health) to append an audit record, even
though it returns data rather than storing it.

## Purposes and denials

Pass the narrowest true purpose. A denial names only the category (for example health),
never values; do not retry with a different purpose to get around it. Tell the person what
was denied and that they can change it in their pod's policy. Recall and personal reads
never create a missing policy: until the first memory write creates the default one, they
fail closed.

## Memory epistemic rules

`memory_remember({text, fact?, quote?, hedged?, about?, conversationId?})` returns
`{id, epistemic}`.

- Quote the person's own words in `quote` only when they actually said them. A quoted,
  unhedged fact is stored as `SelfReportedExplicit`.
- Set `hedged: true` when they were unsure ("I think I'm allergic to…"). Hedging wins:
  `SelfReportedHedged`.
- Anything you worked out yourself is `Inferred`. Never present an inference as a quote.
- Use a typed `fact` (email, phone, address, preference, condition, allergy, medication,
  relationship) when one fits. Free `text` without a fact becomes an uncategorised
  `Mentioned` note, and purpose-filtered recall will not return it.
- `about` defaults to the owner. Facts about other people stay attributed to the owner as
  claims.

Recall defaults to definitely-true, current facts. Add `include: ["might", "mentioned",
"past"]` only when the task needs them, and say so when you rely on them. Correct a wrong
memory with `memory_forget` mode `retract` (keeps history), not by writing a contradicting
fact.

## Chat archive and capture

`chat_save({provider, conversationId, account?, title, messages})` stores an owner-only AS2
conversation under `private/chats/<provider>/<id>/`. Providers are `claude`, `chatgpt`,
`codex`. Send source message IDs when you have them: ID-less messages are named by a hash of
role, text and time, so identical events collapse. Titles and text are redacted before
storage. `account` is an owner-chosen label such as `Work`, never an email address. To append
to a stored conversation, resend the same source ID and account; use the stored ID from
`chat_list` only for `chat_get` and `chat_export`.

Automatic capture uses [`@jeswr/agent-session-capture`](../../packages/agent-session-capture/README.md)
with the same private config and `readOnly: false`:

- Claude Code: `SessionEnd` and `PreCompact` command hooks running `solid-capture claude`.
- Codex: `notify = [node, …/agent-session-capture/dist/cli.js, "codex"]`.
- Exports: `solid-capture chatgpt-export <zip|json>` and `solid-capture claude-export <json>`.

Hooks are silent and exit 0 within a 10-second budget; failed uploads queue privately and
replay later. An empty `.solid-capture-ignore` in a project opts it out.

## Do not

- Do not read `private/pkg/`, `agent/context/`, `agent/memory/`, `agent/accounts/` or the
  in-pod profile through generic tools; they are refused by design.
- Do not put secrets, card numbers or email addresses into titles, account labels or memory
  text.
- Do not enable writes or publish connector packaging on someone's behalf without their say.
