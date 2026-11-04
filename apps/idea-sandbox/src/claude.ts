// AUTHORED-BY Claude Opus 5.5
// Live Claude adapters for the sandbox, using the visitor's OWN API key. The key stays in this
// tab (sessionStorage) and is sent only to api.anthropic.com, straight from the browser.
//
// This calls the Messages API with fetch rather than through @jeswr/agent-model-gateway: the
// gateway is Node-only, and this public demo runs entirely in the visitor's browser on the
// visitor's key. Model SDKs stay gateway-only (scripts/check-agent-layers.mjs).
import type { AgentModel, Args, JudgeModel, ToolSpec } from "@jeswr/agent-sandbox";

export const AGENT_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
] as const;

/** The judging and classifying model (a second, cheaper model). */
export const JUDGE_MODEL = "claude-haiku-5-5";

const KEY = "idea-sandbox:anthropic-key";

export function loadKey(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(KEY, key);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Private windows may refuse storage; the key then lives only in memory.
  }
}

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

type Block = { readonly type: string; readonly [key: string]: unknown };
interface MessageResponse {
  readonly content: readonly Block[];
  readonly stop_reason: string | null;
}

async function createMessage(
  apiKey: string,
  body: object,
  beta?: string,
): Promise<MessageResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (beta) headers["anthropic-beta"] = beta;
  const res = await fetch(MESSAGES_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => undefined)) as
    | (MessageResponse & { error?: { message?: string } })
    | undefined;
  if (!res.ok || !json || !Array.isArray(json.content))
    throw new Error(json?.error?.message ?? `The Claude API returned HTTP ${res.status}.`);
  return json;
}

const textOf = (content: readonly Block[]): string =>
  content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");

/** Claude as the judge (LLM mode) and purpose classifier (hybrid mode). */
export function claudeJudge(apiKey: string): JudgeModel {
  return {
    name: "Claude Haiku 5.5",
    async complete(system, prompt) {
      const res = await createMessage(apiKey, {
        model: JUDGE_MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort: "low" },
      });
      if (res.stop_reason === "refusal")
        return '{"outcome": "review", "reason": "the model declined to judge"}';
      return textOf(res.content);
    },
  };
}

/** Claude as the agent, driving the sandbox's tools. */
export function claudeAgent(apiKey: string, model: string): AgentModel {
  const label = AGENT_MODELS.find((m) => m.id === model)?.label ?? model;
  return {
    name: label,
    start(system: string, task: string, tools: readonly ToolSpec[]) {
      const messages: { role: "user" | "assistant"; content: unknown }[] = [
        { role: "user", content: task },
      ];
      const defs = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
      return {
        async next(results) {
          if (results?.length)
            messages.push({
              role: "user",
              content: results.map((r) => ({
                type: "tool_result",
                tool_use_id: r.id,
                content: r.text,
                is_error: r.result.status === "stopped" || r.result.status === "failed",
              })),
            });
          const res = await createMessage(
            apiKey,
            {
              model,
              max_tokens: 16000,
              system,
              tools: defs,
              messages,
              output_config: { effort: "low" },
              fallbacks: "default",
            },
            "server-side-fallback-2026-07-01",
          );
          // Keep every block (including thinking) so the conversation stays valid.
          messages.push({ role: "assistant", content: res.content });
          if (res.stop_reason === "refusal")
            return { text: "The model declined to continue.", calls: [] };
          const calls = res.content
            .filter((b) => b.type === "tool_use")
            .map((b) => ({
              id: String(b.id),
              tool: String(b.name),
              args: (b.input ?? {}) as Args,
            }));
          return { text: textOf(res.content), calls };
        },
      };
    },
  };
}
