---
name: suite-assistants-settings
description: Use when maintaining Settings > Assistants setup instructions or its personal-data audit view.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

The assistant URL comes only from NEXT_PUBLIC_SUITE_MCP_URL via parseSuiteEnv; canonical HTTPS,
exactly /mcp, no userinfo/query/fragment. Unset or invalid runtime configuration shows setup
fallback text. Keep the maintainer-provided instructions in copy.ts verbatim.

Use suite Tabs, Input, CopyButton and shared async states with theme tokens. Read monthly audit
metadata through @jeswr/mcp-connections' AuditSource seam using the live account-bound PodSession.
Keep transport scoped, redirect-refusing, cancellable, time-bounded and byte-bounded. Invalidate
rows immediately on session changes; ignore late completions and clear on offline transitions.
Show 100 newest rows with client host, DPV labels and resource count, never raw resource URLs or
unknown RDF fields. Reconnect reloads, and errors offer Retry. Container 404 is empty.

Demo fixtures use typed accessors and n3.Writer, with a literal-value privacy regression fixture.
Test copy, tabs, configuration and all audit states; run the six viewport/theme functional and
visual specs. ConnectedAssistants lists <=100 direct 32-hex TTL records with concurrency 6 through the
owner session and generated parser. Report unreadable counts, sort active rows by last used,
and keep disconnected/expired entries under Previously connected. Label unverified app names
for opaque DCR client IDs. Disconnect uses AlertDialog, fresh GET + strong ETag and If-Match,
refetching/reapplying once on 412. Already revoked succeeds; all other failures show only
"Couldn't disconnect. Try again." Abort on account/offline transitions and ignore late replies.
Show matched connection names in audit rows without expanding its field whitelist. Browser,
shell-css and six-project visual specs include connected/disconnect states; never cache authority. Mention token rotation for single-user servers.
