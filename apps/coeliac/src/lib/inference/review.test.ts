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

  it("NEVER surfaces a lifelong exclusion (gluten) even with a stray past reviewAfter", () => {
    // Malformed / legacy / hand-authored data could put a reviewAfter on a gluten
    // conclusion; re-testing gluten in coeliac is dangerous, so it must be filtered out
    // regardless of the write path. (roborev HIGH regression guard.)
    const strayGluten = conclusion({ aboutTrigger: "gluten", verdict: "reacts", reviewAfter: atDays(1) });
    expect(surfaceReviews([strayGluten], now)).toEqual([]);
  });

  it("filters to the time-boxed set, keeping a due lactose while dropping a stray gluten", () => {
    const due = surfaceReviews(
      [
        conclusion({ aboutTrigger: "gluten", verdict: "reacts", reviewAfter: atDays(1) }),
        conclusion({ aboutTrigger: "lactose", verdict: "reacts", reviewAfter: atDays(182) }),
      ],
      now,
    );
    expect(due.map((d) => d.trigger)).toEqual(["lactose"]);
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

describe("surfaceReviews — latest-conclusion collapse (stale-guidance fix)", () => {
  const now = atDays(200);

  /** A conclusion with an explicit `created` recency + distinct id (the tie-break). */
  function dated(
    trigger: ToleranceConclusionData["aboutTrigger"],
    verdict: Verdict,
    createdDay: number,
    reviewAfter?: Date,
  ): ToleranceConclusionData {
    return {
      id: `https://pod.example/conclusions/${trigger}-${createdDay}#it`,
      aboutTrigger: trigger,
      verdict,
      confidence: "confirmed",
      reviewAfter,
      created: atDays(createdDay),
    };
  }

  it("does NOT re-surface a due reacts once a NEWER tolerated has superseded it", () => {
    const due = surfaceReviews(
      [
        dated("lactose", "reacts", 10, atDays(150)), // older, would be overdue
        dated("lactose", "tolerated", 160), // newer — the food is now tolerated
      ],
      now,
    );
    expect(due).toEqual([]);
  });

  it("a NEWER inconclusive does NOT suppress a due reacts prompt (reacts → inconclusive)", () => {
    const due = surfaceReviews(
      [
        dated("lactose", "reacts", 10, atDays(150)), // overdue exclusion
        dated("lactose", "inconclusive", 160), // aborted re-test — not settled
      ],
      now,
    );
    expect(due.map((d) => d.trigger)).toEqual(["lactose"]);
    expect(due[0]!.verdict).toBe("reacts");
  });

  it("still surfaces when the NEWER conclusion is the due reacts", () => {
    const due = surfaceReviews(
      [
        dated("lactose", "tolerated", 10),
        dated("lactose", "reacts", 160, atDays(150)),
      ],
      now,
    );
    expect(due.map((d) => d.trigger)).toEqual(["lactose"]);
  });

  it("is input-ORDER-independent", () => {
    const records = [
      dated("lactose", "reacts", 10, atDays(150)),
      dated("lactose", "tolerated", 160),
      dated("fructose", "reacts", 20, atDays(100)),
    ];
    const forward = surfaceReviews(records, now);
    const reversed = surfaceReviews([...records].reverse(), now);
    expect(reversed).toEqual(forward);
    expect(forward.map((d) => d.trigger)).toEqual(["fructose"]);
  });
});
