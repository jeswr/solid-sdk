// AUTHORED-BY Codex GPT-6.1-Sol
import { createPushChannel, type PushChannelOptions } from "./push.js";

export type { PushChannelOptions } from "./push.js";
/** Batch LWS topics into one SSE subscription with native Last-Event-ID replay. */
export function createLwsSseChannel(options: PushChannelOptions) {
  return createPushChannel(options, "lws", "sse");
}
