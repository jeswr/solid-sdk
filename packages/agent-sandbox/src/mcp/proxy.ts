// AUTHORED-BY Claude Opus 5.5
// The MCP lockdown adapter. An MCP client (Claude Desktop, Claude Code, any agent) connects to
// this server instead of to the systems themselves. It lists ONLY the tools the rules allow,
// and every call goes through the gate. `upstreamTools` wraps a real MCP server's tools the same
// way: each upstream tool must be described (which system, which action, what kind of effect);
// an undescribed tool is never offered, because the gate cannot reason about it.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Sandbox } from "../gate.js";
import { resultText } from "../runners/agent.js";
import type { Args, CallContext, InputSchema, Json, ToolKind, ToolSpec } from "../types.js";

/** Build an MCP server that exposes a sandbox's tools. */
export function createMcpProxy(
  sandbox: Sandbox,
  info = { name: "agent-sandbox", version: "0.1.0" },
): Server {
  const server = new Server(info, {
    // No listChanged: the list is computed per request, and every call is gated regardless.
    capabilities: { tools: {} },
    instructions:
      "Every tool call is checked against the organisation's rules before it runs. A call may be stopped, held for a person's approval, or return with records withheld.",
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: sandbox.tools().map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema as unknown as { type: "object"; [k: string]: unknown },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Args;
    const result = await sandbox.call({ tool: request.params.name, args });
    return {
      content: [{ type: "text" as const, text: resultText(result) }],
      isError: result.status === "stopped" || result.status === "failed",
      structuredContent: { status: result.status, entry: result.entry },
    };
  });
  return server;
}

/** How the gate should understand one upstream MCP tool. */
export interface UpstreamToolPolicy {
  /** The system IRI the tool acts on. */
  readonly system: string;
  /** The ODRL (or agent-profile) action it performs. */
  readonly action: string;
  readonly kind: ToolKind;
  readonly title?: string;
  /** Derive the trusted context (recipients, amount, region) from the arguments. */
  context?(args: Args): CallContext;
}

/** An upstream tool the gate cannot use, and why. */
export interface UnmappedTool {
  readonly name: string;
  readonly reason: string;
}

/**
 * Wrap a connected upstream MCP client's tools as sandbox tools. Tools without a policy entry
 * are returned in `unmapped` and never offered.
 */
export async function upstreamTools(
  client: Client,
  policies: Readonly<Record<string, UpstreamToolPolicy>>,
): Promise<{ tools: ToolSpec[]; unmapped: UnmappedTool[] }> {
  const listed = await client.listTools();
  const tools: ToolSpec[] = [];
  const unmapped: UnmappedTool[] = [];
  for (const t of listed.tools) {
    const policy = policies[t.name];
    if (!policy) {
      unmapped.push({
        name: t.name,
        reason: "No description of what this tool does, so it is never offered.",
      });
      continue;
    }
    tools.push({
      name: t.name,
      title: policy.title ?? t.title ?? t.name,
      description: t.description ?? t.name,
      system: policy.system,
      action: policy.action,
      kind: policy.kind,
      inputSchema: t.inputSchema as unknown as InputSchema,
      ...(policy.context && { context: policy.context }),
      async run(args) {
        const out = await client.callTool({
          name: t.name,
          arguments: args as Record<string, unknown>,
        });
        if (out.isError)
          throw new Error(textOf(out.content) || "the upstream tool reported an error");
        return { content: (out.structuredContent as Json | undefined) ?? textOf(out.content) };
      },
    });
  }
  return { tools, unmapped };
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (c): c is { type: "text"; text: string } =>
        typeof c === "object" && c !== null && c.type === "text",
    )
    .map((c) => c.text)
    .join("\n");
}
