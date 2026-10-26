// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { CalendarLayoutError, monthGrid } from "../src/apps/calendar/lib/layout";

describe("monthGrid", () => {
  it("produces six Monday-start weeks including leading and trailing dates", () => {
    const grid = monthGrid(2026, 10, 1);
    expect(grid).toHaveLength(6);
    expect(grid.every((row) => row.length === 7)).toBe(true);
    expect(grid[0]?.[0]).toEqual({
      date: "2026-09-28",
      dayOfMonth: 28,
      inMonth: false,
      row: 0,
      column: 0,
    });
    expect(grid[0]?.[3]).toEqual({
      date: "2026-10-01",
      dayOfMonth: 1,
      inMonth: true,
      row: 0,
      column: 3,
    });
    expect(grid[5]?.[6]?.date).toBe("2026-11-08");
    expect(grid.flat().filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it("handles an aligned month and leap/century years", () => {
    expect(monthGrid(2026, 2, 0)[0]?.[0]?.date).toBe("2026-02-01");
    for (const [year, length] of [
      [2024, 29],
      [1900, 28],
      [2000, 29],
      [2026, 28],
    ] as const) {
      expect(
        monthGrid(year, 2, 0)
          .flat()
          .filter((cell) => cell.inMonth),
      ).toHaveLength(length);
    }
  });

  it("keeps arithmetic Gregorian across year boundaries and years below 100", () => {
    expect(monthGrid(2026, 1, 0)[0]?.[0]?.date).toBe("2025-12-28");
    expect(monthGrid(2026, 12, 0)[5]?.[6]?.date).toBe("2027-01-09");
    expect(
      monthGrid(4, 2, 0)
        .flat()
        .some((cell) => cell.date === "0004-02-29"),
    ).toBe(true);
    expect(monthGrid(1, 1, 1)[0]?.[0]?.date).toBe("0001-01-01");
  });

  it("honours all seven week starts with consecutive unique cells", () => {
    for (let weekStart = 0; weekStart < 7; weekStart++) {
      const cells = monthGrid(2026, 3, weekStart).flat();
      expect(new Set(cells.map((cell) => cell.date)).size).toBe(42);
      for (const [index, cell] of cells.entries()) {
        expect(new Date(`${cell.date}T00:00:00Z`).getUTCDay()).toBe((weekStart + index) % 7);
        if (index > 0) {
          expect(Date.parse(cell.date) - Date.parse(cells[index - 1]?.date ?? "")).toBe(86_400_000);
        }
      }
    }
  });

  it.each([
    [0, 1, 0],
    [10000, 1, 0],
    [2026.5, 1, 0],
    [NaN, 1, 0],
    [2026, 0, 0],
    [2026, 13, 0],
    [2026, 1.5, 0],
    [2026, 1, -1],
    [2026, 1, 7],
    [2026, 1, Infinity],
    [1, 1, 0],
    [9999, 12, 0],
  ])("rejects unsupported grid %s/%s/%s with a typed error", (year, month, weekStart) => {
    expect(() => monthGrid(year, month, weekStart)).toThrow(CalendarLayoutError);
  });
});
