// AUTHORED-BY Codex GPT-6.1-Sol
import { createWebSocketChannel, type WebSocketChannelOptions } from "./websocket.js";

export type { WebSocketChannelOptions } from "./websocket.js";
/** Batch all LWS topics into one WebSocketSubscription and delete it on close. */
export function createLwsWebSocketChannel(options: WebSocketChannelOptions) {
  return createWebSocketChannel(options, "lws");
}
