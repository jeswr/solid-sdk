// AUTHORED-BY Codex GPT-6.1-Sol
import { DEFAULT_LIMITS, derivedUrn, openConversation, transition } from "@jeswr/agent-model";
import { expect, it, vi } from "vitest";
import { createExecutor, MAX_TRANSMISSION_ATTEMPTS } from "../src/index.js";
import { harness, NOW } from "./helpers.js";

it.each([
  ["sent", 1, true],
  ["not-sent", 1, false],
  ["not-sent", MAX_TRANSMISSION_ATTEMPTS, true],
  ["uncertain", 1, false],
] as const)("applies %s transmission settlement after %s attempts without settling performance", async (status, attempts, final) => {
  const h = harness();
  const entry = await h.enqueue();
  if (attempts > 1) h.prior(entry, "not-sent", attempts - 1);
  if (status === "not-sent")
    vi.mocked(h.binding.send.transmit).mockResolvedValue({ outcome: "rejected", detail: "no" });
  if (status === "uncertain")
    vi.mocked(h.binding.send.transmit).mockRejectedValue(new Error("offline"));

  const envelope = entry.renderable.message;
  const offer = transition(
    openConversation({
      id: envelope.conversation,
      role: "initiator",
      peer: { actor: "urn:peer" },
      at: NOW,
    }),
    {
      type: "message",
      direction: "out",
      message: {
        ...envelope,
        id: "urn:offer",
        kind: "propose",
        body: { operation: { id: "urn:op", version: "1" }, terms: {}, termsDigest: "d", round: 1 },
      },
      at: NOW,
    },
    DEFAULT_LIMITS,
  );
  if (!offer.ok) throw new Error(offer.detail);
  const accepted = transition(
    offer.state,
    {
      type: "message",
      direction: "in",
      message: {
        ...envelope,
        id: "urn:accept",
        kind: "accept",
        body: { proposal: "urn:offer", termsDigest: "d", agreement: "urn:agreement" },
      },
      at: NOW,
    },
    DEFAULT_LIMITS,
  );
  if (!accepted.ok) throw new Error(accepted.detail);
  const state = { ...accepted.state, requiredOutcomes: ["self"] as const };
  const before = structuredClone(state);
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({ status });
  const [settlement] = [...h.settlements.values()];
  expect(settlement).toEqual({
    type: "transmission-settled",
    conversation: state.id,
    proposal: entry.proposal.id,
    activity: derivedUrn("transmission", entry.proposal.id),
    status,
    final,
    sequence: 2,
    at: NOW,
  });
  if (!settlement) throw new Error("Missing transmission settlement");
  const applied = transition(state, settlement, DEFAULT_LIMITS);
  expect(applied).toEqual({
    ok: true,
    state: { ...state, transmissions: { [entry.proposal.id]: settlement } },
  });
  expect(state).toEqual(before);
  if (!applied.ok) throw new Error(applied.detail);

  // Only a performance receipt referencing the agreement can complete the agreement.
  expect(
    transition(
      applied.state,
      {
        type: "message",
        direction: "out",
        message: {
          ...envelope,
          id: "urn:performance-receipt",
          kind: "receipt",
          body: {
            ref: "urn:agreement",
            activity: "urn:performance",
            outcome: "completed",
            final: true,
          },
        },
        at: NOW,
      },
      DEFAULT_LIMITS,
    ),
  ).toMatchObject({ ok: true, state: { phase: "completed", outcomes: { self: "completed" } } });
});

it.each([
  false,
  true,
])("replays upserted settlements after three attempts, compacted=%s", async (compacted) => {
  const h = harness();
  const entry = await h.enqueue();
  Object.assign(h.binding.send, {
    finalAbsence: true,
    lookup: vi.fn(async () => ({ outcome: "absent" as const })),
  });
  vi.mocked(h.binding.send.transmit)
    .mockResolvedValueOnce({ outcome: "rejected", detail: "not accepted" })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ outcome: "rejected", detail: "not accepted" });
  vi.spyOn(h.audit, "listCommitted").mockImplementation(async () =>
    structuredClone([...h.ledger].reverse()),
  );
  const emit = vi.spyOn(h.proposals, "emitTransmission");
  for (const status of ["not-sent", "uncertain", "not-sent"]) {
    if (compacted) h.records.clear();
    expect(await createExecutor(h.options).transmit(entry.proposal.id)).toMatchObject({ status });
    expect(emit.mock.lastCall?.[0].sequence).toBe(h.records.get(entry.proposal.id)?.sequence);
  }
  expect(h.binding.send.transmit).toHaveBeenCalledTimes(MAX_TRANSMISSION_ATTEMPTS);
  expect(emit.mock.calls.map(([settlement]) => settlement.sequence)).toEqual([2, 4, 7]);

  // Upserting by proposal + status retains the first status's original iteration position.
  const stored = [...h.settlements.values()];
  expect(stored).toEqual([
    expect.objectContaining({ status: "not-sent", final: true, sequence: 7, at: NOW }),
    expect.objectContaining({ status: "uncertain", final: false, sequence: 4, at: NOW }),
  ]);
  for (const events of [stored, [...stored].reverse(), stored.concat(stored)]) {
    let state = openConversation({
      id: entry.proposal.intent.conversation,
      role: "initiator",
      peer: {},
      at: NOW,
    });
    for (const settlement of events) {
      const result = transition(state, settlement, DEFAULT_LIMITS);
      if (!result.ok) throw new Error(result.detail);
      state = result.state;
    }
    expect(state.transmissions?.[entry.proposal.id]).toEqual(stored[0]);
    expect(state.phase).toBe("open");
    expect(state.outcomes).toEqual({});
  }
});
