/**
 * The action catalogue as an MCP server (operator interface, stdio): list, describe, prepare and
 * execute. Execution needs a preparation token from this same server process.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActionsEnv } from "./env.js";
import type { ActionRegistry } from "./registry.js";
import type { ActionContext } from "./types.js";

const MAX_RESULT_CHARS = 200_000;

const reply = (value: unknown) => {
  const text = JSON.stringify(value, null, 2);
  return text.length > MAX_RESULT_CHARS
    ? { isError: true, content: [{ type: "text" as const, text: "result too large" }] }
    : {
        content: [{ type: "text" as const, text }],
        structuredContent: value as Record<string, unknown>,
      };
};

export function createActionsMcpServer(
  registry: ActionRegistry<ActionsEnv>,
  context: () => ActionContext<ActionsEnv>,
): McpServer {
  const server = new McpServer(
    { name: "awp-personal-actions", version: "1" },
    {
      capabilities: { tools: {} },
      instructions:
        "Deterministic personal-agent actions (no model involved). list_actions/describe_action to discover; " +
        "prepare_action to compute, plan or render (never an external effect); execute_action with a preparation " +
        "token only for local-write actions. Owner permissions come from the dashboard settings, never from inputs.",
    },
  );
  server.registerTool(
    "list_actions",
    {
      title: "List actions",
      description: "The action catalogue with schemas and examples.",
      annotations: { readOnlyHint: true },
    },
    async () => reply({ actions: registry.describe(context()) }),
  );
  server.registerTool(
    "describe_action",
    {
      title: "Describe one action",
      description: "Schemas, effect, capabilities and limitations of one action.",
      inputSchema: { id: z.string().max(80) },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const d = registry.describe(context()).find((x) => x.id === id);
      return d
        ? reply(d)
        : { isError: true, content: [{ type: "text" as const, text: "unknown action" }] };
    },
  );
  server.registerTool(
    "prepare_action",
    {
      title: "Prepare (run) an action",
      description:
        "Validates the input, checks owner permissions and computes the result. Read and prepare actions have no effect; local-write actions return a single-use preparation token.",
      inputSchema: { id: z.string().max(80), input: z.record(z.string(), z.unknown()) },
    },
    async ({ id, input }) => reply(await registry.prepare(id, input, context())),
  );
  server.registerTool(
    "execute_action",
    {
      title: "Execute a prepared action",
      description:
        "Runs a prepared local-write action once, re-checking permissions. Nothing is sent to any provider.",
      inputSchema: { token: z.string().max(100) },
      annotations: { destructiveHint: false },
    },
    async ({ token }) => reply(await registry.execute(token, context())),
  );
  return server;
}
