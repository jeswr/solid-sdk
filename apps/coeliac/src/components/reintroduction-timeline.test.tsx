// AUTHORED-BY Claude Sonnet 5
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReintroductionSchedule } from "@/lib/inference/types";
import { ReintroductionTimeline } from "./reintroduction-timeline";

function schedule(over: Partial<ReintroductionSchedule> = {}): ReintroductionSchedule {
  return {
    protocolId: "https://alice.example/protocols/p.ttl",
    trigger: "lactose",
    washoutDays: 3,
    steps: [
      {
        step: 0,
        scheduledFor: new Date("2026-01-04T08:00:00.000Z"),
        observeUntil: new Date("2026-01-04T14:00:00.000Z"),
        dose: "small",
      },
      {
        step: 1,
        scheduledFor: new Date("2026-01-07T08:00:00.000Z"),
        observeUntil: new Date("2026-01-07T14:00:00.000Z"),
        dose: "moderate",
      },
    ],
    ...over,
  };
}

describe("ReintroductionTimeline", () => {
  it("renders the dose ladder as a timeline, not raw JSON", () => {
    render(<ReintroductionTimeline schedule={schedule()} />);
    expect(screen.getByText(/reintroduction schedule — Lactose/i)).toBeInTheDocument();
    expect(screen.getByText(/3 days of washout/i)).toBeInTheDocument();
    expect(screen.getByText("Small dose")).toBeInTheDocument();
    expect(screen.getByText("Moderate dose")).toBeInTheDocument();
    // Never a prescription.
    expect(screen.getByText(/not a prescription/i)).toBeInTheDocument();
  });

  it("renders nothing for an empty step list", () => {
    const { container } = render(<ReintroductionTimeline schedule={schedule({ steps: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("singularises a one-day washout", () => {
    render(<ReintroductionTimeline schedule={schedule({ washoutDays: 1 })} />);
    expect(screen.getByText(/1 day of washout/i)).toBeInTheDocument();
  });
});
