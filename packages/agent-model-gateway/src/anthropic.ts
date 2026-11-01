// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare builtin specifiers
import { mkdtemp, rm } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare builtin specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare builtin specifiers
import { join } from "path";
import { z } from "zod";
import type { Tool } from "./tools.js";
import { type Configuration, record, usageSchema } from "./transport.js";
import type { GatewayOptions, ModelCall } from "./types.js";

const assistant = z.object({
  id: z.string(),
  usage: usageSchema,
  content: z.array(z.object({ type: z.string(), id: z.string().optional() })),
});

export async function anthropicPropose(
  options: GatewayOptions,
  config: Configuration,
  prompt: string,
  instructions: string,
  tools: Tool[],
  calls: ModelCall[],
) {
  const now = options.now ?? Date.now;
  const start = now();
  const key = await options.tokens.read(config.account);
  if (!key || /\s/.test(key)) throw new Error("Invalid credential");
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  // An empty config home and cwd prevent ambient credentials, hooks and project prompts.
  const directory = await mkdtemp(join(tmpdir(), "agent-gateway-"));
  try {
    const server = sdk.createSdkMcpServer({
      name: "gateway",
      tools: tools.map((tool) =>
        sdk.tool(tool.name, tool.description, tool.schema.shape, async (input) => ({
          content: [{ type: "text" as const, text: JSON.stringify(await tool.run(input)) }],
        })),
      ),
    });
    const names = tools.map((tool) => `mcp__gateway__${tool.name}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let succeeded = false;
    let retries = 0;
    let callStart = start;
    const seen = new Map<string, { index: number; tools: Set<string>; start: number }>();
    try {
      for await (const event of sdk.query({
        prompt,
        options: {
          model: config.model,
          systemPrompt: instructions,
          tools: [],
          allowedTools: names,
          permissionMode: "dontAsk",
          settingSources: [],
          strictMcpConfig: true,
          persistSession: false,
          cwd: directory,
          mcpServers: { gateway: server },
          maxTurns: config.maxTurns,
          abortController: controller,
          env: {
            PATH: process.env.PATH,
            HOME: directory,
            CLAUDE_CONFIG_DIR: directory,
            ANTHROPIC_API_KEY: key,
            ANTHROPIC_BASE_URL: config.origin,
            CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(config.maxTokens),
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
            DISABLE_AUTOUPDATER: "1",
            DISABLE_TELEMETRY: "1",
            DISABLE_ERROR_REPORTING: "1",
          },
          async canUseTool(name, input) {
            const tool = tools.find((tool) => name === `mcp__gateway__${tool.name}`);
            return tool?.schema.safeParse(input).success
              ? { behavior: "allow", updatedInput: input }
              : { behavior: "deny", message: "Tool is not allowed" };
          },
        },
      })) {
        if (event.type === "system" && event.subtype === "api_retry") retries++;
        if (event.type === "assistant") {
          if (event.error) throw new Error("Provider failed");
          const message = assistant.parse(event.message);
          let entry = seen.get(message.id);
          if (!entry) {
            entry = { index: calls.length, tools: new Set(), start: callStart };
            seen.set(message.id, entry);
            calls.push(record(config, "proposer", message.usage, 0, now() - callStart, retries));
            callStart = now();
            retries = 0;
          }
          for (const block of message.content)
            if (block.type === "tool_use") entry.tools.add(z.string().parse(block.id));
          const previous = calls[entry.index] as ModelCall;
          calls[entry.index] = {
            ...previous,
            tokens: { input: message.usage.input_tokens, output: message.usage.output_tokens },
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            toolCalls: entry.tools.size,
            latencyMs: Math.max(0, now() - entry.start),
          };
        }
        if (event.type === "result") {
          if (event.subtype !== "success" || event.is_error) throw new Error("Provider failed");
          succeeded = true;
        }
      }
      if (!succeeded || seen.size === 0 || controller.signal.aborted)
        throw new Error("Incomplete provider run");
    } catch (error) {
      if (seen.size === 0 || retries > 0)
        calls.push(
          record(
            config,
            "proposer",
            { input_tokens: 0, output_tokens: 0 },
            0,
            now() - callStart,
            retries,
          ),
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
