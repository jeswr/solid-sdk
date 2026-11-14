// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import type { ActionIntent, AnyMessage } from "../src/core/types.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { checkApprovalRelease } from "../src/gates/approval-release.js";
import { actionDigest } from "../src/mechanisms/mandate.js";
import { ActionIntentNode, MessageNode } from "../src/model/message-nodes.js";
import { CONFIG_ED25519 } from "../src/profile/configurations.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { testKey } from "../src/reference/keys.js";
import { Cast, mandateOf, permit, signClaim } from "../src/scenarios/common.js";
import { TraceRecorder } from "../src/trace/recorder.js";
import { snapshotApprovalRelease } from "../src/wire/approval-release.js";
import * as authenticity from "../src/wire/authenticity.js";
import { type MessagePacket, packetDocumentDigest } from "../src/wire/message-packet.js";

const at = "2026-11-13T09:00:00.000Z";
const op = { id: "urn:test:approved-send", version: "0.1" };
const purpose = "urn:test:purpose";
const intent: ActionIntent = {
  operation: op.id,
  action: "use",
  target: op.id,
  purpose,
  recipient: "urn:test:recipient",
  conversation: "urn:test:conversation",
  parameters: { amount: 450 },
};
function acceptance(): AnyMessage {
  return {
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: "urn:test:accept",
    conversation: intent.conversation,
    kind: "accept",
    from: { actor: "urn:test:sender-agent", onBehalfOf: "urn:test:sender" },
    to: { actor: "urn:test:recipient-agent", party: intent.recipient },
    createdAt: at,
    expiresAt: "2026-11-13T10:00:00.000Z",
    body: {
      proposal: "urn:test:offer",
      termsDigest: digestOf({ amount: 450 }),
      agreement: "urn:test:agreement",
    },
  };
}
it.each([
  "intent",
  "terms",
  "carried intent",
])("stops an acceptance whose %s differs from the approval", async (attack) => {
  let message = acceptance();
  const changed = structuredClone(intent);
  if (attack === "intent") changed.parameters.amount = 495;
  if (attack === "terms" && message.kind === "accept")
    message = { ...message, body: { ...message.body, termsDigest: digestOf({ amount: 495 }) } };
  // Original signed mandate proof is tested by the payment-contract tests; this gate reads the carried intent.
  if (attack === "carried intent")
    message = {
      ...message,
      evidence: [
        {
          role: "credential",
          format: "jws-compact",
          value: await signClaim(await testKey("approval-parts"), {
            id: "urn:test:part",
            issuer: "urn:test:sender",
            subject: "urn:test:sender",
            claimType: "test",
            method: "recorded-by-authority",
            value: 1,
          }),
        },
        {
          role: "authorisation",
          format: "awp-action-intent/0.1",
          value: JSON.stringify({ ...intent, parameters: { amount: 495 } }),
        },
      ],
    };
  const recorder = new TraceRecorder();
  expect(
    checkApprovalRelease({
      message: MessageNode.toNode(message),
      intent: ActionIntentNode.toNode(changed),
      binding: {
        intentDigest: actionDigest(intent),
        kind: "accept",
        fields: { termsDigest: digestOf({ amount: 450 }) },
      },
      sink: recorder.sink("sender"),
    }),
  ).toBe(false);
  expect(recorder.events().at(-1)).toMatchObject({ outcome: "stop", reason: "approval-mismatch" });
});

