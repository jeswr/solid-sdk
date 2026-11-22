// AUTHORED-BY Codex GPT-6.2 Sol
import { expect, it } from "vitest";
import { GateMemory } from "../src/gates/common.js";
import { OutboundGate } from "../src/gates/outbound.js";
import { IntentScopeNode } from "../src/model/intent.js";
import { mandateOf } from "../src/scenarios/common.js";
import { BASELINE } from "../src/suites/baseline.js";

it("human approval cannot override an item-specific mandate prohibition", () => {
  const actor = "urn:agent",
    party = "urn:owner",
    item = "urn:statement:private";
  const at = "2026-11-20T12:00:00Z";
  const mandate = mandateOf(
    "scope",
    [],
    [],
    [{ type: "prohibition", action: "distribute", target: item }],
  )({ actor, owner: party, validFrom: at, validUntil: "2026-12-01T00:00:00Z" });
  const gate = new OutboundGate({
    identity: { actor, party },
    now: () => at,
    mandate: () => mandate,
    gate: {
      configuration: {
        ...BASELINE,
        layers: { ...BASELINE.layers, "usage-control": "human-approval" },
      },
    },
    memory: new GateMemory(),
    isReplyTo: () => true,
    offerTerms: () => undefined,
  });
  const scope = IntentScopeNode.fromIntent({
    action: "distribute",
    target: "urn:op:release",
    operation: "urn:op:release",
    recipient: "urn:other",
    purpose: "urn:purpose",
    conversation: "urn:conversation",
    parameters: { evidence: [item] },
  });
  const fact = { id: item, claimType: "private", source: party, label: "Private item" };
  expect(gate["principalUse"](fact, scope, false)).toMatchObject({
    verdict: "fail",
    reason: "prohibited",
  });
  expect(gate["principalUse"](fact, scope, true)).toMatchObject({
    verdict: "fail",
    reason: "prohibited",
  });
});
