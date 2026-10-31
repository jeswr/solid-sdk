// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import {
  type ConversationState,
  openConversation,
  type TransmissionSettlement,
  transition,
} from "./conversation.js";
import { DEFAULT_LIMITS } from "./limits.js";

const at = "2026-10-31T12:00:00.000Z";
const event: TransmissionSettlement = {
  type: "transmission-settled",
  conversation: "urn:conversation",
  proposal: "urn:action-proposal",
  activity: "urn:transmission",
  status: "uncertain",
  final: false,
  at,
};
const open = () => openConversation({ id: event.conversation, role: "initiator", peer: {}, at });

it.each([
  "open",
  "negotiating",
  "awaiting-approval",
  "agreed",
  "invoked",
  "uncertain",
  "completed",
  "failed",
  "expired",
] as const)("records delivery in %s independently of performance and message limits", (phase) => {
  const state: ConversationState = {
    ...open(),
    phase,
    agreement: "urn:agreement",
    requiredOutcomes: ["self", "peer"],
    outcomes: { peer: "completed" },
    messageCount: DEFAULT_LIMITS.maxMessagesPerConversation,
  };
  const before = structuredClone(state);
  let current = state;
  for (const status of ["uncertain", "not-sent", "sent"] as const) {
    const settlement = { ...event, status, final: status === "sent" };
    const result = transition(current, settlement, DEFAULT_LIMITS);
    expect(result).toEqual({
      ok: true,
      state: { ...state, transmissions: { [event.proposal]: settlement } },
    });
    if (!result.ok) throw new Error(result.detail);
    current = result.state;
    expect(transition(current, settlement, DEFAULT_LIMITS)).toEqual(result);
  }
  expect(state).toEqual(before);
});

it("records multiple proposals without requiring an agreement", () => {
  const first = transition(open(), event, DEFAULT_LIMITS);
  if (!first.ok) throw new Error(first.detail);
  const next = { ...event, proposal: "urn:other-proposal", activity: "urn:other-transmission" };
  const result = transition(first.state, next, DEFAULT_LIMITS);
  expect(result).toEqual({
    ok: true,
    state: { ...open(), transmissions: { [event.proposal]: event, [next.proposal]: next } },
  });
});

it("rejects settlements for another conversation without mutating state", () => {
  const state = open();
  const before = structuredClone(state);
  expect(
    transition(state, { ...event, conversation: "urn:other-conversation" }, DEFAULT_LIMITS),
  ).toMatchObject({ ok: false, reason: "protocol-violation" });
  expect(state).toEqual(before);
});
