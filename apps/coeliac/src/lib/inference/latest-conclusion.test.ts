// AUTHORED-BY Claude Fable 5
/**
 * The latest-per-trigger collapse (health-safety determinism). It must pick the
 * greatest `created` time per trigger, break exact-timestamp ties deterministically
 * on the greater stable id, treat a missing timestamp as oldest, and be wholly
 * input-order-independent.
 */
import { describe, expect, it } from "vitest";
import { latestByTrigger, latestByTriggerList } from "./latest-conclusion";

interface Rec {
  trigger: "lactose" | "gluten" | "fructose";
  created: number | undefined;
  id: string;
}

const acc = {
  triggerOf: (r: Rec) => r.trigger,
  createdMsOf: (r: Rec) => (r.created === undefined ? Number.NaN : r.created),
  idOf: (r: Rec) => r.id,
};

describe("latestByTrigger", () => {
  it("keeps the record with the greatest created time per trigger", () => {
    const m = latestByTrigger(
      [
        { trigger: "lactose", created: 100, id: "a" },
        { trigger: "lactose", created: 300, id: "b" },
        { trigger: "lactose", created: 200, id: "c" },
      ],
      acc,
    );
    expect(m.get("lactose")?.id).toBe("b");
  });

  it("breaks an exact-timestamp tie on the greater id (deterministic)", () => {
    const m = latestByTrigger(
      [
        { trigger: "gluten", created: 500, id: "aaa" },
        { trigger: "gluten", created: 500, id: "zzz" },
      ],
      acc,
    );
    expect(m.get("gluten")?.id).toBe("zzz");
  });

  it("treats a missing timestamp as oldest (any dated record supersedes it)", () => {
    const m = latestByTrigger(
      [
        { trigger: "fructose", created: undefined, id: "x" },
        { trigger: "fructose", created: 1, id: "y" },
      ],
      acc,
    );
    expect(m.get("fructose")?.id).toBe("y");
  });

  it("is input-order-independent", () => {
    const recs: Rec[] = [
      { trigger: "lactose", created: 100, id: "a" },
      { trigger: "lactose", created: 300, id: "b" },
      { trigger: "gluten", created: 500, id: "g1" },
      { trigger: "gluten", created: 500, id: "g2" },
    ];
    const forward = latestByTriggerList(recs, acc)
      .map((r) => r.id)
      .sort();
    const reversed = latestByTriggerList([...recs].reverse(), acc)
      .map((r) => r.id)
      .sort();
    expect(reversed).toEqual(forward);
  });
});
