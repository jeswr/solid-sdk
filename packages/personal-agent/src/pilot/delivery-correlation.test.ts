// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { type ConversationState, openConversation, transition } from "./core/conversation.js";
import { DEFAULT_LIMITS } from "./core/limits.js";
import type { AnyMessage, Basis, DeliverBody, OperationRef } from "./core/types.js";
import { CDS_SUBSET, ENERGY_PLANS_OP, RetailerPlansHandler } from "./domains/energy.js";
import { publicServiceMandate, SOUTHERN, SOUTHERN_PLANS, WATTLE } from "./fixtures/energy.js";
import { CONFIG_PUBLIC } from "./profile/configurations.js";
import type { OperationHandler } from "./runtime/operations.js";
import { Cast, craftSigned } from "./scenarios/common.js";

const at = "2026-10-19T08:00:00Z";
const operation = { id: "urn:operation", version: "1" };
const other = { id: "urn:transfer", version: "2" };
const message = (kind: string, id: string, body: object) =>
  ({
    id,
    conversation: "urn:conversation",
    kind,
    configuration: CONFIG_PUBLIC,
    body,
  }) as AnyMessage;

function apply(
  state: ConversationState,
  kind: string,
  id: string,
  body: object,
  direction: "in" | "out",
) {
  const result = transition(
    state,
    { type: "message", message: message(kind, id, body), direction, at },
    DEFAULT_LIMITS,
  );
  if (!result.ok) throw new Error(result.detail);
  return result.state;
}

function requested(mode: "public" | "represented" | "grant" | "agreement" | "transfer") {
  let state = openConversation({
    id: "urn:conversation",
    role: "initiator",
    peer: { actor: "urn:peer" },
    at,
  });
  if (mode === "agreement" || mode === "transfer") {
    state = apply(
      state,
      "propose",
      "urn:proposal",
      { operation, terms: {}, termsDigest: "digest", round: 1 },
      "out",
    );
    state = apply(
      state,
      "accept",
      "urn:acceptance",
      { proposal: "urn:proposal", termsDigest: "digest", agreement: "urn:agreement" },
      "in",
    );
    if (mode === "agreement")
      return {
        state,
        ref: "urn:agreement",
        operation,
        basis: { kind: "agreement", agreement: "urn:agreement" } as Basis,
      };
  }
  const basis: Basis =
    mode === "transfer"
      ? { kind: "agreement", agreement: "urn:agreement" }
      : mode === "grant"
        ? { kind: "grant", grant: "urn:grant" }
        : { kind: mode as "public" | "represented" };
  const op = mode === "transfer" ? other : operation;
  state = apply(state, "invoke", "urn:invocation", { operation: op, basis, input: {} }, "out");
  return {
    state,
    ref: "urn:invocation",
    operation: op,
    basis:
      mode === "transfer" ? basis : ({ kind: "invocation", invocation: "urn:invocation" } as Basis),
  };
}

describe.each([
  "public",
  "represented",
  "grant",
  "agreement",
  "transfer",
] as const)("delivery correlation for %s requests", (mode) => {
  it("validates the operation, version, reference, basis and direction before changing state", () => {
    const request = requested(mode);
    const valid: DeliverBody = {
      ref: request.ref,
      operation: request.operation,
      basis: request.basis,
      output: {},
    };
    const before = structuredClone(request.state);
    for (const changed of [
      { operation: { ...valid.operation, id: "urn:unrequested" } },
      { operation: { ...valid.operation, version: "unrequested" } },
      { ref: "urn:unrequested" },
      { basis: { kind: "public" } },
      { basis: { kind: "represented" } },
      { basis: { kind: "grant", grant: "urn:grant" } },
      { basis: { kind: "invocation", invocation: "urn:wrong" } },
      { basis: { kind: "agreement", agreement: "urn:wrong" } },
    ]) {
      expect(
        transition(
          request.state,
          {
            type: "message",
            direction: "in",
            at,
            message: message("deliver", "urn:delivery", { ...valid, ...changed }),
          },
          DEFAULT_LIMITS,
        ),
      ).toMatchObject({ ok: false, reason: "protocol-violation" });
      expect(request.state).toEqual(before);
    }
    expect(
      transition(
        request.state,
        {
          type: "message",
          direction: "out",
          at,
          message: message("deliver", "urn:own-delivery", valid),
        },
        DEFAULT_LIMITS,
      ).ok,
    ).toBe(false);
    const accepted = apply(request.state, "deliver", "urn:delivery", valid, "in");
    expect(accepted.phase).toBe(
      mode === "agreement" || mode === "transfer" ? "agreed" : "completed",
    );
    expect(
      transition(
        accepted,
        {
          type: "message",
          direction: "in",
          at,
          message: message("deliver", "urn:duplicate-delivery", valid),
        },
        DEFAULT_LIMITS,
      ).ok,
    ).toBe(false);
    const { requests: _unverifiable, ...legacy } = request.state;
    expect(
      transition(
        legacy,
        {
          type: "message",
          direction: "in",
          at,
          message: message("deliver", "urn:legacy-delivery", valid),
        },
        DEFAULT_LIMITS,
      ).ok,
    ).toBe(false);
  });
});

