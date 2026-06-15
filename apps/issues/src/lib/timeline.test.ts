import { describe, it, expect } from "vitest";
import { buildTimeline, buildMonth } from "./timeline";
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
