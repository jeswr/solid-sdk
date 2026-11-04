// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChannelCapability } from "@jeswr/agent-model";
import type { AgentDescriptor } from "../../src/types.js";

export const gmail: ChannelCapability = {
  type: "channel-capability",
  id: "https://alice.example/agent/descriptors/gmail.ttl#gmail",
  channel: "email",
  binding: "gmail",
  carriage: "email-mime/0.1",
  structuredPayload: true,
  endToEndEncrypted: false,
  deliveryReceipts: false,
  historyWindow: "P30D",
  maxMessageBytes: 25000000,
  sendSupported: true,
  costPerMessage: 0,
  rateLimit: { perRecipient: 3, perDay: 50 },
  credentialState: "connected",
  lastIngest: "2026-10-31T00:00:00Z",
};
export const matrix: ChannelCapability = {
  ...gmail,
  id: "https://alice.example/agent/descriptors/matrix.ttl#matrix",
  channel: "chat",
  binding: "matrix",
  carriage: "matrix-json/0.1",
  endToEndEncrypted: true,
  deliveryReceipts: true,
  credentialState: "setup-required",
};
export const descriptor: AgentDescriptor = {
  id: "https://alice.example/agent",
  name: "Alice's Agent",
  owner: "https://alice.example/profile/card#me",
  bindings: [gmail, matrix],
};