it("rejects signed, miscorrelated deliveries before committing state or dispatching either handler", async () => {
  const cast = new Cast(() => new Date(at));
  await cast.add(WATTLE, publicServiceMandate(), [ENERGY_PLANS_OP.id]);
  await cast.add(SOUTHERN, publicServiceMandate(), [ENERGY_PLANS_OP.id]);
  cast.pin(WATTLE.name, SOUTHERN.name);
  const onExpected = vi.fn(() => ({ type: "none" as const }));
  const onOther = vi.fn(() => ({ type: "none" as const }));
  const description = new RetailerPlansHandler(SOUTHERN.party, SOUTHERN_PLANS).description;
  const otherOperation: OperationRef = { id: "urn:unrequested-handler", version: "2" };
  const handlers: OperationHandler[] = [
    { description, requiresRepresentation: false, onDeliver: onExpected },
    {
      description: { ...description, ...otherOperation },
      requiresRepresentation: false,
      onDeliver: onOther,
    },
  ];
  const { runtime: client } = await cast.runtime(WATTLE.name, handlers, [], [CONFIG_PUBLIC]);
  const { runtime: service } = await cast.runtime(
    SOUTHERN.name,
    [new RetailerPlansHandler(SOUTHERN.party, SOUTHERN_PLANS)],
    [],
    [CONFIG_PUBLIC],
  );
  const started = await client.startInvocation({
    peer: { actor: SOUTHERN.actor, party: SOUTHERN.party },
    operation: ENERGY_PLANS_OP,
    input: { fuelType: "ELECTRICITY", effective: "CURRENT" },
    basis: { kind: "public" },
    models: [CDS_SUBSET],
    configuration: CONFIG_PUBLIC,
    discover: false,
  });
  const invocation = started.outbound[0];
  if (!invocation) throw new Error("missing invocation");
  const response = (await service.receive(invocation.wire)).outbound[0];
  if (response?.message.kind !== "deliver") throw new Error("missing delivery");
  const before = structuredClone(client.conversation(invocation.message.conversation));
  const bad = [
    { operation: otherOperation },
    { operation: { ...ENERGY_PLANS_OP, version: "999" } },
    { ref: "urn:wrong-ref" },
    { basis: { kind: "invocation", invocation: "urn:wrong-invocation" } },
    { basis: { kind: "agreement", agreement: "urn:wrong-agreement" } },
  ];
  for (const [i, change] of bad.entries()) {
    const wire = await craftSigned(cast.get(SOUTHERN.name), {
      ...response.message,
      id: `urn:bad-delivery:${i}`,
      body: { ...response.message.body, ...change },
    });
    const result = await client.receive(wire);
    expect(result.disposition).toBe("rejected");
    expect(result.reason).toBe("protocol-violation");
    expect(client.conversation(invocation.message.conversation)).toEqual(before);
    expect(onExpected).not.toHaveBeenCalled();
    expect(onOther).not.toHaveBeenCalled();
  }
  expect((await client.receive(response.wire)).disposition).toBe("accepted");
  expect(client.conversation(invocation.message.conversation)?.phase).toBe("completed");
  expect(onExpected).toHaveBeenCalledTimes(1);
  expect(onOther).not.toHaveBeenCalled();
});
