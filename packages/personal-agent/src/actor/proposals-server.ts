import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PodFetch } from "../config.js";
import { putResource, throwIfNotWritten } from "../pod/write.js";
import { createGate, PROPOSAL_WRITE_TOOL } from "./gate.js";

/** The live write handler validates independently of SDK permission/pre-approval decisions. */
export function createProposalsServer(options: {
  proposalsContainer: string;
  readFetch: PodFetch;
  writeFetch: PodFetch;
}): McpServer {
  const gate = createGate({
    proposalsContainer: options.proposalsContainer,
    discoveryFetch: options.readFetch,
  });
  const server = new McpServer({ name: "proposals", version: "0.0.1" });
  server.registerTool(
    "solid_write",
    {
      description: "Write a validated proposal into the proposals container.",
      inputSchema: { url: z.string(), content: z.string(), contentType: z.string() },
    },
    async (input) => {
      try {
        const verdict = await gate(PROPOSAL_WRITE_TOOL, input);
        if (verdict.behavior === "deny") throw new Error(verdict.message);
        const { url, content, contentType } = verdict.updatedInput as typeof input;
        const response = await putResource(options.writeFetch, url, content, {
          contentType,
          base: options.proposalsContainer,
        });
        throwIfNotWritten(response, url);
        return { content: [{ type: "text", text: `wrote ${url}` }] };
      } catch {
        return { isError: true, content: [{ type: "text", text: "proposal write refused" }] };
      }
    },
  );
  return server;
}
