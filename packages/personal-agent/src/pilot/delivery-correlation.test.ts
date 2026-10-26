import { describe, expect, it, vi } from "vitest";
import { type ConversationState, openConversation, transition } from "./core/conversation.js";
import { DEFAULT_LIMITS } from "./core/limits.js";
import type { AnyMessage, Basis, DeliverBody, OperationRef } from "./core/types.js";
import { CDS_SUBSET, ENERGY_PLANS_OP, RetailerPlansHandler } from "./domains/energy.js";
import { publicServiceMandate, SOUTHERN, SOUTHERN_PLANS, WATTLE } from "./fixtures/energy.js";
import { CONFIG_ED25519, CONFIG_PUBLIC } from "./profile/configurations.js";
import type { OperationHandler } from "./runtime/operations.js";
import { Cast, craftSigned, mandateOf } from "./scenarios/common.js";

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
  agreementDelivery?: "offeror" | "acceptor",
) {
  const result = transition(
    state,
    { type: "message", message: message(kind, id, body), direction, at, agreementDelivery },
    DEFAULT_LIMITS,
  );
  if (!result.ok) throw new Error(result.detail);
  return result.state;
}

function agreed(agreementDelivery?: "offeror" | "acceptor", offerDirection: "in" | "out" = "out") {
  let state = openConversation({
    id: "urn:conversation",
    role: "initiator",
    peer: { actor: "urn:peer" },
    at,
  });
  state = apply(
    state,
    "propose",
    "urn:proposal",
    { operation, terms: {}, termsDigest: "digest", round: 1 },
    offerDirection,
  );
  return apply(
    state,
    "accept",
    "urn:acceptance",
    { proposal: "urn:proposal", termsDigest: "digest", agreement: "urn:agreement" },
    offerDirection === "out" ? "in" : "out",
    agreementDelivery,
  );
}

