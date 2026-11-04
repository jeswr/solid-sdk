// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChannelCapability } from "../capability.js";
import { ChannelParseError } from "../errors.js";
import { SIGNAL_FOOTER, WHATSAPP_FOOTER } from "../profiles.js";
import type { BindingState } from "../types.js";
import { record } from "./shared.js";

export type MatrixBridgeChannel = "signal" | "whatsapp";
export const MATRIX_BRIDGE_STATE = Object.freeze(["m.bridge", "uk.half-shot.bridge"]);

export function bridgeChannel(value: unknown): MatrixBridgeChannel {
  if (value !== "signal" && value !== "whatsapp")
    throw new ChannelParseError("unsupported Matrix bridge");
  return value;
}
export function matrixBridgeProfile(channel: MatrixBridgeChannel) {
  return bridgeChannel(channel) === "signal" ? SIGNAL_FOOTER : WHATSAPP_FOOTER;
}
/** Discovery hints only: neither ghost names nor room state authenticate a remote user. */
export function detectMatrixBridge(
  sender: unknown,
  state: readonly unknown[] = [],
): MatrixBridgeChannel | undefined {
  const ghost = typeof sender === "string" && /^@_?(signal|whatsapp)_[^:]+:.+$/.exec(sender);
  let channel = ghost ? bridgeChannel(ghost[1]) : undefined;
  for (const value of state) {
    const event = record(value);
    if (!MATRIX_BRIDGE_STATE.includes(event.type as string)) continue;
    if (typeof event.state_key !== "string")
      throw new ChannelParseError("invalid Matrix bridge state key");
    const next = bridgeChannel(record(record(event.content).protocol).id);
    if (channel !== undefined && channel !== next)
      throw new ChannelParseError("conflicting Matrix bridge hints");
    channel = next;
  }
  return channel;
}
/** A separate logical-channel descriptor, sharing the pinned Matrix transport. */
export function describeMatrixBridge(
  channel: MatrixBridgeChannel,
  state: BindingState,
): ChannelCapability {
  const carriage = matrixBridgeProfile(channel);
  return {
    type: "channel-capability",
    id: `urn:agent:binding:matrix:${channel}`,
    channel,
    binding: "matrix",
    carriage: carriage.id,
    structuredPayload: false,
    endToEndEncrypted: false,
    deliveryReceipts: false,
    historyWindow: "P0D",
    maxMessageBytes: carriage.maxBytes,
    sendSupported: true,
    costPerMessage: 0,
    rateLimit: { perRecipient: 0, perDay: 0 },
    credentialState: state,
  };
}
