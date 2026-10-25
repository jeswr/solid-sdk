<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-vaj implementation questions

1. **Server factory signature (MCP DESIGN §2–3, §5; MCP-02 task).** The brief names
   `server` but does not specify its type. Options: an existing singleton, or a factory
   receiving the authenticated principal. Applied: a factory returning a fresh MCP SDK
   `McpServer` for every request. This satisfies principal isolation without coupling
   HTTP to a specific PodPort implementation. The supplied base still has the original
   fetch-backed server API; this lane does not implement the missing MCP-01 changes.
2. **Body cap and response mode (MCP DESIGN §5; MCP-02 task).** The task requires a
   body limit but gives no value or streaming requirement. Options: configurable limits
   and SSE, or a fixed small cap and SDK JSON responses. Applied: 1 MiB of actual UTF-8
   request bytes, stateless JSON responses, and 405 for persistent GET/DELETE streams.
   This is the SDK's simplest stateless request/response mode.
3. **Authority and browser requests (MCP DESIGN §5).** Options: trust forwarding headers
   and permit origin patterns, or match the public resource authority and exact origins.
   Applied: exact `resourceUrl` authority (including port), ignoring forwarding headers;
   absent Origin is allowed for native clients. A native Web Request can omit Host because
   its URL supplies authority; Node requests require Host. Browser preflights need no
   authentication and permit POST with a fixed header list. No wildcard CORS.
