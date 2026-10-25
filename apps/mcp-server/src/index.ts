// AUTHORED-BY Codex GPT-6.1-Sol
import { createServer } from "node:http";
import { nodeHandler } from "./node-handler.js";

// A loopback-only development entry point. MCP-11 supplies the transport composition.
createServer(nodeHandler).listen(Number(process.env.PORT ?? 3000), "127.0.0.1");
