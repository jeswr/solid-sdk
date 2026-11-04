// AUTHORED-BY Codex GPT-6.1-Sol
import { createPushChannel, type PushChannelOptions } from "./push.js";

export type { PushChannelOptions } from "./push.js";
/** Batch LWS webhook topics into a registered relay inbox and receive its SSE stream. */
export function createWebhookRelayChannel(options: PushChannelOptions) {
  return createPushChannel(options, "lws", "webhook-relay");
}
