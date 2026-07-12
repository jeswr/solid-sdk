// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { ProtocolData } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_AFTER_DAYS,
  deriveConfirmedConclusion,
  TIME_BOXED_TRIGGERS,
} from "./conclude";
import { atDays } from "./testUtils";

function protocol(over: Partial<ProtocolData> & Pick<ProtocolData, "targetTrigger" | "phase">): ProtocolData {
  return { id: "https://pod.example/health/diary/protocols/p1#it", ...over };
}

describe("deriveConfirmedConclusion — confirmation ONLY from a completed protocol (DESIGN §4.2)", () => {
  it("stamps 'confirmed' when the protocol has reached the concluded phase", () => {
    const c = deriveConfirmedConclusion(protocol({ targetTrigger: "lactose", phase: "concluded" }), "reacts", {
      now: atDays(0),
    });
    expect(c).toBeDefined();
    expect(c!.confidence).toBe("confirmed");
    expect(c!.verdict).toBe("reacts");
    expect(c!.aboutTrigger).toBe("lactose");
    expect(c!.derivedFrom).toContain("https://pod.example/health/diary/protocols/p1#it");
  });

  it("REFUSES to confirm a protocol still in an active challenge (hard guard)", () => {
    for (const phase of ["baseline", "eliminate", "washout", "reintroduce", "observe"] as const) {
      expect(deriveConfirmedConclusion(protocol({ targetTrigger: "lactose", phase }), "reacts")).toBeUndefined();
    }
  });
});

describe("time-boxing — secondary intolerances get a re-challenge date (RESEARCH §2.2)", () => {
  it("sets reviewAfter for a secondary intolerance that REACTS (UTC calendar date)", () => {
    const now = atDays(0);
    const c = deriveConfirmedConclusion(protocol({ targetTrigger: "lactose", phase: "concluded" }), "reacts", { now });
    expect(c!.reviewAfter).toBeDefined();
    // reviewAfter is a CALENDAR date normalised to UTC midnight (matches the model's
    // UTC-anchored xsd:date), = the concluded date + the review interval, in days.
    const expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + DEFAULT_REVIEW_AFTER_DAYS);
    expect(c!.reviewAfter!.getTime()).toBe(expected);
  });

  it("does NOT time-box gluten (coeliac is lifelong)", () => {
    const c = deriveConfirmedConclusion(protocol({ targetTrigger: "gluten", phase: "concluded" }), "reacts");
    expect(c!.reviewAfter).toBeUndefined();
    expect(TIME_BOXED_TRIGGERS).not.toContain("gluten");
  });

  it("does NOT time-box a TOLERATED verdict (nothing to re-challenge)", () => {
    const c = deriveConfirmedConclusion(protocol({ targetTrigger: "lactose", phase: "concluded" }), "tolerated");
    expect(c!.reviewAfter).toBeUndefined();
  });

  it("respects a custom review interval", () => {
    const now = atDays(0);
    const c = deriveConfirmedConclusion(protocol({ targetTrigger: "fructose", phase: "concluded" }), "dose-dependent", {
      now,
      reviewAfterDays: 90,
    });
    const expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 90);
    expect(c!.reviewAfter!.getTime()).toBe(expected);
  });
});
