---
name: agent-session-capture
description: Use when implementing or consuming @jeswr/agent-session-capture in the W9 MCP program.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-session-capture

Claude Code and Codex session capture into the pod (MCP-13), plus ChatGPT/Claude.ai
export imports (MCP-16). Read the planning
repository's `specs/mcp/DESIGN.md` §6 and the assigned task before changing behavior.
Keep the package private, ESM, Node >=24, and securityCritical. Document public
exports with TSDoc.

Use `runExportImport` for explicit `chatgpt-export <zip|json>` and
`claude-export <json>` commands. It returns 0/1 with no secret-bearing errors,
outside the hook watchdog. Reuse MCP config/auth, ChatWriter and private sequence
assignments; retries are create-only and no raw export snapshots are queued.
Redact titles and text.
Scope source IDs with the normalized account before redacting the label; keep
absent-account derivation byte-identical. Hooks pass channel `hook`, export parsers
pass `export`. Accept `account` via library options or the shared MCP config /
`SOLID_MCP_ACCOUNT`; validate with normalizeChatAccount and use redactChatAccount
before queueing. Bind queued entries, scans and checkpoints to an opaque account
scope as well as pod root/WebID. Never relabel old snapshots on account changes;
legacy unlabelled snapshots remain unlabelled hook captures.
Bound input bytes, conversation/message/part counts and ZIP decompression
independently; never extract archive paths to disk. Refuse
unsafe paths, links, encryption, ZIP64 and duplicate root conversations.json.

Use `runCapture` for the hook boundary; it is silent, always resolves to zero,
and caps its processing/request budget at ten seconds. The CLI starts an independent
watchdog before dynamic SDK loading. Keep stdout/stderr free of transcripts, paths,
remote bodies and credentials, including on startup/auth failures.

The JSONL parsers retain text and tool names only. Drop arguments, results, reasoning,
images and duplicate Codex event mirrors. Redact before queueing and again on replay.
Use the shared `redactConversation` from `@jeswr/solid-chat-interop` for title and
ordered messages; pass `{ chunks }` with one source-chunk array per message for exports.
The helper owns boundary checking, newline assembly, trimming and the final conversation
pass; do not duplicate field mapping or pre-redact chunks in the parser.
Run both before filtering or splitting saves. Retain source parts until the
boundary checks finish: redacting a partial token first can hide its prefix. Replay
checks the whole snapshot before one-message saves; export imports check before
100-message batches. Preserve existing redaction coverage when mapping boundary ranges.
Boundary checks preserve marker text and ignore empty spans; URL `@` context can
redact a password wholly on the left while that field is still inside userinfo; existing
userinfo authorities cannot absorb a later @mention. Undelimited host:port-looking
suffixes are ambiguous and redact when a following field supplies `@`, including
numeric password continuations. Delimited host:port URLs stay intact. Completed
quoted assignments keep their quotes at field boundaries and their IDs on replay.
Orphan private-key END
lines redact from their own field start, never a preceding field. Recognized BEGIN
headers carry redaction through arbitrarily long bodies and subsequent fields to
the first END or conversation end, including PGP PRIVATE KEY BLOCK. Other detectors
retain the pairwise/512-code-unit limit, as do split PEM delimiters themselves.
The shared normalizer strips lone surrogates and Cf except emoji ZWJs and valid
subdivision tags (two country letters, then 1–4 lowercase letters/digits). It also strips
variation selectors except FE0E/FE0F on emoji bases/modifiers or in complete keycaps;
follow the exact rule in [the chat skill](../solid-chat-interop/SKILL.md).
Keep opaque stable IDs and never use raw session IDs as paths. Reuse ChatWriter for
AS2, owner-only ACL-first writes and create-only idempotence. Reuse MCP-12's config
loader and DPoP fetch; do not duplicate auth or weaken config permissions/read-only
checks. The default HTTP transport is guarded-fetch/node with DNS pinning; explicit
operator loopback configuration is the only loopback allowance.

`.solid-capture-ignore` is a presence marker. Check invoking/hook/transcript project
locations and both lexical/real parent chains. Fail closed on unsafe paths or lookup
errors. Recheck opt-out before replay; never replay across pod-root or WebID changes.
Queue snapshots atomically in private directories/files; never queue auth credentials
or raw transcript rows. Preserve queued snapshots after incomplete uploads or deadline.
Queue the current Claude transcript before network I/O to preserve PreCompact data;
replay Codex's backlog before scanning rollouts so discovery cannot starve uploads.

The repo's agent-layer guard requires bare Node builtin imports (with the existing
Biome import-protocol suppression convention), literal module specifiers, and no
references to global fetch. Use the shared guarded transport and typed injected seams.

Use injected services and the reduced redacted JSONL fixtures; no real accounts or
credentials. Keep reusable fakes under `./testing`. Require 100% branch coverage for
implemented security paths. Run lint, dependency-first build, typecheck and tests
through pnpm before committing.
