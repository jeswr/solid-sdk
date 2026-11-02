// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { dueDate, formatDue, isOverdue, localDay } from "../../src/apps/tasks/lib/format/due";

const now = new Date("2026-11-01T12:00:00Z");
describe("due labels and local calendar boundaries", () => {
  it.each([
    ["2026-11-01", "Today"],
    ["2026-11-02", "Tomorrow"],
    ["2026-11-03", "Tue"],
    ["2026-11-07", "Sat"],
    ["2026-11-08", "8 Nov"],
    ["2026-10-31", "31 Oct"],
    ["2027-11-03", "3 Nov 2027"],
    ["2025-11-03", "3 Nov 2025"],
  ])("formats all-day %s", (allDay, expected) => expect(formatDue({ allDay }, now)).toBe(expected));
  it.each([
    ["2026-11-01T17:00:00Z", "Today 17:00"],
    ["2026-11-02T09:00:00Z", "Tomorrow 09:00"],
    ["2026-11-03T09:00:00Z", "Tue 09:00"],
    ["2027-11-03T00:00:00Z", "3 Nov 2027 00:00"],
  ])("uses 24-hour time for %s", (date, expected) =>
    expect(formatDue({ due: new Date(date) }, now)).toBe(expected));
  it("has no label or overdue flag without a due date", () => {
    expect(formatDue({}, now)).toBe("");
    expect(isOverdue({}, now)).toBe(false);
    expect(dueDate({})).toBeUndefined();
  });
  it("prefers the all-day marker over the stored instant", () => {
    const view = { allDay: "2026-11-01", due: new Date("2026-10-31T12:00Z") };
    expect(formatDue(view, now, "en-GB")).toBe("Today");
    expect(isOverdue(view, new Date("2026-11-01T23:59:59.999Z"))).toBe(false);
    expect(isOverdue(view, new Date("2026-11-02T00:00Z"))).toBe(true);
    expect(isOverdue({ due: now }, now)).toBe(false);
    expect(isOverdue({ due: new Date(now.getTime() - 1) }, now)).toBe(true);
  });
  it("uses local days across both Europe/London DST changes", () => {
    const spring = new Date("2026-03-28T23:00Z");
    expect(formatDue({ allDay: "2026-03-29" }, spring)).toBe("Tomorrow");
    expect(formatDue({ due: new Date("2026-03-29T08:00Z") }, spring)).toBe("Tomorrow 09:00");
    expect(formatDue({ allDay: "2026-03-30" }, new Date("2026-03-29T00:00Z"))).toBe("Tomorrow");
    expect(isOverdue({ allDay: "2026-03-29" }, new Date("2026-03-29T22:59:59Z"))).toBe(false);
    expect(isOverdue({ allDay: "2026-03-29" }, new Date("2026-03-29T23:00Z"))).toBe(true);
    expect(formatDue({ allDay: "2026-10-25" }, new Date("2026-10-24T11:00Z"))).toBe("Tomorrow");
    expect(isOverdue({ allDay: "2026-10-25" }, new Date("2026-10-25T23:59Z"))).toBe(false);
    expect(localDay(new Date("2026-10-24T23:30Z"))).toBe(Date.UTC(2026, 9, 25));
  });
  it("labels tomorrow across the year boundary", () => {
    expect(formatDue({ allDay: "2027-01-01" }, new Date("2026-12-31T12:00Z"))).toBe("Tomorrow");
    expect(formatDue({ allDay: "2026-12-31" }, new Date("2027-01-01T12:00Z"))).toBe("31 Dec 2026");
  });
});
