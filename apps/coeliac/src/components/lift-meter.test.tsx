// AUTHORED-BY Claude Sonnet 5
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PATTERN_NOT_DIAGNOSIS, type SuspicionScore } from "@/lib/inference/types";
import { LiftMeter } from "./lift-meter";

function suspicion(over: Partial<SuspicionScore> = {}): SuspicionScore {
  return {
    trigger: "lactose",
    lagWindowMin: 0.5,
    lagWindowMax: 6,
    exposureCount: 5,
    followedCount: 4,
    followedRate: 0.8,
    expectedRate: 0.2,
    lift: 4,
    attributedSymptomCount: 4,
    attributedWeight: 4,
    confoundedFraction: 0,
    confounded: false,
    confounders: [],
    confidence: "likely",
    rankScore: 3.2,
    evidence: [],
    disclaimer: PATTERN_NOT_DIAGNOSIS,
    ...over,
  };
}

describe("LiftMeter", () => {
  it("renders the lift as a compact meter, not a raw number dump", () => {
    render(<LiftMeter suspicion={suspicion()} />);
    expect(screen.getByText("4.0×")).toBeInTheDocument();
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "4");
    expect(screen.getByText(/80% of exposures followed/i)).toBeInTheDocument();
    // Explicitly disclaims being a probability — never framed as certainty.
    expect(screen.getByText(/not a probability/i)).toBeInTheDocument();
  });

  it("shows an honest 'not enough data' state when lift is undefined", () => {
    render(<LiftMeter suspicion={suspicion({ lift: undefined })} />);
    expect(screen.getByText(/not enough data yet/i)).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });

  it("clamps an extreme lift to the visual cap without misreporting the figure", () => {
    render(<LiftMeter suspicion={suspicion({ lift: 40 })} />);
    // The exact figure is still shown…
    expect(screen.getByText("40.0×")).toBeInTheDocument();
    // …but the meter fill/aria-valuenow never exceeds the visual cap.
    const meter = screen.getByRole("meter");
    expect(Number(meter.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(5);
    expect(meter).toHaveAttribute("aria-valuemax", "5");
  });
});
