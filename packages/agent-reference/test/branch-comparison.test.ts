// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { continuedReleaseProblem, firstBranchDivergence } from "../src/engine/compare.js";
import type { TraceEvent } from "../src/trace/types.js";

function decision(reason = "approval-required", seq = 1): TraceEvent {
  return {
    seq,
    step: 1,
    agent: "agent",
    part: "outbound-gate",
    kind: "decision",
    check: "limits-approval",
    outcome: "ask-principal",
    reason,
    caption: "Decision.",
  };
}
it("skips shared approval and judges the first different decision", () => {
  const changed = decision("not-authorised", 2);
  expect(firstBranchDivergence([decision()], [decision(), changed])).toEqual(changed);
});
it("does not skip a different reason at the same check", () => {
  const changed = decision("context-not-clear");
  expect(firstBranchDivergence([decision()], [changed])).toEqual(changed);
});
it("consumes matches so an additional repetition diverges", () => {
  expect(
    firstBranchDivergence([decision()], [decision(), decision("approval-required", 2)])?.seq,
  ).toBe(2);
});
it("reports no divergence when every non-pass decision matches", () => {
  expect(firstBranchDivergence([decision()], [decision()])).toBeUndefined();
});

it("detects an earlier successful decision changed before the expected stop", () => {
  const first = { ...decision("within-mandate"), outcome: "go" as const };
  const changed = { ...first, agent: "another-agent" };
  expect(firstBranchDivergence([first, decision()], [changed, decision()])).toEqual(changed);
});

it("rejects the same stopped proposal even when expect.continues is set", () => {
  const actionScope = {
    action: "distribute",
    operation: "urn:operation",
    target: "urn:operation",
    conversation: "urn:conversation",
    recipient: "urn:recipient",
    purpose: "urn:purpose",
    evidence: ["urn:one", "urn:two"],
  };
  const stop = {
    ...decision("prohibited"),
    outcome: "stop" as const,
    actionDigest: "stopped",
    actionScope,
  };
  const release = {
    ...decision("released", 2),
    outcome: "go" as const,
    gateRun: 2,
    actionScope,
    actionDigest: "stopped",
  };
  expect(continuedReleaseProblem(stop, [release])).toBe(true);
  const store = { ...release, part: "memory" as const, kind: "store" as const };
  expect(continuedReleaseProblem(stop, [store])).toBe(true);
  expect(
    continuedReleaseProblem(stop, [
      {
        ...release,
        actionDigest: "narrower",
        actionScope: { ...actionScope, evidence: ["urn:one"] },
      },
    ]),
  ).toBe(false);
});
