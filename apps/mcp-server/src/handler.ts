// AUTHORED-BY Codex GPT-6.1-Sol
/** Web handler seam for MCP-11 composition; no MCP transport is enabled yet. */
export async function handler(_request: Request): Promise<Response> {
  return new Response("MCP server scaffold: transport is not implemented.\n", {
    status: 501,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
