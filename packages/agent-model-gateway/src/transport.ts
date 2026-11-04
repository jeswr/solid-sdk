// AUTHORED-BY Codex GPT-6.1-Sol
import { guardedFetch } from "@jeswr/guarded-fetch";
import { z } from "zod";
import { GatewayError, type GatewayOptions, type ModelCall } from "./types.js";

const origins = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
} as const;
export const ORIGINS: ReadonlySet<string> = new Set(Object.values(origins));
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const usageSchema = z.object({
  input_tokens: count,
  output_tokens: count,
  cache_creation_input_tokens: count.nullish(),
  cache_read_input_tokens: count.nullish(),
});
export type Usage = z.infer<typeof usageSchema>;
export function anthropicInputTokens(usage: Usage): number {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}
export const limitsSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().trim().min(1).max(200),
  account: z.string().min(1),
  maxTokens: z.number().int().min(1).max(128000),
  maxRetries: z.number().int().min(0).max(3).default(0),
  maxTurns: z.number().int().min(1).max(32).default(8),
  timeoutMs: z.number().int().min(1).max(300000).default(60000),
});
export function configuration(options: GatewayOptions) {
  const limits = limitsSchema.parse(options);
  const origin = origins[limits.provider];
  const url = new URL(options.baseURL ?? origin);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Model gateway origin is not allowed");
  return { ...limits, origin };
}
export type Configuration = ReturnType<typeof configuration>;

export function record(
  config: Configuration,
  context: ModelCall["context"],
  usage: Usage,
  toolCalls: number,
  latencyMs: number,
  retries: number,
): ModelCall {
  const input = config.provider === "anthropic" ? anthropicInputTokens(usage) : usage.input_tokens;
  return {
    id: `urn:uuid:${crypto.randomUUID()}`,
    context,
    provider: config.provider,
    model: config.model,
    tokens: { input, output: usage.output_tokens },
    inputTokens: input,
    outputTokens: usage.output_tokens,
    toolCalls,
    latencyMs: Math.max(0, latencyMs),
    retries,
  };
}

export function transport(options: GatewayOptions, config: Configuration) {
  const fetcher =
    options.fetch ??
    ((url, init) => guardedFetch(url, { ...init, maxRedirects: 0, timeoutMs: config.timeoutMs }));
  const now = options.now ?? Date.now;
  return async (
    body: unknown,
    context: ModelCall["context"],
    calls: ModelCall[],
  ): Promise<unknown> => {
    const start = now();
    let retries = 0;
    let usage: Usage = { input_tokens: 0, output_tokens: 0 };
    let toolCalls = 0;
    try {
      const key = await options.tokens.read(config.account);
      if (!key || /\s/.test(key)) throw new GatewayError();
      const headers =
        config.provider === "openai"
          ? { authorization: `Bearer ${key}`, "content-type": "application/json" }
          : {
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            };
      while (true) {
        const response = await fetcher(
          `${config.origin}/v1/${config.provider === "openai" ? "responses" : "messages"}`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            redirect: "error",
            signal: AbortSignal.timeout(config.timeoutMs),
          },
        );
        if ((response.status === 429 || response.status >= 500) && retries < config.maxRetries) {
          retries++;
          await response.body?.cancel();
          continue;
        }
        if (!response.ok) throw new GatewayError();
        const value = z
          .object({ usage: usageSchema })
          .passthrough()
          .parse(await response.json());
        usage = value.usage;
        const blocks = config.provider === "openai" ? value.output : value.content;
        toolCalls = z
          .array(z.object({ type: z.string() }))
          .parse(blocks)
          .filter((block) => block.type === "function_call" || block.type === "tool_use").length;
        return value;
      }
    } catch {
      throw new GatewayError(calls);
    } finally {
      calls.push(record(config, context, usage, toolCalls, now() - start, retries));
    }
  };
}
