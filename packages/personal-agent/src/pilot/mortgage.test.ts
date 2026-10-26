import { describe, expect, it } from "vitest";
import { runMortgage } from "./scenarios/mortgage.js";
import { fixedClock } from "./scenarios/personal.js";

describe("UC-01 mortgage workflow on the shared runtime", () => {
  it("runs consumer → lender → internal PEP → underwriter → consumer with real checks", async () => {
    const clock = fixedClock("2026-10-05T09:00:00Z");
    const { obs } = await runMortgage(clock);
    // Model mismatch with Valley Bank is explicit, not silently mapped.
    expect(obs.valley).toEqual({ phase: "unsupported", reason: "unsupported-term" });
    // Disclosure needs Sam's approval of the exact terms; a different-terms approval does not count.
    expect(obs.pendingApproval).toEqual([
      {
        action: "distribute",
        target: "https://w3id.org/jeswr/awp#op/evidence-disclosure",
        recipient: "https://northbank.example/#org",
        purpose: "https://example.org/awp-fixture#CreditChecking",
      },
    ]);
    expect(obs.staleApprovalReleased).toBe(false);
    // Intake: valid payroll + deposit accepted; valuer-signed income not authoritative; tampered copy invalid.
    const checked = (obs.intakeReceipt as { checked: Array<Record<string, unknown>> }).checked;
    const byId = Object.fromEntries(checked.map((c) => [String(c.id ?? c.protectedObject), c]));
    expect(byId["urn:awp:evidence:payroll-2026-09"]?.accepted).toBe(true);
    expect(byId["urn:awp:evidence:deposit-2026-09"]?.accepted).toBe(true);
    expect(byId["urn:awp:evidence:valuer-income"]?.sourceAuthority).toBe("not-accepted");
    expect(checked.filter((c) => c.integrity === "invalid")).toHaveLength(1);
    expect(
      (obs.intakeReceipt as { derived: { annualGrossIncome: number } }).derived.annualGrossIncome,
    ).toBe(90000);
    // Purpose-limited internal use.
    expect(obs.pep).toEqual({
      assessment: "permit",
      marketing: { decision: "deny", reason: expect.stringMatching(/prohibition/i) },
      marketingRelabelled: {
        decision: "deny",
        reason: expect.stringMatching(/internal delegation/),
      },
      brokerOnward: "deny",
      underwriterOnward: "permit",
    });
    expect(obs.underwriting).toEqual({
      lenderPhase: "completed",
      underwriterPhase: "completed",
      result: "pass",
      sourceAuthority: "accepted",
    });
    expect(obs.finalState).toEqual({
      samPhase: "completed",
      lenderPhase: "completed",
      decided: "indicatively-eligible",
    });
    expect(obs.valuation).toEqual({
      underSchedulingOnlyMandate: "deny",
      samDecisionBeforeApproval: "approval-required",
      instruction: "submitted",
      settlement: "unknown",
      fulfilmentConclusion: "unresolved",
      samPhase: "completed",
    });
    expect(obs.afterRetention).toBe("deny");
    expect(obs.ledgers).toEqual({
      sam: true,
      northbank: true,
      underwriter: true,
      northbankPep: true,
    });
  });
});
