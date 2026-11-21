// AUTHORED-BY Codex GPT-6.2 Sol
import { encodeEnvelope, readEnvelope } from "@jeswr/agent-channels";
import { CONFIG_ED25519, PILOT_PROFILE } from "@jeswr/agent-reference";
import { Cast, craftSigned, mandateOf } from "@jeswr/agent-reference/scenarios/common";
import { describe, expect, it, vi } from "vitest";
import { createGate, type StoredVerdict } from "../src/gate.js";

describe("W17 signed-message compatibility", () => {
  it("admits a reference-signed describe message recovered from the W17 carrier", async () => {
    const now = () => new Date("2026-10-19T08:00:00Z");
    const cast = new Cast(now);
    const denyAll = mandateOf("deny-all", []);
    const peer = await cast.add(
      {
        name: "peer",
        actor: "https://peer.example/agent#id",
        party: "https://peer.example/owner#id",
      },
      denyAll,
      [],
    );
    const receiver = await cast.add(
      {
        name: "receiver",
        actor: "https://receiver.example/agent#id",
        party: "https://receiver.example/owner#id",
      },
      denyAll,
      [],
    );
    cast.pin("receiver", "peer");
    const { runtime } = await cast.runtime("receiver", []);
    try {
      const message = {
        profile: PILOT_PROFILE,
        configuration: CONFIG_ED25519,
        id: "urn:uuid:00000000-0000-4000-8000-000000000001",
        conversation: "urn:uuid:00000000-0000-4000-8000-100000000001",
        kind: "describe",
        from: { actor: peer.identity.actor },
        to: { actor: receiver.identity.actor },
        createdAt: now().toISOString(),
        expiresAt: new Date(now().getTime() + 3_600_000).toISOString(),
        body: {},
      };
      const wire = await craftSigned(peer, message);
      const carrier = encodeEnvelope(wire.jws);
      const { compactJws } = readEnvelope(carrier);
      expect(compactJws).toBe(wire.jws);

      const step = await runtime.receive(
        { format: wire.format, jws: compactJws },
        { binding: "direct" },
      );
      expect({
        disposition: step.disposition,
        reason: step.reason,
        detail: step.detail,
        messageId: step.messageId,
      }).toEqual({
        disposition: "accepted",
        reason: undefined,
        detail: undefined,
        messageId: message.id,
      });
    } finally {
      await runtime.close();
    }
  });
});

it("requires a positive inbound admission even when the protocol result is accepted", async () => {
  let verdict: StoredVerdict | undefined;
  const gate = createGate(
    {
      receive: async () => ({
        disposition: "accepted",
        messageId: "urn:test:message",
        conversation: "urn:test:conversation",
        outbound: [],
        decisions: [],
      }),
      commitBindingEvent: vi.fn(),
      close: vi.fn(),
    },
    {
      get: async () => verdict,
      put: async (_hex, next) => {
        verdict = next;
      },
      digests: async () => [],
    },
    { entries: () => [] },
    [],
    () => new Date("2026-10-19T08:00:00Z"),
  );
  expect(
    await gate.check({
      binding: "direct",
      account: "fixture",
      message: {
        channel: "direct",
        textBody: "",
        signals: {},
        rawSha256: "a".repeat(64),
        rawByteLength: 0,
        rawMediaType: "application/json",
        warnings: [],
        jsonLdBlocks: [encodeEnvelope("a.b.c")],
      },
    }),
  ).toMatchObject({ outcome: "refused", reason: "indeterminate" });
});
