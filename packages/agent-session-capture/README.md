<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-session-capture

> Experimental — AI-agent-generated. Private Node >=24 ESM package; review before enabling hooks.

`solid-capture` copies Claude Code and Codex CLI sessions and imports ChatGPT and
Claude.ai exports to owner-only AS2 chat history in a Solid pod. It reuses
MCP-08's ChatWriter and MCP-12's CSS
client-credentials configuration and DPoP login. Nothing is published or enabled
by building this package.

## Build and configure

From the workspace root:

```sh
pnpm exec turbo run build --filter=@jeswr/agent-session-capture
```

Use the same environment variables or `~/.config/solid-mcp/config.json` as
[`@jeswr/solid-mcp`](../solid-mcp/README.md#authenticated-stdio-cli). An existing
config must be a regular **0600** file, even with environment overrides. Capture
requires `podRoot`, `webId`, `clientId`, `clientSecret`, an `oidcIssuer` or `tokenUrl`,
and explicit `readOnly: false` (`SOLID_MCP_READONLY=false`). Missing, invalid,
read-only or anonymous configuration disables capture; no anonymous fallback.
The default HTTP transport uses the DNS-pinned guarded-fetch Node adapter;
loopback is allowed only when explicitly present in operator configuration.
Tokens and DPoP keys stay in process memory.

## Commands and hooks

When the bin is available on PATH:

```sh
solid-capture claude --transcript /absolute/path/to/session.jsonl
solid-capture codex --since 2026-10-25T00:00:00Z
```

`claude` also accepts hook stdin JSON containing `transcript_path` and optional
`cwd`, so shell interpolation of a transcript path is unnecessary. For a local
checkout, configure Claude Code's `SessionEnd` and `PreCompact` command hooks:

```json
{
  "hooks": {
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "timeout": 15,
        "command": "/absolute/path/to/node /absolute/path/to/solid-sdk/packages/agent-session-capture/dist/cli.js claude"
      }]
    }],
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "timeout": 15,
        "command": "/absolute/path/to/node /absolute/path/to/solid-sdk/packages/agent-session-capture/dist/cli.js claude"
      }]
    }]
  }
}
```

The 15-second hook timeouts leave room for process startup around capture's
10-second budget.

`codex` reads `~/.codex/sessions/**/rollout-*.jsonl`. `--since` keeps messages
strictly newer than a timestamp with an explicit timezone. Without `--since`, all
available messages are eligible within the budget. It also accepts the JSON
argument appended by Codex `notify`, selecting that `thread-id` and checking its
`cwd`. In `~/.codex/config.toml`:

```toml
notify = ["/absolute/path/to/node", "/absolute/path/to/solid-sdk/packages/agent-session-capture/dist/cli.js", "codex"]
```

Both commands are silent and always exit **0**, including invalid arguments,
missing files, import failures, unavailable auth and network errors. A CLI watchdog
starts before SDK loading; processing and requests share a **10-second** budget.
A timeout aborts outstanding requests and preserves queued snapshots. Repeated
runs use stable opaque conversation/message IDs and ChatWriter's
`If-None-Match: *` writes, so partial uploads and retries do not duplicate messages.
ChatWriter writes owner-only WAC ACLs before content and refuses unsupported ACL
discovery or redirects.

## Export imports (MCP-16)

With the same writable MCP configuration:

```sh
solid-capture chatgpt-export /path/to/export.zip
solid-capture chatgpt-export /path/to/conversations.json
solid-capture claude-export /path/to/conversations.json
```

ChatGPT accepts the export array or a `{ "conversations": [...] }` wrapper.
All user/assistant mapping branches are retained in timestamp order, matching the
Pod Manager importer. Claude.ai accepts conversation arrays with `chat_messages`,
using text blocks or the legacy `text` field. Both drop system/tool messages,
images, attachments, tool arguments/results and thinking. Titles and message text
are redacted before upload. Missing/invalid message dates use the conversation's
creation date, then the Unix epoch; no current-time fallback changes retry IDs.

Imports use the `chatgpt` and `claude` ChatWriter providers with opaque IDs scoped
separately from coding-agent hooks. Source IDs and filenames never become pod paths.
Stable message IDs and private local sequence assignments preserve idempotence and
timestamp-tie order across retries, including exports that remove earlier messages.
Exports lacking source IDs use deterministic content/position fallbacks; modified
exports without IDs may be treated as new conversations or messages.

Inputs must be regular, non-symlink UTF-8 files of at most **16 MiB**. JSON is
limited to **10,000 conversations**, **100,000 source message nodes** in total,
and **10,000 content parts** per message. Oversized inputs fail instead of being
silently truncated. ZIPs also have a 16 MiB archive limit and independently capped
16 MiB decompression. Only single-disk stored/deflated ZIPs with one root
`conversations.json` are supported; unrelated entries are not decompressed.
Encrypted/ZIP64 archives, symlinks, unsafe entry paths, duplicate JSON entries and
CRC/header mismatches are refused. Nothing is extracted to disk.

An import checks `.solid-capture-ignore` in the invoking directory and export's
parent chains, including real paths, and rechecks before saving each conversation.
It writes owner-only ACLs before AS2 content with the shared DPoP transport.
Imports exit **0** on success or **1** with a fixed, content-free diagnostic on
failure. They run outside the hook watchdog and do not queue export snapshots;
after an interrupted/failed upload, re-run the same export to complete it safely.
The library accepts an `AbortSignal` to cancel file reads and requests.

## Content and opt-out

Capture retains user/assistant text and tool names. Claude Code `tool_result`,
Codex tool outputs, tool arguments, images, thinking/reasoning and progress are
dropped. Codex `event_msg` mirrors are dropped in favor of `response_item` records.
Malformed/incomplete JSONL rows and messages without valid timestamps are skipped;
transcripts containing conflicting session IDs are refused. Files must be regular,
non-symlink files of at most **16 MiB**. Hook input is limited to **64 KiB**.

Before queueing or uploading, text is redacted for private-key PEM blocks (including
unfinished blocks), `sk-` and GitHub tokens, AWS access-key IDs, JWTs,
`Authorization:`/`Proxy-Authorization:` lines, and shell/.env assignments including
multiline quoted values. Queue replay redacts again. Source IDs are hashed; titles
are fixed provider labels. Pattern redaction does not identify every possible
secret format, so use project opt-out for sensitive work.

Create an empty `.solid-capture-ignore` in a project or any parent directory to
opt out. This is a **presence marker**, not a glob-pattern file. Capture checks the
invoking cwd, hook/notify cwd, and transcript project directories, including real
symlink targets and their parents. Missing/unreadable or non-absolute project
metadata fails closed. Replay rechecks project opt-out and discards snapshots
whose projects have opted out. A hook invoked inside an ignored project performs
no capture or replay.

## Offline queue

Redacted snapshots are atomically queued **before** network I/O in
`~/.local/state/solid-capture/queue/` (0700 directories, 0600 files). No auth
credentials or raw transcript records are queued. Local project paths are retained
only to recheck opt-out; they are never included in uploaded conversations.
Snapshots are bound to the configured pod root **and** owner WebID, so changing
accounts cannot replay old data to a different pod or owner.

Codex retries queued snapshots before scanning rollouts, including when no
new rollout exists. Claude queues its current transcript before network I/O so
PreCompact can safely replace the source, then retries older snapshots. New snapshots
are queued and uploaded one at a time, so a long scan cannot prevent upload progress.
Each message is saved independently. Atomic private `.progress-*` checkpoints retain
only opaque message IDs, scoped to the pod root, owner and conversation. Retries skip
acknowledged messages even when a transcript grows or the timestamp filter changes;
completed Codex rollouts require no further upload requests. A save interrupted before
its checkpoint is recorded may be retried with the same create-only ID.
Private `.sequence-*` files retain opaque source hashes and their assigned sequence
positions before snapshots are queued. Transcript trimming preserves existing uploaded
IDs and checkpoint matches; sequence prefixes retain source order on timestamp ties.
Successful snapshots are removed; checkpoints and sequence assignments remain. Failed
or partial uploads, corrupt entries and unsafe files remain local. Delete unwanted
snapshots manually, or remove the queue to clear all pending captures, completion
checkpoints and sequence assignments. Config and opt-out checks still apply before replay.

## Library and tests

The root exports `runCapture(args, options?)`, `parseClaudeTranscript(jsonl, source?)`,
`parseCodexTranscript(jsonl, source?)`, `redactSecrets(text)`, and their public types.
It also exports `runExportImport(args, options?)`, `parseChatgptExport(json)`, and
`parseClaudeExport(json)`. Export parsers return redacted `ChatConversation[]`
and throw on malformed top-level JSON or exceeded limits; the import runner
returns `0 | 1` and suppresses error details.
Parser results include redacted `ChatConversation` values and local-only project
locations. `runCapture` accepts injected home/cwd/env/stdin/HTTP transport and a
shorter budget for embedding or tests; it always resolves to `0`.
`./testing` exports an in-memory HTTP pod/token transport with versioned strong ETags
and conditional create/update checks, plus a ZIP fixture builder.

```sh
pnpm --filter @jeswr/agent-session-capture test
```

Tests use reduced, redacted JSONL/export shape fixtures and the real ChatWriter and DPoP
code over fixture HTTP. Coverage thresholds remain 100% for statements, branches,
functions and lines, including privacy boundaries and CLI exit behavior.