function requested(mode: "public" | "represented" | "grant" | "agreement" | "transfer") {
  let state =
    mode === "agreement" || mode === "transfer"
      ? agreed("acceptor")
      : openConversation({
          id: "urn:conversation",
          role: "initiator",
          peer: { actor: "urn:peer" },
          at,
        });
  if (mode === "agreement")
    return {
      state,
      ref: "urn:agreement",
      operation,
      basis: { kind: "agreement", agreement: "urn:agreement" } as Basis,
    };
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

it.each([
  ["offeror", "out"],
  ["offeror", "in"],
  ["acceptor", "out"],
  ["acceptor", "in"],
] as const)("correlates %s delivery when the offer is %sbound", (deliveryRole, offerDirection) => {
  const state = agreed(deliveryRole, offerDirection);
  const direction =
    deliveryRole === "offeror" ? offerDirection : offerDirection === "out" ? "in" : "out";
  const body: DeliverBody = {
    ref: "urn:agreement",
    operation,
    basis: { kind: "agreement", agreement: "urn:agreement" },
    output: {},
  };
  const before = structuredClone(state);
  for (const changed of [
    { operation: { ...operation, id: "urn:wrong" } },
    { operation: { ...operation, version: "wrong" } },
    { ref: "urn:wrong" },
    { basis: { kind: "agreement", agreement: "urn:wrong" } },
    { basis: { kind: "invocation", invocation: "urn:agreement" } },
  ]) {
    expect(
      transition(
        state,
        {
          type: "message",
          direction,
          at,
          message: message("deliver", "urn:bad-delivery", { ...body, ...changed }),
        },
        DEFAULT_LIMITS,
      ),
    ).toMatchObject({ ok: false, reason: "protocol-violation" });
    expect(state).toEqual(before);
  }
  expect(
    transition(
      state,
      {
        type: "message",
        direction: direction === "out" ? "in" : "out",
        at,
        message: message("deliver", "urn:wrong-direction", body),
      },
      DEFAULT_LIMITS,
    ),
  ).toMatchObject({ ok: false, reason: "protocol-violation" });
  const delivered = apply(state, "deliver", "urn:delivery", body, direction);
  expect(delivered.phase).toBe("agreed");
  expect(delivered.requests?.[body.ref]?.delivered).toBe(true);
  expect(
    transition(
      delivered,
      {
        type: "message",
        direction,
        at,
        message: message("deliver", "urn:duplicate-delivery", body),
      },
      DEFAULT_LIMITS,
    ),
  ).toMatchObject({ ok: false, reason: "protocol-violation" });
});

it("requires an explicit invocation when no direct agreement delivery obligation is declared", () => {
  const state = agreed();
  const body: DeliverBody = {
    ref: "urn:agreement",
    operation,
    basis: { kind: "agreement", agreement: "urn:agreement" },
    output: {},
  };
  for (const direction of ["in", "out"] as const) {
    expect(
      transition(
        state,
        {
          type: "message",
          direction,
          at,
          message: message("deliver", "urn:unrequested-delivery", body),
        },
        DEFAULT_LIMITS,
      ),
    ).toMatchObject({ ok: false, reason: "protocol-violation" });
  }
  const invoked = apply(
    state,
    "invoke",
    "urn:invocation",
    {
      operation,
      basis: body.basis,
      input: {},
    },
    "in",
  );
  expect(
    apply(
      invoked,
      "deliver",
      "urn:requested-delivery",
      {
        ...body,
        ref: "urn:invocation",
      },
      "out",
    ).requests?.["urn:invocation"]?.delivered,
  ).toBe(true);
});

it.each([
  "offeror",
  "acceptor",
] as const)("dispatches a signed direct delivery by the agreed %s", async (deliveryRole) => {
  const cast = new Cast(() => new Date(at));
  const mandate = mandateOf("delivery-test", [
    { type: "permission", action: "use", target: operation.id },
  ]);
  await cast.add(WATTLE, mandate, [operation.id]);
  await cast.add(SOUTHERN, mandate, [operation.id]);
  cast.introduce(WATTLE.name, SOUTHERN.name);
  const onDeliver = vi.fn<NonNullable<OperationHandler["onDeliver"]>>(() => ({ type: "none" }));
  const description = new RetailerPlansHandler(SOUTHERN.party, SOUTHERN_PLANS).description;
  const intent = {
    operation: operation.id,
    action: "use" as const,
    target: operation.id,
    parameters: {},
  };
  const handler: OperationHandler = {
    description: { ...description, ...operation, pattern: "negotiate" },
    requiresRepresentation: false,
    agreementDelivery: deliveryRole,
    intentForProposal: (ctx) => ({ ...intent, conversation: ctx.conversation.id }),
    onProposal: (ctx) => ({
      type: "accept",
      intent: { ...intent, conversation: ctx.conversation.id },
    }),
    onAgreement: (_ctx, agreement, role) => ({
      requiredOutcomes: [],
      messages:
        role === deliveryRole
          ? [
              {
                kind: "deliver",
                body: {
                  ref: agreement.id,
                  operation,
                  basis: { kind: "agreement", agreement: agreement.id },
                  output: { result: "agreed result" },
                },
              },
            ]
          : [],
    }),
    onDeliver,
  };
  const { runtime: offeror } = await cast.runtime(WATTLE.name, [handler]);
  const { runtime: acceptor } = await cast.runtime(SOUTHERN.name, [handler]);
  const started = await offeror.startNegotiation({
    peer: { actor: SOUTHERN.actor, party: SOUTHERN.party },
    operation,
    terms: {},
    models: [CDS_SUBSET],
    configuration: CONFIG_ED25519,
    discover: false,
  });
  const proposal = started.outbound[0];
  if (!proposal) throw new Error("missing proposal");
  const accepted = await acceptor.receive(proposal.wire);
  const acceptance = accepted.outbound.find((m) => m.message.kind === "accept");
  if (!acceptance) throw new Error("missing acceptance");
  const agreedResult = await offeror.receive(acceptance.wire);
  expect(agreedResult.disposition).toBe("accepted");
  const delivery = (deliveryRole === "offeror" ? agreedResult : accepted).outbound.find(
    (m) => m.message.kind === "deliver",
  );
  if (!delivery) throw new Error("missing delivery");
  const receiver = deliveryRole === "offeror" ? acceptor : offeror;
  const sender = cast.get(deliveryRole === "offeror" ? WATTLE.name : SOUTHERN.name);
  const before = structuredClone(receiver.conversation(delivery.message.conversation));
  for (const [i, change] of [
    { operation: { ...operation, id: "urn:unrequested" } },
    { operation: { ...operation, version: "unrequested" } },
    { ref: "urn:unrequested" },
    { basis: { kind: "agreement", agreement: "urn:wrong" } },
    { basis: { kind: "invocation", invocation: "urn:wrong" } },
  ].entries()) {
    const wire = await craftSigned(sender, {
      ...delivery.message,
      id: `urn:bad-delivery:${i}`,
      body: { ...delivery.message.body, ...change },
    });
    expect(await receiver.receive(wire)).toMatchObject({
      disposition: "rejected",
      reason: "protocol-violation",
    });
    expect(receiver.conversation(delivery.message.conversation)).toEqual(before);
    expect(onDeliver).not.toHaveBeenCalled();
  }
  expect((await receiver.receive(delivery.wire)).disposition).toBe("accepted");
  expect(onDeliver).toHaveBeenCalledTimes(1);
  expect(onDeliver.mock.calls[0]?.[1]).toMatchObject({
    operation,
    output: { result: "agreed result" },
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
