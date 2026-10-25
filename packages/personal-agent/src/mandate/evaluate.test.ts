// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { describe, expect, it } from "vitest";
import type { ActionProposal } from "../pod/proposals.js";
import { AGENTIC_PURPOSE_GENERAL, AGENTIC_PURPOSE_SCHEDULING } from "../vocab.js";
import { defaultAutonomyPolicy, withAutonomousScheduling } from "./default-mandate.js";
import { evaluateAutonomy } from "./evaluate.js";

const owner = "https://jeswr.org/#me";
const agent = "https://jeswr.org/agent#it";

function proposal(over: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "p1",
    channel: "email",
    recipient: "alice@example.com",
    odrlAction: "distribute",
    purpose: AGENTIC_PURPOSE_SCHEDULING,
    spend: 0,
    status: "pending",
    friction: "low",
    bodyText: "hi",
    proposedAt: "2026-07-06T00:00:00Z",
    inReplyTo: "urn:agentic:raw:abc",
    ...over,
  };
}

const base = defaultAutonomyPolicy({ ownerWebId: owner, agentWebId: agent });
const loose = withAutonomousScheduling(base);

describe("evaluateAutonomy — the ODRL enforcement decision", () => {
  it("PERMIT: an autonomous scheduling reply under the loosened mandate", () => {
    const verdict = evaluateAutonomy(loose, proposal(), { agentWebId: agent });
    expect(verdict.decision).toBe("permit");
    expect(verdict.permit?.action).toBe("distribute");
  });

  it("CONFIRM-REQUIRED: the safe default mandate has no autonomous-send permit", () => {
    expect(evaluateAutonomy(base, proposal(), { agentWebId: agent }).decision).toBe(
      "confirm-required",
    );
  });

  it("CONFIRM-REQUIRED: an intent that LOOKS permitted but misses the purpose constraint", () => {
    // The LLM could craft a `distribute` intent hoping to ride the scheduling permit — but a
    // different purpose fails the constraint, so it is denied autonomy (deny-by-default).
    const verdict = evaluateAutonomy(loose, proposal({ purpose: AGENTIC_PURPOSE_GENERAL }), {
      agentWebId: agent,
    });
    expect(verdict.decision).toBe("confirm-required");
  });

  it("CONFIRM-REQUIRED: a nonzero spend fails the count constraint", () => {
    expect(evaluateAutonomy(loose, proposal({ spend: 5 }), { agentWebId: agent }).decision).toBe(
      "confirm-required",
    );
  });

  it("CONFIRM-REQUIRED: no purpose asserted → the purpose constraint is unsatisfied (fail-closed)", () => {
    const verdict = evaluateAutonomy(loose, proposal({ purpose: undefined }), {
      agentWebId: agent,
    });
    expect(verdict.decision).toBe("confirm-required");
  });

  it("PROHIBITED: an explicit ODRL prohibition blocks even a matching permit", () => {
    const prohibited: OdrlPolicy = {
      ...loose,
      prohibitions: [
        { type: "prohibition", action: "distribute", assigner: owner, assignee: agent },
      ],
    };
    expect(evaluateAutonomy(prohibited, proposal(), { agentWebId: agent }).decision).toBe(
      "prohibited",
    );
  });

  it("CONFIRM-REQUIRED: a permit contingent on an unfulfilled duty of owner-confirmation", () => {
    const withDuty: OdrlPolicy = {
      ...base,
      permissions: [
        ...(base.permissions ?? []),
        {
          type: "permission",
          action: "distribute",
          assigner: owner,
          assignee: agent,
          constraints: [
            {
              leftOperand: "purpose",
              operator: "isAnyOf",
              rightOperand: [AGENTIC_PURPOSE_SCHEDULING],
            },
          ],
          duties: [{ action: "inform" }],
        },
      ],
    };
    const verdict = evaluateAutonomy(withDuty, proposal(), { agentWebId: agent });
    expect(verdict.decision).toBe("confirm-required");
    expect(verdict.outstandingDuties.length).toBeGreaterThan(0);
  });
});
