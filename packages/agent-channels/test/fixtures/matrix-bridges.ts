// AUTHORED-BY Codex GPT-6.1-Sol
// Sanitized mautrix event shapes; all identifiers and payloads are synthetic.
import type { MatrixBridgeChannel } from "../../src/matrix.js";
import { roomId } from "./matrix.js";

export const bridgeState = (
  channel: string,
  type = "m.bridge",
  stateKey = `net.maunium.${channel}://bridge.example/chat`,
) => ({
  type,
  state_key: stateKey,
  sender: `@${channel}bot:bridge.example`,
  content: {
    bridgebot: `@${channel}bot:bridge.example`,
    creator: "@owner:example.org",
    protocol: { id: channel, displayname: channel },
    channel: { id: "synthetic-chat" },
  },
});
export const bridgeGhosts: Record<MatrixBridgeChannel, string> = {
  signal: "@signal_00000000-0000-4000-8000-000000000001:bridge.example",
  whatsapp: "@whatsapp_15550000001:bridge.example",
};
export const bridgedSync = (events: unknown[], state: unknown[]) => ({
  next_batch: "s1",
  rooms: { join: { [roomId]: { state: { events: state }, timeline: { events } } } },
});
