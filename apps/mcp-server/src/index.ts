// AUTHORED-BY Codex GPT-6.1-Sol
import { createServer } from "node:http";
import { handler } from "./handler.js";

// A loopback-only development entry point. MCP-11 supplies the transport composition.
const server = createServer(async (request, response) => {
  try {
    const result = await handler(new Request(new URL(request.url ?? "/", "http://localhost")));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(new Uint8Array(await result.arrayBuffer()));
  } catch {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end("Internal server error\n");
  }
});
server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1");
