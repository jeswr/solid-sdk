// AUTHORED-BY Claude Sonnet 5
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EvidencePairing } from "@/lib/inference/types";
import { EvidenceDrilldown } from "./evidence-drilldown";

function pairing(over: Partial<EvidencePairing> = {}): EvidencePairing {
  return {
    mealId: "https://alice.example/meals/1.ttl",
    ingestedAt: new Date("2026-01-01T08:00:00.000Z"),
    exposureLevel: "present",
    derivedFrom: [],
    symptoms: [
      {
        symptomId: "https://alice.example/symptoms/1.ttl",
        symptomType: "bloating",
        onset: new Date("2026-01-01T10:00:00.000Z"),
        severity: 6,
        lagHours: 2,
      },
    ],
    coPresentTriggers: [],
    ...over,
  };
}

describe("EvidenceDrilldown", () => {
  it("renders nothing when there is no evidence", () => {
    const { container } = render(<EvidenceDrilldown evidence={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is a collapsed disclosure naming the exposure count, expandable to the tap-through detail", () => {
    render(<EvidenceDrilldown evidence={[pairing(), pairing({ mealId: "https://alice.example/meals/2.ttl" })]} />);
    const details = screen.getByText(/see the 2 matched exposures/i).closest("details");
    expect(details).not.toBeNull();
    // Not shown as an expanded modal — a plain <details> is closed by default.
    expect(details).not.toHaveAttribute("open");
    // The tap-through detail is present in the DOM (a native <details> keeps its
    // content in the accessibility tree; visibility is CSS-driven).
    expect(screen.getAllByText(/bloating/i).length).toBe(2);
    expect(screen.getAllByText(/2\.0h later/i).length).toBe(2);
  });

  it("surfaces co-present confounders per pairing", () => {
    render(<EvidenceDrilldown evidence={[pairing({ coPresentTriggers: ["sulphites"] })]} />);
    expect(screen.getByText(/also present in this window: Sulphites/i)).toBeInTheDocument();
  });

  it("labels each exposure level honestly (never a bare tick)", () => {
    render(<EvidenceDrilldown evidence={[pairing({ exposureLevel: "trace" })]} />);
    expect(screen.getByText(/may contain \(traces\)/i)).toBeInTheDocument();
  });
});
