import { describe, it, expect } from "vitest";
import { buildTimeline, buildMonth, timelineDependencies } from "./timeline";
import type { IssueRecord } from "./repository";

const base: IssueRecord = {
  url: "",
  title: "",
  state: "open",
  status: "todo",
  issueType: "task",
  labels: [],
  blockedBy: [],
  relatesTo: [],
  attachments: [],
  comments: [],
  worklog: [],
  loggedSeconds: 0,
  canWrite: true,
  fields: {},
};
const mk = (p: Partial<IssueRecord>): IssueRecord => ({ ...base, ...p });
const NOW = new Date("2026-06-10T12:00:00Z");

describe("buildTimeline", () => {
  it("spans from earliest start to latest due and positions bars", () => {
    const model = buildTimeline(
      [
        mk({ url: "a", created: new Date("2026-06-01"), dateDue: new Date("2026-06-11") }),
        mk({ url: "b", created: new Date("2026-06-06"), dateDue: new Date("2026-06-21") }),
        mk({ url: "undated" }), // omitted
      ],
      NOW,
    );
    expect(model).not.toBeNull();
    expect(model!.bars).toHaveLength(2);
    const [a, b] = model!.bars;
    expect(a.start).toBe(0);
    expect(a.width).toBeCloseTo(50, 0); // 10 of 20 days
    expect(b.start).toBeCloseTo(25, 0);
    expect(b.start + b.width).toBeCloseTo(100, 0);
  });

  it("returns null with no dated issues", () => {
    expect(buildTimeline([mk({ url: "x" })], NOW)).toBeNull();
  });

  it("clamps inverted ranges to a visible bar", () => {
    const model = buildTimeline(
      [mk({ url: "a", created: new Date("2026-06-10"), dateDue: new Date("2026-06-01") })],
      NOW,
    );
    expect(model!.bars[0].width).toBeGreaterThan(0);
  });
});

describe("buildMonth", () => {
  it("builds a Monday-first 6×7 grid with due issues placed", () => {
    const due = mk({ url: "d", title: "Due here", dateDue: new Date(2026, 5, 15) });
    const weeks = buildMonth([due], 2026, 5, NOW); // June 2026
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 1 June 2026 is a Monday — first cell is in-month.
    expect(weeks[0][0].date.getDate()).toBe(1);
    expect(weeks[0][0].inMonth).toBe(true);
    const all = weeks.flat();
    expect(all.find((d) => d.isToday)?.date.getDate()).toBe(10);
    expect(all.find((d) => d.issues.length > 0)?.date.getDate()).toBe(15);
  });
});

describe("timelineDependencies (#75 P1-4)", () => {
  // Two dated issues so both get bars; `b` is blocked by `a`.
  const dated = (url: string, p: Partial<IssueRecord> = {}) =>
    mk({ url, created: new Date("2026-06-01"), dateDue: new Date("2026-06-11"), ...p });

  it("draws an arrow from a blocker's bar to the bar it blocks", () => {
    const a = dated("a");
    const b = dated("b", { blockedBy: ["a"] });
    const model = buildTimeline([a, b], NOW)!;
    const deps = timelineDependencies(model.bars);
    expect(deps).toHaveLength(1);
    const d = deps[0];
    expect(d.kind).toBe("blocks");
    expect(d.fromUrl).toBe("a");
    expect(d.toUrl).toBe("b");
    // Row indices map into the placed-bar list.
    expect(model.bars[d.fromRow].issue.url).toBe("a");
    expect(model.bars[d.toRow].issue.url).toBe("b");
    // The arrow starts at the blocker's right edge and lands at the target's left.
    const src = model.bars[d.fromRow];
    expect(d.fromAt).toBeCloseTo(src.start + src.width, 5);
    expect(d.toAt).toBeCloseTo(model.bars[d.toRow].start, 5);
  });

  it("omits an edge whose blocker is not placed on the timeline", () => {
    // `b` is blocked by `undated`, which has no dates → no bar → no arrow.
    const b = dated("b", { blockedBy: ["undated"] });
    const undated = mk({ url: "undated" });
    const model = buildTimeline([b, undated], NOW)!;
    expect(timelineDependencies(model.bars)).toEqual([]);
  });

  it("does not draw blocker arrows when no issues are linked", () => {
    const model = buildTimeline([dated("a"), dated("b")], NOW)!;
    expect(timelineDependencies(model.bars)).toEqual([]);
  });

  it("skips a self-edge from malformed data", () => {
    const a = dated("a", { blockedBy: ["a"] });
    const model = buildTimeline([a], NOW)!;
    expect(timelineDependencies(model.bars)).toEqual([]);
  });

  it("adds dashed relates-to links once per symmetric pair when requested", () => {
    // Reciprocal dct:relation (a↔b) must yield exactly ONE link, not two.
    const a = dated("a", { relatesTo: ["b"] });
    const b = dated("b", { relatesTo: ["a"] });
    const model = buildTimeline([a, b], NOW)!;
    const deps = timelineDependencies(model.bars, { includeRelates: true });
    const relates = deps.filter((d) => d.kind === "relates");
    expect(relates).toHaveLength(1);
  });

  it("includes BOTH a blocks arrow and a relates link for the same pair when both stored", () => {
    const a = dated("a", { relatesTo: ["b"] });
    const b = dated("b", { blockedBy: ["a"], relatesTo: ["a"] });
    const model = buildTimeline([a, b], NOW)!;
    const deps = timelineDependencies(model.bars, { includeRelates: true });
    expect(deps.filter((d) => d.kind === "blocks")).toHaveLength(1);
    expect(deps.filter((d) => d.kind === "relates")).toHaveLength(1);
  });

  it("excludes relates links by default (blocks only)", () => {
    const a = dated("a", { relatesTo: ["b"] });
    const b = dated("b", { relatesTo: ["a"] });
    const model = buildTimeline([a, b], NOW)!;
    expect(timelineDependencies(model.bars)).toEqual([]);
  });
});
