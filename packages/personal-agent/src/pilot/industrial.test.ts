import { describe, expect, it } from "vitest";
import { runIndustrial } from "./scenarios/industrial.js";
import { fixedClock } from "./scenarios/personal.js";

describe("UC-05 industrial purpose / contract / transfer separation", () => {
  it("keeps eligibility, delegation, agreement, transfer, recommendation and performance separate", async () => {
    const { obs } = await runIndustrial(fixedClock("2026-10-05T09:00:00Z"));
    expect(obs.authorisationForUnlistedRecipient).toEqual({
      phase: "refused",
      reason: "not-authorised",
    });
    expect(obs.authorisationForNordWerk).toEqual({
      phase: "completed",
      reason: "delivered",
      issued: true,
    });
    expect(obs.withoutCredential).toEqual({
      phase: "unsupported",
      reason: "unsupported-operation",
    });
    expect(obs.contractByDiagnosticAgent).toEqual({
      phase: "refused",
      reason: "representation-out-of-scope",
    });
    expect(obs.purposeMismatch).toEqual({ phase: "refused", reason: "purpose-not-permitted" });
    expect(obs.transferBeforeAgreement).toEqual({
      initiator: "no-agreement",
      holderReply: "refuse",
      holderReason: "no-agreement",
      transfersPerformed: 0,
    });
    expect(obs.agreement).toMatchObject({ phase: "agreed", sameOnBothSides: true });
    expect(obs.afterFailedTransfer).toEqual({ phase: "agreed", reason: undefined, delivered: 0 });
    expect(obs.transfer).toEqual({
      attempts: ["not-executed", "delivered"],
      consumerPhase: "completed",
      holderPhase: "completed",
      duplicate: "duplicate",
      sourceAuthority: "accepted",
    });
    expect(obs.usage).toEqual({
      diagnosticRead: "permit",
      productDevelopmentRead: "deny",
      redistribution: "deny",
    });
    expect(obs.diagnosis).toMatchObject({ risk: "high" });
    expect(obs.recommendation).toEqual({
      alpinePhase: "completed",
      nordwerkPhase: "completed",
      workOrder: "open",
    });
    expect(obs.performance).toBe("completed-synthetic");
    expect(obs.ledgers).toBe(true);
  });
});
