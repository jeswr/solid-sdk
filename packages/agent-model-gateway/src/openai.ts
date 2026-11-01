// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";
import { executeTool, type Tool } from "./tools.js";
import { type Configuration, transport } from "./transport.js";
import type { GatewayOptions, ModelCall } from "./types.js";

const item = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("function_call"),
      call_id: z.string(),
      name: z.string(),
      arguments: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("message"),
      content: z.array(z.object({ type: z.literal("output_text"), text: z.string() })),
    })
    .passthrough(),
  z.object({ type: z.literal("reasoning") }).passthrough(),
]);
export const responseSchema = z.object({ status: z.literal("completed"), output: z.array(item) });

export async function openaiPropose(
  options: GatewayOptions,
  config: Configuration,
  prompt: string,
  instructions: string,
  tools: Tool[],
  calls: ModelCall[],
  provenance: Map<string, string>,
) {
  const request = transport(options, config);
  const input: unknown[] = [{ role: "user", content: prompt }];
  for (let turn = 0; turn < config.maxTurns; turn++) {
    const response = responseSchema.parse(
      await request(
        {
          model: config.model,
          max_output_tokens: config.maxTokens,
          store: false,
          instructions,
          input,
          tools: tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: z.toJSONSchema(tool.schema),
            strict: false,
          })),
          parallel_tool_calls: false,
        },
        "proposer",
        calls,
      ),
    );
    const toolCalls = response.output.filter((item) => item.type === "function_call");
    if (toolCalls.length === 0) return;
    input.push(...response.output);
    for (const call of toolCalls) {
      const args: unknown = JSON.parse(call.arguments);
      const result = await executeTool(tools, call.name, args);
      if (call.name === "propose") {
        const { action } = z.object({ action: z.object({ id: z.string() }) }).parse(args);
        if (provenance.has(action.id)) throw new Error("Duplicate proposal id");
        provenance.set(action.id, (calls.at(-1) as ModelCall).id);
      }
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: result,
      });
    }
  }
  throw new Error("Model turn limit exceeded");
}
