<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# ChatGPT preparation descriptor

`app.json` is **our own descriptor, not an OpenAI schema or submission format**.
It records the intended display metadata, operator-hosted Streamable HTTP endpoint,
OAuth DCR + mandatory PKCE S256, and actual server tools with read-only flags.
`solid_write` is the write alias of `pod_write`. `memory_recall`, `address_get` and
`health_query` can append a private audit entry, so they are not marked read-only and
ChatGPT asks before running them.

Replace `{host}` and the deliberately invalid privacy-policy placeholder only after
Jesse supplies them. Use the remote OAuth mode of `apps/mcp-server`, not its
single-user bearer-token mode. Pod credentials stay on the server; MCP client
tokens are never pod credentials. Personal reads retain purpose checks and default
health denial. Write tools require explicit enablement and owner authorization.

See SUBMISSION.md for later manual work. No connector has been set up, and nothing
has been submitted, uploaded, published or approved. Client UI labels, developer
mode eligibility and submission requirements must be checked against current
official OpenAI documentation at the time; this offline preparation does not
assert current availability or acceptance.
