// AUTHORED-BY Codex GPT-6.1-Sol
import { createPushChannel, type PushChannelOptions } from "./push.js";

export type { PushChannelOptions } from "./push.js";
/** Discover NSS Updates-Via and subscribe using the solid-0.1 subprotocol. */
export function createLegacyWebSocketChannel(options: PushChannelOptions) {
  return createPushChannel(options, "solid", "legacy-ws");
}
