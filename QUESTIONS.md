<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-4s8h conservative readings

1. DESIGN §2–4 and MCP-12 say MCP-01 is already merged, but base `917d3be9`
   contains the original `solid_list/read/search/write` server, without PodPort or
   the new registry. Options: rebuild MCP-01 here, or authenticate the existing
   server unchanged. Chosen: authenticate every existing tool through the shared
   fetch seam; leave registry changes to MCP-01 and the other tool lanes.
2. DESIGN §5 does not name JSON keys or precedence. Options: environment-only
   precedence, or file-only precedence. Chosen: flat camelCase keys matching the
   existing environment variables; environment overrides each file value. An
   existing file must always be a regular 0600 file, even with environment overrides.
3. DESIGN §5 does not specify anonymous behavior. Options: require credentials on
   every invocation, or retain public-pod support. Chosen: preserve anonymous mode
   only when no auth settings are supplied; partial credentials fail startup.
