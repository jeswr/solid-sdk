// AUTHORED-BY Codex GPT-6.1-Sol
import { createWebSocketChannel, type WebSocketChannelOptions } from "./websocket.js";

export type { WebSocketChannelOptions } from "./websocket.js";
/** Subscribe once per Solid topic with the discovered WebSocketChannel2023 service. */
export function createWebSocket2023Channel(options: WebSocketChannelOptions) {
  return createWebSocketChannel(options, "solid");
}
