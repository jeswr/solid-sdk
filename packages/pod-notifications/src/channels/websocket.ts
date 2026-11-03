// AUTHORED-BY Codex GPT-6.1-Sol
import { createPushChannel, type PushChannelOptions } from "./push.js";

export { reconnectDelay } from "./push.js";
/** Dependencies and scoped topics for the WebSocket adapters. */
export type WebSocketChannelOptions = PushChannelOptions;

/** Shared one-shot WebSocket lifecycle for Solid and LWS. */
export function createWebSocketChannel(
  options: WebSocketChannelOptions,
  protocol: "solid" | "lws",
) {
  return createPushChannel(options, protocol, "websocket");
}
