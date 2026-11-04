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

/** The model that drafts automation rules. */
export const DRAFT_MODEL = "claude-sonnet-5-5";

/** What Claude is told about the organisation when drafting a rule. */
export interface DraftContext {
  readonly tools: readonly ToolSpec[];
  readonly apps: Readonly<Record<string, string>>;
  readonly purposes: Readonly<Record<string, string>>;
  readonly icons: readonly string[];
}

/** The shape Claude fills in (the server checks it again with validateRule). */
function draftSchema(context: DraftContext) {
  return {
    type: "object",
    properties: {
      title: { type: "string", description: "Short name, sentence case, under 40 characters." },
      icon: { type: "string", enum: context.icons },
      summary: { type: "string", description: "What it does, one plain sentence." },
      trigger: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["email", "schedule", "manual"] },
          match: { type: "string", description: "For email: which emails, in plain words." },
          keywords: { type: "array", items: { type: "string" } },
          every: { type: "string", enum: ["hour", "day", "week"] },
        },
        required: ["kind"],
      },
      runner: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["code", "llm"] },
          source: { type: "string" },
          instructions: { type: "string" },
        },
        required: ["kind"],
      },
      rationale: { type: "string", description: "One sentence: why code or a model." },
      policy: {
        type: "object",
        properties: {
          purpose: { type: "string", enum: Object.keys(context.purposes) },
          allow: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", enum: context.tools.map((t) => t.name) },
                to: {
                  description:
                    'Only for tools that send: "sender" (whoever wrote the email that started the run), "staff", "anyone", or a list of email addresses.',
                  anyOf: [
                    { type: "string", enum: ["sender", "staff", "anyone"] },
                    { type: "array", items: { type: "string" } },
                  ],
                },
                approval: { type: "boolean" },
              },
              required: ["tool"],
            },
          },
          sendsPerDay: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: ["purpose", "allow"],
      },
    },
    required: ["title", "icon", "summary", "trigger", "runner", "rationale", "policy"],
  };
}

function draftSystem(context: DraftContext): string {
  const tools = context.tools
    .map(
      (t) =>
        `- ${t.name} (${context.apps[t.system] ?? t.system}, ${t.kind}): ${t.description} Arguments: ${JSON.stringify(t.inputSchema.properties ?? {})}`,
    )
    .join("\n");
  return [
    "You turn a person's description of a process into an automation rule for Harbour & Finch, a fictional company in a demonstration. Call propose_automation exactly once.",
    'The rule runs inside a policy sandbox. Its policy is checked on top of the organisation\'s own rules, so keep it as narrow as the process allows: list only the tools it needs; for tools that send, say who may receive (prefer "sender" for replies); ask for approval where a person would want to check first; set a sensible daily limit.',
    "Choose code when the steps are the same every time (no judgement needed), and llm when the steps depend on reading and understanding content.",
    "Code runs in a sandboxed JavaScript box with top-level await. In scope: `event` ({kind:'email', message:{id, from, fromName, subject, body}} or {kind:'schedule', at} or {kind:'manual'}), `tools.<name>(args)` which returns {status:'done', content} or {status:'held'|'stopped'|'failed', message}, and `log(text)` for a one-line note shown to people. Read results from content; list tools return {records:[...]} in content.",
    "LLM instructions are standing instructions for a model that is given the event and the allowed tools.",
    `The connected tools:\n${tools}`,
  ].join("\n\n");
}

/** Ask Claude to draft a rule. Returns the raw draft fields (checked by the caller). */
export async function claudeDraftRule(
  apiKey: string,
  request: string,
  context: DraftContext,
  problems?: readonly string[],
): Promise<Record<string, unknown>> {
  const messages = [
    {
      role: "user",
      content: problems?.length
        ? `${request}\n\nYour previous draft had these problems; fix them:\n- ${problems.join("\n- ")}`
        : request,
    },
  ];
  const res = await createMessage(apiKey, {
    model: DRAFT_MODEL,
    max_tokens: 8000,
    system: draftSystem(context),
    tools: [
      {
        name: "propose_automation",
        description: "Propose the automation rule.",
        input_schema: draftSchema(context),
      },
    ],
    tool_choice: { type: "tool", name: "propose_automation" },
    messages,
  });
  const use = res.content.find((b) => b.type === "tool_use");
  if (!use || typeof use.input !== "object" || use.input === null)
    throw new Error("Claude did not propose a rule.");
  return use.input as Record<string, unknown>;
}
