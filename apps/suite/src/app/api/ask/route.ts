// AUTHORED-BY Codex (GPT-6.1 Sol)
import Anthropic from "@anthropic-ai/sdk";
import { ASK_MODEL, createAskHandler } from "@/apps/ask/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = createAskHandler({
  env: process.env,
  async complete(prompt, signal) {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 0,
      timeout: 45000,
      logLevel: "off",
    });
    const result = await client.messages.create(
      {
        model: ASK_MODEL,
        max_tokens: 2000,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      },
      { signal },
    );
    if (result.stop_reason !== "end_turn") throw new Error("Incomplete grounded answer");
    return result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  },
});
