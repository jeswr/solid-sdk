import { vocab } from "@jeswr/agentic-legacy-bridge";
import { describe, expect, it } from "vitest";
import { deriveProposals } from "./derive.js";
import type { ReadInterpretation } from "./interpretations.js";

const context = {
  inbound: { senderEmail: "alice@example.com", rawAnchor: "urn:message:1" },
  idPrefix: "p1",
  now: new Date("2026-10-25T10:00:00Z"),
};
function datum(overrides: Partial<ReadInterpretation> = {}): ReadInterpretation {
  return {
    node: "urn:interpretation:1",
    method: vocab.AGENTIC_DETERMINISTIC,
    confidence: 0.99,
    calibration: vocab.AGENTIC_CALIBRATED,
    assertsPredicate: vocab.SCHEMA_START_TIME,
    assertsObjectLiteral: "2026-10-26T10:00:00Z",
    ...overrides,
  };
}

describe("deriveProposals reliability gate", () => {
  it.each([
    vocab.AGENTIC_CALIBRATED,
    vocab.AGENTIC_VERIFIED,
  ])("permits autonomy for high-confidence %s metadata", (calibration) => {
    const proposals = deriveProposals([datum({ calibration })], context);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.confirmationRequired).toBeUndefined();
  });

  it.each([
    undefined,
    vocab.AGENTIC_SELF_REPORTED,
    "urn:unknown-calibration",
  ])("requires confirmation for high-confidence metadata with calibration %s", (calibration) => {
    const proposals = deriveProposals([datum({ calibration })], context);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.confirmationRequired).toBe(true);
  });

  it("requires confirmation when any offered time needs it", () => {
    const proposals = deriveProposals(
      [
        datum(),
        datum({
          calibration: vocab.AGENTIC_SELF_REPORTED,
          assertsObjectLiteral: "2026-10-27T10:00:00Z",
        }),
      ],
      context,
    );
    expect(proposals[0]?.offeredTimes).toHaveLength(2);
    expect(proposals[0]?.confirmationRequired).toBe(true);
  });

  it("keeps the bridge's thresholds when a caller lowers the confidence filter", () => {
    expect(
      deriveProposals([datum({ confidence: 0.6 })], { ...context, minConfidence: 0.1 })[0]
        ?.confirmationRequired,
    ).toBe(true);
    expect(
      deriveProposals([datum({ confidence: 0.2 })], { ...context, minConfidence: 0.1 }),
    ).toEqual([]);
  });

  it("never grants autonomy to a security-bearing interpretation", () => {
    expect(
      deriveProposals([datum({ securityBearing: true })], context)[0]?.confirmationRequired,
    ).toBe(true);
  });
});
