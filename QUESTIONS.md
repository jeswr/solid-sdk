<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-03 interpretation questions

1. **MCP configuration keys** (connectors DESIGN §2 D7; MCP DESIGN §5 / MCP-12):
   MCP-12 specifies the path and mode, but neither its spec nor this base defines a JSON
   schema. Options: camelCase keys matching the existing MCP configuration API, or
   environment-variable names as JSON keys. Use camelCase: `podRoot`, `webId`,
   `oidcIssuer`, `clientId`, `clientSecret`, optional `tokenUrl`, `profileDocumentUrl`,
   and `readOnly`. Connector OAuth settings live under `connectors[id]`. Confirm with
   MCP-12 when its implementation lands; do not change MCP in this lane.
2. **`--since` and exit codes** (connectors DESIGN §2 D7): options are a boolean
   checkpoint-resume flag or a timestamp argument. The specified bare `--since` resumes
   the persisted cursor; omission requests a full import. File imports reject `--since`.
   Use 0 for success/help, 1 for import or state failure, 2 for usage/config/file errors,
   3 for login failure, and 130 for cancellation. No new timestamp-to-cursor contract.
3. **Owner-only state** (connectors DESIGN §2 D3): options are explicit WAC protection
   now or waiting for the later pod-access/storage integrations. Require a Pod-advertised
   ACL link, install an owner-only WAC ACL before reading/writing state, and fail closed
   when unavailable. ACP/LWS support remains outside CON-03, alongside CON-12.
