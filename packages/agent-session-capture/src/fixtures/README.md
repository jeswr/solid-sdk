<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Reduced, redacted JSONL samples shaped like Claude Code transcripts and Codex CLI
rollouts. All IDs, paths, versions and text are fixture placeholders; no accounts,
credentials or private session content are recorded here. `DROP_*` sentinels identify
fields that must never reach the pod or offline queue. The samples preserve nesting,
timestamps, content block types, tool call/result separation, and Codex's duplicate
`event_msg`/`response_item` representations.

`chatgpt-export.json` and `claude-export.json` are reduced provider export shapes
for MCP-16. They contain fixture conversation/message IDs, timestamps, textual
turns and dropped-content sentinels. Tests generate ZIPs in memory from these
samples, including malformed archive cases; no binary archives are checked in.
