// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { ToleranceConclusionData, Verdict } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { surfaceReviews } from "./review";
import { atDays } from "./testUtils";

function conclusion(over: {
  id?: string;
  aboutTrigger: ToleranceConclusionData["aboutTrigger"];
  verdict: Verdict;
  reviewAfter?: Date;
}): ToleranceConclusionData {
  return {
    id: over.id ?? `https://pod.example/conclusions/${over.aboutTrigger}#it`,
    aboutTrigger: over.aboutTrigger,
    verdict: over.verdict,
    confidence: "confirmed",
    reviewAfter: over.reviewAfter,
  };
}

describe("surfaceReviews — time-boxed re-challenge (DESIGN §4.3, RESEARCH §2.2)", () => {
  const now = atDays(200);

  it("surfaces a reacts-exclusion whose reviewAfter has passed", () => {
    const due = surfaceReviews([conclusion({ aboutTrigger: "lactose", verdict: "reacts", reviewAfter: atDays(182) })], now);
    expect(due).toHaveLength(1);
    expect(due[0]!.trigger).toBe("lactose");
    expect(due[0]!.overdueDays).toBe(18);
    expect(due[0]!.message.toLowerCase()).toContain("re-test");
  });

  it("does NOT surface a future reviewAfter", () => {
    const due = surfaceReviews([conclusion({ aboutTrigger: "lactose", verdict: "reacts", reviewAfter: atDays(365) })], now);
    expect(due).toEqual([]);
  });

  it("does NOT surface a conclusion with no reviewAfter", () => {
    expect(surfaceReviews([conclusion({ aboutTrigger: "gluten", verdict: "reacts" })], now)).toEqual([]);
  });

  it("does NOT surface a TOLERATED verdict (nothing to re-expand)", () => {
    const due = surfaceReviews([conclusion({ aboutTrigger: "lactose", verdict: "tolerated", reviewAfter: atDays(1) })], now);
    expect(due).toEqual([]);
  });

  it("does NOT surface a non-CONFIRMED conclusion carrying a stray reviewAfter", () => {
    const notConfirmed: ToleranceConclusionData = {
      id: "https://pod.example/conclusions/lactose#it",
      aboutTrigger: "lactose",
      verdict: "reacts",
      confidence: "likely", // NOT confirmed — must not drive a re-challenge
      reviewAfter: atDays(1),
    };
    expect(surfaceReviews([notConfirmed], now)).toEqual([]);
  });

  it("orders most-overdue first", () => {
    const due = surfaceReviews(
      [
        conclusion({ aboutTrigger: "lactose", verdict: "reacts", reviewAfter: atDays(190) }),
        conclusion({ aboutTrigger: "fructose", verdict: "dose-dependent", reviewAfter: atDays(100) }),
      ],
      now,
    );
    expect(due.map((d) => d.trigger)).toEqual(["fructose", "lactose"]);
  });
});
