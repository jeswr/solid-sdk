<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# CHT-00 questions

1. **Append-only participants and own-message edits** — 07-parity-backlog.md, Chat data mapping and CHT-01: members receive Read+Append on a shared day resource, while editing/deleting requires replacing existing statements. Options: retain Append-only grants and propagate permission failures; grant Write to members (also permits rewriting other authors); introduce a server-mediated ownership policy. Conservative implementation: retain Read+Append, use insert-only PATCH to post with If-Match, enforce own-author checks locally for edit/delete, and propagate server denial without changing grants. The later hook layer must present that denial; the model's author check is not a server security boundary.

2. **Day boundaries and paging** — 07-parity-backlog.md, Chat data mapping specifies yyyy/mm/dd.ttl but no timezone or stopping rule. Options: UTC vs viewer/room timezone; date cursor vs container traversal. Conservative implementation: UTC day keys, caller-supplied inclusive before/since bounds and a bounded day budget (1–366), with empty days consuming budget. The returned cursor is the next unscanned day. No background scan or implicit retention window.
