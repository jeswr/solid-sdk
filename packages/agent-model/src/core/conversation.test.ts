// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import {
  type ConversationEvent,
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
  const settlement = { ...event, sequence: 4 };
  const first = transition(open(), settlement, DEFAULT_LIMITS);
  if (!first.ok) throw new Error(first.detail);
  const next = {
    ...event,
    proposal: "urn:other-proposal",
    activity: "urn:other-transmission",
    sequence: 1,
  };
  const result = transition(first.state, next, DEFAULT_LIMITS);
  expect(result).toEqual({
    ok: true,
    state: { ...open(), transmissions: { [event.proposal]: settlement, [next.proposal]: next } },
  });
});

it.each([
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
])("preserves the latest settlement when replaying order %s, %s, %s", (...order) => {
  const settlements = [
    { ...event, status: "not-sent", sequence: 2 },
    { ...event, status: "uncertain", sequence: 4 },
    { ...event, status: "not-sent", final: true, sequence: 7 },
  ] as const;
  let state = open();
  for (const index of order) {
    const settlement = settlements[index];
    if (!settlement) throw new Error("Missing settlement");
    const result = transition(state, settlement, DEFAULT_LIMITS);
    if (!result.ok) throw new Error(result.detail);
    state = result.state;
  }
  expect(state).toEqual({
    ...open(),
    transmissions: { [event.proposal]: settlements[2] },
  });
});

it.each([undefined, 0, 3])("ignores stale sequence %s even with a later timestamp", (sequence) => {
  const latest = { ...event, status: "sent" as const, final: true, sequence: 4 };
  const state = { ...open(), transmissions: { [event.proposal]: latest } };
  const before = structuredClone(state);
  const result = transition(
    state,
    { ...event, sequence, at: "2026-10-31T12:01:00.000Z" },
    DEFAULT_LIMITS,
  );
  expect(result).toEqual({ ok: true, state: before });
  if (!result.ok) throw new Error(result.detail);
  expect(result.state).toBe(state);
  expect(state).toEqual(before);
});

it.each([undefined, 0, 3])("supersedes sequence %s despite clock rollback", (sequence) => {
  const previous = { ...event, sequence };
  const state = { ...open(), transmissions: { [event.proposal]: previous } };
  const latest = {
    ...event,
    status: "not-sent" as const,
    final: true,
    sequence: 4,
    at: "2026-10-31T11:59:00.000Z",
  };
  expect(transition(state, latest, DEFAULT_LIMITS)).toEqual({
    ok: true,
    state: { ...open(), transmissions: { [event.proposal]: latest } },
  });
});

it.each([
  "message",
  "expire",
] as const)("preserves activity after a newer %s when recovering and replaying a settlement", (type) => {
  const laterAt = "2026-10-31T12:01:00.000Z";
  const activity: ConversationEvent =
    type === "expire"
      ? { type, at: laterAt }
      : {
          type,
          direction: "in",
          at: laterAt,
          message: {
            profile: "urn:profile",
            configuration: "urn:configuration",
            id: "urn:message",
            conversation: event.conversation,
            kind: "describe",
            from: {},
            createdAt: laterAt,
            expiresAt: "2026-10-31T13:00:00.000Z",
            body: {},
          },
        };
  const latest = transition(open(), activity, DEFAULT_LIMITS);
  if (!latest.ok) throw new Error(latest.detail);
  const before = structuredClone(latest.state);
  const recovered = transition(latest.state, event, DEFAULT_LIMITS);
  expect(recovered).toEqual({
    ok: true,
    state: { ...latest.state, transmissions: { [event.proposal]: event } },
  });
  expect(latest.state).toEqual(before);
  if (!recovered.ok) throw new Error(recovered.detail);
  expect(transition(recovered.state, event, DEFAULT_LIMITS)).toEqual(recovered);
});

it.each([
  ["2026-10-31T12:01:00.000Z", "2026-10-31T12:01:00.000Z"],
  ["2026-10-31T08:01:00.000-04:00", "2026-10-31T08:01:00.000-04:00"],
  ["2026-10-31T13:00:00.000+02:00", at],
])("uses the later instant for settlement activity at %s", (settledAt, updatedAt) => {
  const settlement = { ...event, at: settledAt };
  expect(transition(open(), settlement, DEFAULT_LIMITS)).toEqual({
    ok: true,
    state: { ...open(), updatedAt, transmissions: { [event.proposal]: settlement } },
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
