<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# 0005 — Conversation archive and cross-account sync on the pod

Status: proposed (2026-11-02). Scope: use cases 1 and 2 of the MCP personal-data brief, in which Jesse
wants all his AI conversation history in his pod (1), synced across his accounts (2). Use cases 3 and 4
(shared context, personal knowledge graph) are in decision 0004.

The first slice (gaps 1 and 3 below) landed with this note: `ChatWriter` redacts every title and
message, and `solid-mcp` has a `chat_export` tool.

## Decision

One conversation is one owner-only pod container, `private/chats/<provider>/<opaque id>/`, written only
through `@jeswr/solid-chat-interop`'s `ChatWriter`. Every capture channel feeds that one writer:
coding-agent hooks, export imports and MCP `chat_save`. "Sync" means the pod is the single source of
truth. Every account, and every assistant connected to the MCP server, reads from it through the
`chat_*` tools. We don't write back into vendor accounts, which have no import API.

**Redaction fidelity is decided (sst-5ax.36; Jesse, 10 November 2026):** redact only secret
values, keep code lines, and err toward redaction. Keep assignment names, operators, quotes and
surrounding code; use `[REDACTED]` for values. Apply this to secret-looking assignment/key names,
CLI flags and query parameters, compact uppercase env assignments regardless of name, and URL
userinfo passwords. Preserve ordinary code such as `x = 1`, comparisons and keyword arguments.
Credential words match case-insensitive substrings, except `key` requires an underscore, hyphen,
dot or camelCase/acronym word part (`key_count` and `apiKey` redact; `monkey` and `keyboard` stay).
Keep existing token rules first, multiline/continued/unfinished-value handling and the redaction
fixpoint. The package README documents the word list and delimiters.

## What already exists (merged in PR #212)

| Need | Where | Notes |
| --- | --- | --- |
| Claude Code and Codex CLI sessions | `agent-session-capture` (`solid-capture claude`/`codex`, hooks) | Redacted; idempotent `If-None-Match: *` writes |
| ChatGPT and Claude.ai exports | `agent-session-capture` (`chatgpt-export`, `claude-export`) | ZIP/JSON, bounded, redacted, idempotent |
| MCP save/list/get | `solid-mcp` `chat_save`, `chat_list`, `chat_get` | Owner-only WAC ACL written before content |
| Storage model | `solid-chat-interop` `ChatWriter` (AS2 + typed RDF accessors) | Provider + opaque id → resource |
| Owner-only by default | ChatWriter ACLs; solid-mcp personal-data boundary | Not shared by default |

## Gaps

1. **Done in the first slice.** **Redaction is per channel, not per writer.** The capture CLI redacts, but MCP `chat_save` stores text
   verbatim. Move `redactSecrets` down into `solid-chat-interop` (its second user) and apply it in
   `ChatWriter` to titles and message text, so every channel redacts. Re-redaction is a fixpoint, so
   already-redacted input is unchanged and message ids stay stable. The original shell and `.env`
   rule destroyed code by replacing every assignment to end of line. **Decided and implemented in
   sst-5ax.36:** Jesse's 10 November 2026 value-only rule above preserves ordinary code while erring
   toward redaction of secret-looking names and compact uppercase env lines.
2. **No account provenance.** A conversation records its provider but not which account or channel it
   came from, or when it was imported. To sync across accounts, each conversation needs
   `prov:wasAttributedTo` an owner-chosen account label (never an email address in the path), plus
   `prov:generatedAtTime` and the source channel (`hook`, `export`, `mcp`). It also needs a merge rule: the
   same provider and source id from two accounts stays two resources, scoped by an opaque per-account
   salt.
3. **Done in the first slice (`chat_export`).** **No way to hand a conversation to another account.** Add `chat_get` output, or a `chat_export` tool,
   rendered as a Markdown transcript that a user or assistant can paste into another account to
   continue the conversation.
4. **Provider list is closed** (`claude`, `chatgpt`, `codex`). Add `gemini` and a generic `other` with a
   free-form label when an importer exists.
5. **chat tools need the fetch-based server configuration.** The storage-client PodPort path does not
   register them yet (see the solid-mcp README).
6. **Full-text search across archives** relies on generic search over titles. A bounded per-conversation
   index (title, first-message snippet, dates) would make `chat_list` filtering cheap.

## Known limits of the first slice

- Message IDs for ID-less input are now derived from the redacted text. A conversation saved through
  MCP `chat_save` before this change, without message IDs and with text a rule rewrites, gets a second,
  redacted copy of those messages on replay. Writes are create-only, so the old unredacted message and
  title stay in the pod (only `chat_export` re-redacts them). Bead sst-5ax.39 covers re-redacting or
  purging those legacy records. Capture paths always pass source IDs and are unaffected.
- Two ID-less messages with the same role and timestamp that differ only in a redacted secret derive
  the same ID, so the second is skipped as a replay.

## Security

Archives are treated as secrets. Containers are owner-only and never shared by default. Agents reach them
only through the purpose-limited MCP tools, never through generic `pod_read`. Credentials are redacted on
every write path (gap 1). Everything here is securityCritical and goes through the orchestrator's merge
gate.

## Beads

Filed under W9 (`sst-5ax`): sst-5ax.30 (gap 1), .31 (gap 2), .32 (gap 3), .33 (gap 4), .34 (gap 5)
and .35 (gap 6); sst-5ax.36 is decided (Jesse, 10 November 2026) and implements value-only
redaction with code preservation.
