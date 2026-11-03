// AUTHORED-BY Codex GPT-6.1-Sol
import { createPushChannel, type PushChannelOptions } from "./push.js";

export type { PushChannelOptions } from "./push.js";
/** Subscribe once per Solid topic with a streaming JSON-LD response. */
export function createStreamingHttpChannel(options: PushChannelOptions) {
  return createPushChannel(options, "solid", "sse");
}
