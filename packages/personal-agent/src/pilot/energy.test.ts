import { describe, expect, it } from "vitest";
import { runEnergy } from "./scenarios/energy.js";
import { fixedClock } from "./scenarios/personal.js";

describe("UC-03 anonymous public energy-plan comparison", () => {
  it("compares signed public plan data without any requester identity", async () => {
    const { obs } = await runEnergy(fixedClock("2026-10-05T09:00:00Z").now);
    expect(obs.outcomes).toEqual({
      "southern-current": { phase: "completed", reason: "delivered" },
      "harbour-light": { phase: "completed", reason: "delivered" },
      "gated-power": { phase: "refused", reason: "credentials-required" },
      "oldschema-energy": { phase: "unsupported", reason: "unsupported-term" },
    });
    expect(obs.identityFreeRequests).toBe(true);
    expect(obs.comparatorRequests).toBeGreaterThanOrEqual(7);
    expect(obs.serviceRepresentationChecks).toBe(0);
    expect(obs.serviceAuthorisationDecisions).toBe(0);
    expect(obs.effects).toBe(0);
    expect(obs.rejected.map((r) => r.planId)).toEqual(["HL-BROKEN-1"]);
    expect(obs.excluded.map((e) => `${e.planId}:${e.reason.split(";")[0]}`)).toEqual([
      "SC-SOLAR-1:eligibility (distributor geography) missing",
      "HL-FLAT-3:conflicting versions of the same plan id",
      "HL-FLAT-3:conflicting versions of the same plan id",
    ]);
    // Hand-checked: 13.0 kWh/day × 365. HL-FLAT-2 = 125c×365 + 4745 kWh×26.9c×0.97 = $1,694.36;
    // SC-BASIC-1 = 110c×365 + 4745×28.5c = $1,753.83; SC-TOU-1 = 120c×365 + 370c/day×365 = $1,788.50.
    expect(obs.ranked.map((r) => [r.planId, r.estimateAudPerYear])).toEqual([
      ["HL-FLAT-2", 1694.36],
      ["SC-BASIC-1", 1753.83],
      ["SC-TOU-1", 1788.5],
    ]);
    expect(obs.ranked[1]?.conditionalReductions[0]?.condition).toBe("PAY_ON_TIME");
    expect(obs.deterministic).toBe(true);
    expect(obs.citationsComplete).toBe(true);
    expect(obs.ledgers).toBe(true);
  });
});
