// AUTHORED-BY Codex GPT-6.1-Sol
import { createServer } from "node:http";
import { appFromEnvironment } from "./config.js";
import { nodeHandler } from "./node-handler.js";

// Fail startup without exposing credentials in a stack trace.
try {
  const app = await appFromEnvironment();
  createServer((request, response) => void nodeHandler(request, response, app)).listen(
    Number(process.env.PORT ?? 3200),
    "127.0.0.1",
  );
} catch {
  process.stderr.write("MCP server configuration or initialization failed.\n");
  process.exitCode = 1;
}
