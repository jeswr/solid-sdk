// AUTHORED-BY Claude Fable 5
/**
 * The current-exclusion-set derivation (DESIGN §2.2 entity 9). It must ground every
 * exclusion in a completed test OR a running elimination, prefer the stronger
 * "confirmed" source, flag time-boxed reviews that are due (expansion bias), and —
 * the safety rail — NEVER flag gluten for re-challenge even with a stray review date.
 */
import type { StoredConclusion, StoredProtocol } from "@/lib/cache/diary-store";
import { describe, expect, it } from "vitest";
import { deriveCurrentPlan } from "./diet-plan";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function conclusion(over: Partial<StoredConclusion>): StoredConclusion {
  return {
    kind: "conclusion",
    ulid: `c-${over.aboutTrigger}`,
    url: `https://alice.example/conclusions/${over.aboutTrigger}.ttl`,
    aboutTrigger: "lactose",
    verdict: "reacts",
    confidence: "confirmed",
    createdAt: NOW.toISOString(),
    sync: "synced",
    ...over,
  } as StoredConclusion;
}

function protocol(over: Partial<StoredProtocol>): StoredProtocol {
  return {
    kind: "protocol",
    ulid: `p-${over.targetTrigger}`,
    url: `https://alice.example/protocols/${over.targetTrigger}.ttl`,
    targetTrigger: "fructan",
    phase: "eliminate",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    sync: "synced",
    ...over,
  } as StoredProtocol;
}

describe("deriveCurrentPlan", () => {
  it("lists a confirmed reaction as an exclusion with its verdict", () => {
    const plan = deriveCurrentPlan([conclusion({ aboutTrigger: "lactose", verdict: "reacts" })], [], NOW);
    expect(plan.exclusions).toHaveLength(1);
    expect(plan.exclusions[0]).toMatchObject({
      trigger: "lactose",
      reason: "confirmed-reaction",
      verdict: "reacts",
    });
  });

  it("ignores a 'tolerated' conclusion (not an exclusion)", () => {
    const plan = deriveCurrentPlan([conclusion({ aboutTrigger: "lactose", verdict: "tolerated" })], [], NOW);
    expect(plan.exclusions).toHaveLength(0);
  });

  it("ignores a non-confirmed conclusion", () => {
    const plan = deriveCurrentPlan(
      [conclusion({ aboutTrigger: "lactose", confidence: "likely" as StoredConclusion["confidence"] })],
      [],
      NOW,
    );
    expect(plan.exclusions).toHaveLength(0);
  });

  it("includes an active elimination (eliminate/washout) but not reintroduce/observe/baseline", () => {
    const plan = deriveCurrentPlan(
      [],
      [
        protocol({ targetTrigger: "fructan", phase: "eliminate" }),
        protocol({ targetTrigger: "sulphites", phase: "reintroduce" }),
        protocol({ targetTrigger: "histamine", phase: "washout" }),
        protocol({ targetTrigger: "polyol", phase: "baseline" }),
      ],
      NOW,
    );
    const triggers = plan.exclusions.map((e) => e.trigger).sort();
    expect(triggers).toEqual(["fructan", "histamine"]);
    expect(plan.exclusions.every((e) => e.reason === "active-elimination")).toBe(true);
  });

  it("prefers the confirmed conclusion over an active protocol for the same trigger", () => {
    const plan = deriveCurrentPlan(
      [conclusion({ aboutTrigger: "lactose", verdict: "dose-dependent" })],
      [protocol({ targetTrigger: "lactose", phase: "eliminate" })],
      NOW,
    );
    expect(plan.exclusions).toHaveLength(1);
    expect(plan.exclusions[0].reason).toBe("confirmed-reaction");
    expect(plan.exclusions[0].verdict).toBe("dose-dependent");
  });

  it("flags a time-boxed exclusion whose review date has passed, review-due first", () => {
    const plan = deriveCurrentPlan(
      [
        conclusion({ aboutTrigger: "lactose", reviewAfter: "2026-05-01T00:00:00.000Z" }),
        conclusion({ aboutTrigger: "fructose", reviewAfter: "2026-12-01T00:00:00.000Z" }),
      ],
      [],
      NOW,
    );
    const lac = plan.exclusions.find((e) => e.trigger === "lactose");
    const fru = plan.exclusions.find((e) => e.trigger === "fructose");
    expect(lac?.reviewDue).toBe(true);
    expect(fru?.reviewDue).toBe(false);
    expect(plan.reviewDueCount).toBe(1);
    expect(plan.exclusions[0].trigger).toBe("lactose"); // review-due sorted first
  });

  it("SAFETY: never flags gluten as review-due, even with a stray past review date", () => {
    const plan = deriveCurrentPlan(
      [conclusion({ aboutTrigger: "gluten", verdict: "reacts", reviewAfter: "2020-01-01T00:00:00.000Z" })],
      [],
      NOW,
    );
    const gluten = plan.exclusions.find((e) => e.trigger === "gluten");
    expect(gluten).toBeDefined();
    expect(gluten?.reviewDue).toBe(false);
    expect(gluten?.timeBoxed).toBe(false);
    expect(plan.reviewDueCount).toBe(0);
  });

  it("is empty (positive expansion framing) when nothing is being avoided", () => {
    expect(deriveCurrentPlan([], [], NOW).exclusions).toHaveLength(0);
  });
});
