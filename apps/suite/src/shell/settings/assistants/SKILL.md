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

Use mcp-connections' personalDataCategoryLabel for every audit category, and map the four
decision tokens to readable text. Format dates with Intl.DateTimeFormat in the viewer's
local timezone (do not force UTC). Only a /clients/ URL whose host equals the configured
MCP server host gets the registered-assistant label; otherwise show host and shortened path.
Never display query or fragment. Session Retry remounts PodSessionProvider to reopen it.
The transport consumes readBoundedText from guarded-fetch with a 256 KiB cap and abort
signal; retain fixed, cause-free errors. useOnline and dpvPurposeLabel live in shell/lib.
Share e2e/visual/baselines.ts with the component spec: screenshot 375-light and 1280-dark,
run axe for every viewport/theme. Keep read.ts and copy.ts at 100% coverage.
