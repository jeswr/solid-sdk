// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { firstBranchDivergence } from "../src/engine/compare.js";
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
