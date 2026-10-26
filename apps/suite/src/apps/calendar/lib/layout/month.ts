// AUTHORED-BY Codex GPT-6.1-Sol
import { dateDay, dayDate, integer } from "./validation";

export interface MonthCell {
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
  row: number;
  column: number;
}

/** Always six rows of seven cells. month: 1–12; weekStartsOn: 0 Sunday–6 Saturday. */
export function monthGrid(year: number, month: number, weekStartsOn: number): MonthCell[][] {
  integer(year, 1, 9999);
  integer(month, 1, 12);
  integer(weekStartsOn, 0, 6);
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  const first = dateDay(`${prefix}-01`);
  const weekday = new Date(`${prefix}-01T00:00:00Z`).getUTCDay();
  const start = first - ((weekday - weekStartsOn + 7) % 7);
  return Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 7 }, (_, column) => {
      const date = dayDate(start + row * 7 + column);
      return {
        date,
        dayOfMonth: Number(date.slice(8)),
        inMonth: date.startsWith(prefix),
        row,
        column,
      };
    }),
  );
}
