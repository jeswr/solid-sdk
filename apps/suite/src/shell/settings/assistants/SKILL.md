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
visual specs. Record/revoke UI is outside S1. Mention token rotation for single-user servers.
