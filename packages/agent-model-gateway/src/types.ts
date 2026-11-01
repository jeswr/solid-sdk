// AUTHORED-BY Codex GPT-6.1-Sol

import type { BridgeMessage } from "@jeswr/agent-channels";
import type { TokenProvider } from "@jeswr/agent-credentials";
import type { ActionProposal } from "@jeswr/agent-model";
import type { GuardOptions } from "@jeswr/guarded-fetch";
import type { PodPort } from "@jeswr/solid-mcp";
import type { z } from "zod";

export type Provider = "anthropic" | "openai";
export interface ModelCall {
  readonly id: string;
  readonly context: "reader" | "proposer";
  readonly provider: Provider;
  readonly model: string;
  readonly tokens: { readonly input: number; readonly output: number };
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCalls: number;
  readonly latencyMs: number;
  readonly retries: number;
}
/** Errors carry counters too; provider messages, prompts and credentials never escape here. */
export class GatewayError extends Error {
  constructor(readonly calls: readonly ModelCall[] = []) {
    super("Model gateway request failed");
    this.name = "GatewayError";
  }
}
export interface ProposerContext {
  readonly pod: PodPort;
  readonly memoryRecall: (query: string) => Promise<unknown>;
  /** Trusted runtime context, not a model-supplied authority assertion. */
  readonly instructions: string;
}
export interface GatewayOptions {
  readonly provider: Provider;
  readonly model: string;
  readonly maxTokens: number;
  /** Provider-specific TokenProvider; only read(account) is used. */
  readonly tokens: Pick<TokenProvider, "read">;
  readonly account: string;
  readonly baseUrl?: string;
  readonly fetch?: NonNullable<GuardOptions["fetch"]>;
  readonly now?: () => number;
  readonly maxRetries?: number;
  readonly maxTurns?: number;
  readonly timeoutMs?: number;
}
export interface Gateway {
  readonly reader: {
    extract<T>(
      input: BridgeMessage,
      schema: z.ZodType<T>,
    ): Promise<{ data: T; calls: ModelCall[] }>;
  };
  readonly proposer: {
    propose(
      conversation: readonly unknown[],
      ctx: ProposerContext,
    ): Promise<{
      proposals: ActionProposal[];
      calls: ModelCall[];
    }>;
  };
}