it.each([
  false,
  true,
])("checks the actual prepared invocation before signing (tampered: %s)", async (tampered) => {
  const cast = new Cast(() => new Date(at));
  const sender = { name: "sender", actor: "urn:test:sender-agent", party: "urn:test:sender" };
  const recipient = {
    name: "recipient",
    actor: "urn:test:recipient-agent",
    party: "urn:test:recipient",
  };
  const mandate = mandateOf(
    "approval-release",
    [],
    [permit("use", op.id, [purpose], [recipient.party])],
  );
  await cast.add(sender, mandate, [op.id]);
  await cast.add(recipient, mandate, [op.id]);
  cast.introduce(sender.name, recipient.name);
  const handler = {
    requiresRepresentation: true,
    contentProfile: {
      vocabulary: { "input.amount": { type: "number" as const, values: [450, 495] } },
    },
    description: {
      ...op,
      label: "Approved request",
      pattern: "invoke" as const,
      access: "represented" as const,
      roles: ["initiator", "responder"] as const,
      models: [],
      effects: [],
      outcomes: [],
    },
    intentForInvoke: (
      ctx: { conversation: { id: string }; peer: { party?: string } },
      input: Record<string, unknown>,
    ) =>
      ({
        ...intent,
        conversation: ctx.conversation.id,
        recipient: ctx.peer.party,
        parameters: input,
      }) as ActionIntent,
  };
  const { runtime, ledger } = await cast.runtime(sender.name, [handler], [], [CONFIG_ED25519]);
  const held = await runtime.startInvocation({
    peer: { actor: recipient.actor, party: recipient.party },
    operation: op,
    input: { amount: 450 },
    basis: { kind: "public" },
    purpose,
    models: [],
    discover: false,
    configuration: CONFIG_ED25519,
  });
  const pending = held.pendingApproval!;
  expect(pending).toBeDefined();
  const original = MessageNode.toNode;
  const spy = vi.spyOn(MessageNode, "toNode").mockImplementation((...args) => {
    const object = args[0];
    if (tampered && object.kind === "invoke") {
      args[0] = { ...object, body: { ...object.body, input: { amount: 495 } } };
    }
    return original(...args);
  });
  const signing = vi.spyOn(authenticity, "sign");
  try {
    const result = await runtime.submitApproval(
      await cast.approval(sender.name, pending.actionDigest, pending.intent.conversation),
    );
    if (tampered) {
      expect(signing).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        disposition: "rejected",
        reason: "approval-mismatch",
        outbound: [],
      });
      expect(ledger.entries().some((entry) => entry.record.type === "message-out")).toBe(false);
    } else {
      expect(signing).toHaveBeenCalledTimes(1);
      expect(result.outbound).toHaveLength(1);
      const binding = ledger
        .entries()
        .find((entry) => entry.record.type === "message-out" && entry.record.approvalBinding);
      if (!binding) throw new Error("Missing approval message binding");
      expect(binding.record.approvalBinding).toMatchObject({
        approval: expect.any(String),
        message: result.outbound[0]!.id,
        messageDigest: expect.stringMatching(/^sha-256:/),
      });
      expect((binding.record.approvalBinding as { messageDigest: string }).messageDigest).toBe(
        await packetDocumentDigest(result.outbound[0]!.wire as MessagePacket, "jws"),
      );
    }
  } finally {
    signing.mockRestore();
    spy.mockRestore();
  }
});

it("binds an absent acceptance selection as well as its exact terms", () => {
  const message = acceptance();
  if (message.kind !== "accept") throw new Error("Expected acceptance fixture");
  const terms = { amount: 450 };
  const approved = { ...intent, parameters: { termsDigest: digestOf(terms) } };
  const binding = snapshotApprovalRelease(
    approved,
    { type: "reply", reply: { type: "accept", intent: approved } },
    { id: message.body.proposal, termsDigest: message.body.termsDigest },
    terms,
  );
  const check = (value: AnyMessage) =>
    checkApprovalRelease({
      message: MessageNode.toNode(value),
      intent: ActionIntentNode.toNode(approved),
      binding,
      termsDigest: digestOf(terms),
    });
  expect(check(message)).toBe(true);
  expect(check({ ...message, body: { ...message.body, selection: { changed: true } } })).toBe(
    false,
  );
});

it.each([
  "intent",
  "terms",
])("stops a paid mortgage acceptance with changed %s before the document signer", async (attack) => {
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, "mortgage-main");
  scenario.branches = [];
  scenario.stopAfter = "fee-accept-approved";
  scenario.result = undefined;
  let changedId: string | undefined;
  const original = MessageNode.toNode;
  const construction = vi.spyOn(MessageNode, "toNode").mockImplementation((...args) => {
    const message = args[0];
    if (
      message.kind === "accept" &&
      message.evidence?.some((e) => e.format === "awp-action-intent/0.1")
    ) {
      changedId = message.id;
      args[0] =
        attack === "terms"
          ? { ...message, body: { ...message.body, termsDigest: digestOf({ changed: true }) } }
          : {
              ...message,
              evidence: message.evidence.map((e) =>
                e.format === "awp-action-intent/0.1"
                  ? {
                      ...e,
                      value: JSON.stringify({
                        ...JSON.parse(e.value),
                        parameters: { termsDigest: digestOf({ changed: true }) },
                      }),
                    }
                  : e,
              ),
            };
    }
    return original(...args);
  });
  const signing = vi.spyOn(authenticity, "sign");
  try {
    const [path] = await runScenario(profile, scenario, { compare: false });
    expect(changedId).toBeDefined();
    expect(path?.trace?.events.findLast((e) => e.kind === "decision")).toMatchObject({
      outcome: "stop",
      reason: "approval-mismatch",
    });
    expect(signing.mock.calls.some(([document]) => document.id === changedId)).toBe(false);
    expect(path?.trace?.events.some((e) => e.caption.includes("records the ledger transfer"))).toBe(
      false,
    );
  } finally {
    construction.mockRestore();
    signing.mockRestore();
  }
}, 90_000);
