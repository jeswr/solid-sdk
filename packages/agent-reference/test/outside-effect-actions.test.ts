// AUTHORED-BY Codex GPT-6
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import type { ActionIntent } from "../src/core/types.js";
import { GateMemory } from "../src/gates/common.js";
import { OutboundGate } from "../src/gates/outbound.js";
import { evaluateItemTerms } from "../src/gates/quality.js";
import { evaluateIntent, type LoadedMandate } from "../src/mechanisms/mandate.js";
import { solidOdrlEngine } from "../src/mechanisms/policy-engine.js";

const at = "2026-11-13T09:00:00.000Z";
// Independent cases from CORE-OUT-2a: deleting an action from the adapter must not
// delete its refusal tests as well.
const externalActions = ["distribute", "transfer", "compensate", "pay"] as const;
const agent = "urn:test:agent",
  target = "urn:test:operation",
  purpose = "urn:test:purpose";
const policy = (action: string): OdrlPolicy => ({
  id: "urn:test:policy",
  permissions: [
    {
      type: "permission",
      action: action as "use",
      target,
      constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: purpose }],
    },
  ],
});
const loaded = (autonomous: OdrlPolicy): LoadedMandate => {
  const mandate = {
    type: "OwnerMandate" as const,
    id: "urn:test:mandate",
    version: 1,
    issuer: "urn:test:owner",
    subject: agent,
    validFrom: "2026-11-01T00:00:00.000Z",
    validUntil: "2026-12-01T00:00:00.000Z",
    autonomous,
    withApproval: { id: "urn:test:with-approval" },
  };
  return {
    mandate,
    digest: digestOf(mandate),
    verification: {
      type: "verification",
      protectedObject: mandate.id,
      property: "integrity-and-key-attribution",
      mechanism: "test",
      verifier: agent,
      at,
      outcome: "valid",
      limitations: [],
    },
  };
};
for (const action of ["use", "read", ...externalActions])
  it(`requires an exact mandate permission for ${action} when it has an outside effect`, () => {
    const m = loaded(policy("use"));
    const intent: ActionIntent = {
      action,
      target,
      operation: target,
      conversation: "urn:test:conversation",
      purpose,
      parameters: {},
    };
    const decision = evaluateIntent({ loaded: m, intent, decider: agent, at });
    expect(decision.outcome).toBe(action === "use" || action === "read" ? "permit" : "deny");
    if (["distribute", "transfer"].includes(action)) {
      const gate = new OutboundGate({
        identity: { actor: agent },
        now: () => at,
        mandate: () => m.mandate,
        gate: {},
        memory: new GateMemory(),
        isReplyTo: () => true,
        offerTerms: () => undefined,
      });
      const released = gate.release(intent, decision);
      expect(released.outcome).toBe("stop");
      expect(released.verdicts).toContainEqual(
        expect.objectContaining({ check: "mandate", verdict: "fail", reason: "not-authorised" }),
      );
    }
  });
for (const action of externalActions)
  it(`named ${action} permits its effect and broad prohibitions still stop it in mandates and terms`, () => {
    const p = policy(action);
    const intent: ActionIntent = {
      action,
      target,
      operation: target,
      conversation: "urn:test:conversation",
      purpose,
      parameters: {},
    };
    expect(evaluateIntent({ loaded: loaded(p), intent, decider: agent, at }).outcome).toBe(
      "permit",
    );
    const need = {
      agent,
      action,
      target,
      purpose,
      at,
    };
    expect(evaluateItemTerms({ policy: p }, need).verdict).toBe("pass");
    expect(evaluateItemTerms({ policy: policy("use") }, need)).toMatchObject({
      verdict: "fail",
      reason: "not-authorised",
    });
    expect(evaluateItemTerms(undefined, need).verdict).toBe("fail");
    const prohibited = {
      ...p,
      prohibitions: [{ type: "prohibition" as const, action: "use" as const, target }],
    };
    expect(
      evaluateIntent({ loaded: loaded(prohibited), intent, decider: agent, at }),
    ).toMatchObject({ outcome: "deny", reason: expect.stringContaining("prohibited") });
    expect(evaluateItemTerms({ policy: prohibited }, need)).toMatchObject({
      verdict: "fail",
      reason: "prohibited",
    });
  });
it("keeps use/read item terms and ignores context of general permissions that cannot grant an outside effect", () => {
  for (const action of ["use", "read"] as const)
    expect(
      evaluateItemTerms({ policy: policy("use") }, { agent, action, target, purpose, at }).verdict,
    ).toBe("pass");
  expect(
    solidOdrlEngine.evaluate(policy("use"), { agent, action: "distribute", target, at }).effect,
  ).toBe("not-applicable");
});

it("preserves named permission constraints without falling back to a general grant", () => {
  const named = policy("distribute");
  const p: OdrlPolicy = {
    ...named,
    permissions: [
      ...policy("use").permissions!,
      ...named.permissions!.map((r) => ({
        ...r,
        constraints: [
          {
            leftOperand: "purpose" as const,
            operator: "eq" as const,
            rightOperand: "urn:test:other-purpose",
          },
        ],
      })),
    ],
  };
  const request = { agent, action: "distribute", target, purpose, at };
  expect(solidOdrlEngine.evaluate(p, request).effect).toBe("not-applicable");
  expect(
    solidOdrlEngine.evaluate(p, { ...request, purpose: "urn:test:other-purpose" }).effect,
  ).toBe("permit");
  expect(
    solidOdrlEngine.evaluate(p, {
      ...request,
      target: "urn:test:other-target",
      purpose: "urn:test:other-purpose",
    }).effect,
  ).toBe("not-applicable");
});

it("requires approval for an explicitly approval-bound effect despite an autonomous general grant", () => {
  const base = loaded(policy("use"));
  const mandate = { ...base.mandate, withApproval: policy("distribute") };
  expect(
    evaluateIntent({
      loaded: { ...base, mandate, digest: digestOf(mandate) },
      intent: {
        action: "distribute",
        operation: target,
        target,
        conversation: "urn:test:conversation",
        purpose,
        parameters: {},
      },
      decider: agent,
      at,
    }).outcome,
  ).toBe("approval-required");
});
