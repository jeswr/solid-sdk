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

describe("deriveCurrentPlan — latest-conclusion collapse (stale-guidance fix)", () => {
  /** A dated conclusion with a distinct url (the tie-break id) per record. */
  function dated(
    trigger: StoredConclusion["aboutTrigger"],
    verdict: StoredConclusion["verdict"],
    createdAt: string,
    extra: Partial<StoredConclusion> = {},
  ): StoredConclusion {
    return conclusion({
      aboutTrigger: trigger,
      verdict,
      createdAt,
      url: `https://alice.example/conclusions/${trigger}-${createdAt}.ttl`,
      ulid: `c-${trigger}-${createdAt}`,
      ...extra,
    });
  }

  it("a NEWER tolerated clears an older reacts for a time-boxed trigger (reacts → tolerated)", () => {
    const plan = deriveCurrentPlan(
      [
        dated("lactose", "reacts", "2026-01-01T00:00:00.000Z"),
        dated("lactose", "tolerated", "2026-03-01T00:00:00.000Z"),
      ],
      [],
      NOW,
    );
    expect(plan.exclusions).toHaveLength(0); // the later test cleared it
  });

  it("a NEWER reacts re-avoids after an older tolerated (tolerated → reacts)", () => {
    const plan = deriveCurrentPlan(
      [
        dated("lactose", "tolerated", "2026-01-01T00:00:00.000Z"),
        dated("lactose", "reacts", "2026-03-01T00:00:00.000Z"),
      ],
      [],
      NOW,
    );
    expect(plan.exclusions).toHaveLength(1);
    expect(plan.exclusions[0]).toMatchObject({ trigger: "lactose", verdict: "reacts" });
  });

  it("uses the NEWER conclusion's review date, not an older one's", () => {
    const plan = deriveCurrentPlan(
      [
        dated("lactose", "reacts", "2026-01-01T00:00:00.000Z", { reviewAfter: "2026-02-01T00:00:00.000Z" }),
        dated("lactose", "reacts", "2026-03-01T00:00:00.000Z", { reviewAfter: "2026-09-01T00:00:00.000Z" }),
      ],
      [],
      NOW,
    );
    const lac = plan.exclusions.find((e) => e.trigger === "lactose");
    expect(lac?.reviewAfter?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    // The newer review date is in the future → not yet due.
    expect(lac?.reviewDue).toBe(false);
  });

  it("is input-ORDER-independent (shuffled input → identical output)", () => {
    const records = [
      dated("lactose", "reacts", "2026-01-01T00:00:00.000Z"),
      dated("lactose", "tolerated", "2026-03-01T00:00:00.000Z"),
      dated("fructose", "reacts", "2026-02-01T00:00:00.000Z", { reviewAfter: "2026-05-01T00:00:00.000Z" }),
      dated("gluten", "reacts", "2026-01-15T00:00:00.000Z"),
    ];
    const forward = deriveCurrentPlan(records, [], NOW);
    const reversed = deriveCurrentPlan([...records].reverse(), [], NOW);
    expect(reversed).toEqual(forward);
  });

  it("SAFETY: a stray NEWER tolerated for gluten NEVER clears the lifelong exclusion", () => {
    const plan = deriveCurrentPlan(
      [
        dated("gluten", "reacts", "2026-01-01T00:00:00.000Z"),
        dated("gluten", "tolerated", "2026-06-01T00:00:00.000Z"), // stray/hostile — must not clear
      ],
      [],
      NOW,
    );
    const gluten = plan.exclusions.find((e) => e.trigger === "gluten");
    expect(gluten).toBeDefined();
    expect(gluten?.verdict).toBe("reacts");
    expect(gluten?.reviewDue).toBe(false);
    expect(gluten?.timeBoxed).toBe(false);
  });
});
