// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare builtin specifiers
import { mkdtemp, rm } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare builtin specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare builtin specifiers
import { join } from "path";
import { z } from "zod";
import type { Tool } from "./tools.js";
import { type Configuration, record, type Usage, usageSchema } from "./transport.js";
import type { GatewayOptions, ModelCall } from "./types.js";

const assistant = z.object({
  id: z.string(),
  usage: usageSchema,
  content: z.array(
    z.object({
      type: z.string(),
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.unknown().optional(),
    }),
  ),
});

export async function anthropicPropose(
  options: GatewayOptions,
  config: Configuration,
  prompt: string,
  instructions: string,
  tools: Tool[],
  calls: ModelCall[],
  provenance: Map<string, string>,
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
        sdk.tool(tool.name, tool.description, tool.schema.shape, async (input) => {
          try {
            return {
              content: [{ type: "text" as const, text: JSON.stringify(await tool.run(input)) }],
            };
          } catch {
            return {
              isError: true,
              content: [{ type: "text" as const, text: "Tool request failed" }],
            };
          }
        }),
      ),
    });
    const names = tools.map((tool) => `mcp__gateway__${tool.name}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let succeeded = false;
    let retries = 0;
    let unrecordedAssistant = false;
    let callStart = start;
    type Entry = { index: number; tools: Set<string>; start: number; outputFinal: boolean };
    const seen = new Map<string, Entry>();
    let streaming: Entry | undefined;
    let timing: Entry | undefined;
    function entryFor(id: string, usage: Usage): Entry {
      let entry = seen.get(id);
      if (!entry) {
        entry = { index: calls.length, tools: new Set(), start: callStart, outputFinal: false };
        seen.set(id, entry);
        timing = entry;
        // Assistant/message_start output counts are placeholders until message_delta arrives.
        calls.push(
          record(config, "proposer", { ...usage, output_tokens: 0 }, 0, now() - callStart, retries),
        );
        callStart = now();
        retries = 0;
      }
      return entry;
    }
    function update(
      entry: Entry,
      usage: { input_tokens?: number | null; output_tokens?: number } = {},
    ) {
      const previous = calls[entry.index] as ModelCall;
      const input = usage.input_tokens ?? previous.inputTokens;
      const output = usage.output_tokens ?? previous.outputTokens;
      let latencyMs = previous.latencyMs;
      // Closed responses can still receive assistant fragments or result usage updates.
      if (entry === timing) {
        callStart = now();
        latencyMs = Math.max(0, callStart - entry.start);
      }
      calls[entry.index] = {
        ...previous,
        tokens: { input, output },
        inputTokens: input,
        outputTokens: output,
        toolCalls: entry.tools.size,
        latencyMs,
      };
    }
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
          includePartialMessages: true,
          verbatimPrompts: true,
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
        if (event.type === "system" && event.subtype === "api_retry") {
          retries++;
          if (retries > config.maxRetries) {
            controller.abort();
            throw new Error("Provider retry budget exceeded");
          }
        }
        if (event.type === "stream_event") {
          if (event.event.type === "message_start") {
            const message = assistant.pick({ id: true, usage: true }).parse(event.event.message);
            streaming = entryFor(message.id, message.usage);
          } else if (event.event.type === "message_delta") {
            if (!streaming) throw new Error("Usage has no provider message");
            update(
              streaming,
              usageSchema
                .extend({ input_tokens: usageSchema.shape.input_tokens.nullish() })
                .parse(event.event.usage),
            );
            streaming.outputFinal = true;
          } else if (event.event.type === "message_stop") {
            if (streaming) update(streaming);
            streaming = undefined;
            timing = undefined;
          }
        }
        if (event.type === "assistant") {
          unrecordedAssistant = true;
          if (event.error) throw new Error("Provider failed");
          const message = assistant.parse(event.message);
          const entry = entryFor(message.id, message.usage);
          unrecordedAssistant = false;
          for (const block of message.content) {
            if (block.type !== "tool_use") continue;
            const toolId = z.string().parse(block.id);
            if (entry.tools.has(toolId)) continue;
            entry.tools.add(toolId);
            if (block.name === "mcp__gateway__propose") {
              const parsed = z
                .object({ action: z.object({ id: z.string() }) })
                .safeParse(block.input);
              if (parsed.success) {
                if (provenance.has(parsed.data.action.id)) throw new Error("Duplicate proposal id");
                provenance.set(parsed.data.action.id, (calls[entry.index] as ModelCall).id);
              }
            }
          }
          update(entry);
        }
        if (event.type === "result") {
          const pending = [...seen.values()].filter((entry) => !entry.outputFinal);
          if (pending.length > 0) {
            // A result is an aggregate, never an extra call. Only one missing count can be
            // assigned unambiguously; multiple missing responses must not invent a split.
            if (pending.length !== 1) throw new Error("Incomplete per-message usage");
            const output =
              usageSchema.parse(event.usage).output_tokens -
              [...seen.values()].reduce(
                (sum, entry) => sum + (calls[entry.index] as ModelCall).outputTokens,
                0,
              );
            if (output < 0) throw new Error("Inconsistent provider usage");
            update(pending[0] as Entry, { output_tokens: output });
            (pending[0] as Entry).outputFinal = true;
          }
          if (event.subtype !== "success" || event.is_error) throw new Error("Provider failed");
          succeeded = true;
        }
      }
      if (!succeeded || seen.size === 0 || controller.signal.aborted)
        throw new Error("Incomplete provider run");
    } catch (error) {
      if (seen.size === 0 || retries > 0 || unrecordedAssistant)
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
