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

Choose one plugin; each declares exactly one server:

- `solid-pod` uses only `SOLID_MCP_URL`, the HTTPS `/mcp` URL of an operator's
  OAuth-enabled `apps/mcp-server` deployment. Remote MCP access needs no local
  `SOLID_MCP_*` settings. This plugin also includes the capture hooks below.
- `solid-pod-local` runs `npx -y @jeswr/solid-mcp` over stdio and has no hooks.
  Install it with `/plugin install solid-pod-local@solid-suite`. It forwards only
  `SOLID_MCP_POD_ROOT` and `SOLID_MCP_READONLY` (using `${SOLID_MCP_READONLY:-true}`).
  Set the pod root in the launching shell. Every other setting comes from
  `~/.config/solid-mcp/config.json`, a regular, non-symlink file with exactly mode
  **0600**, as documented in the solid-mcp README. Put `webId`, `clientId`,
  `clientSecret`, and `oidcIssuer` or `tokenUrl` there; issuer discovery does not
  need a token-endpoint override. Leave unused optional fields absent. Existing
  CLI environment overrides still apply if inherited by the process. The plugin's
  read-only default overrides a file's `readOnly: false`; set
  `SOLID_MCP_READONLY=false` explicitly to enable server writes.

The local MCP command requires a future npm distribution. For a local checkout,
replace its command/args with the absolute built CLI paths documented by solid-mcp.
Configure the chosen server before enabling it. An incomplete credential group
fails closed. Declaring the marketplace does not publish either package.

`SessionEnd` and `PreCompact` run `solid-capture claude`. A local installation with
`solid-capture` on PATH is the recommended command. `@jeswr/agent-session-capture`
is private today and is not on npm: capture hooks are inert without a local install.
The alternative `npx -y @jeswr/agent-session-capture claude` remains inert until
that package is published. Do not run it during preparation.
As documented by agent-session-capture, the command reads `transcript_path` and
`cwd` directly from hook stdin JSON. No shell path interpolation is used. Each hook
has a **30-second** timeout to allow startup overhead around capture's internal
10-second budget. If startup is killed before capture reads stdin and queues the
transcript, there is no queued snapshot to retry. Only snapshots already queued
by capture survive for replay.

Enabling capture authorizes owner-only transcript writes. Capture requires WebID,
complete CSS credentials, and explicit `SOLID_MCP_READONLY=false`. Its existing
redaction, project `.solid-capture-ignore`, private offline queue and idempotence
rules apply. Nothing in this skeleton changes those checks. Review the
agent-session-capture README before enabling either hook.
