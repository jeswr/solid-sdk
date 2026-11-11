<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Solid suite Claude Code marketplace (prepared only)

Ready to copy into `jeswr/solid-suite-marketplace` after Jesse creates that repo.
The repo, marketplace and packages have **not** been published by this work.
No plugin is installed or enabled. Inspect the files before enabling hooks.

For an explicit local installation later, copy this directory and use its absolute path:

```text
/plugin marketplace add /absolute/path/to/claude-plugin
/plugin install solid-pod@solid-suite
```

After Jesse creates and populates the repository, the intended remote commands are:

```text
/plugin marketplace add jeswr/solid-suite-marketplace
/plugin install solid-pod@solid-suite
```

The plugin declares two servers. `solid-pod` uses `SOLID_MCP_URL`, the HTTPS `/mcp`
URL of an operator's OAuth-enabled `apps/mcp-server` deployment. `solid-pod-local`
runs `npx -y @jeswr/solid-mcp` with the CLI's seven `SOLID_MCP_*` variables forwarded
from the launching shell. These package commands require a future distribution;
the private `@jeswr/agent-session-capture` package is not currently installable from
npm. A local checkout can instead use the absolute built CLI paths documented by
each package. Declaring the marketplace does not publish either package.

Configure the chosen server before enabling it. Keep writes disabled by default.
Claude variable expansion can reject missing variables or pass empty strings;
the CLI deliberately rejects empty settings. If optional auth/WebID/token-endpoint
variables are unset, remove those optional env entries from your copied local
configuration and use the private 0600 config file. Do not fill them with dummy
credentials. An incomplete credential group fails closed.

`SessionEnd` and `PreCompact` run `npx -y @jeswr/agent-session-capture claude`.
As documented by agent-session-capture, the command reads `transcript_path` and
`cwd` directly from hook stdin JSON. No shell path interpolation is used. Each hook
has the requested **10-second** timeout; the package README recommends 15 seconds
to allow startup overhead around its internal 10-second budget, so a slow startup
may be interrupted and leave a queued snapshot for retry.

Enabling capture authorizes owner-only transcript writes. Capture requires WebID,
complete CSS credentials, and explicit `SOLID_MCP_READONLY=false`. Its existing
redaction, project `.solid-capture-ignore`, private offline queue and idempotence
rules apply. Nothing in this skeleton changes those checks. Review the
agent-session-capture README before enabling either hook.
