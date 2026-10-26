// AUTHORED-BY Codex GPT-6.1-Sol
import type { Grid, WorkbookMetadata } from "../../src/apps/sheets/lib/model";
export const POD = "https://pod.example/alice/";
export const BOOK = `${POD}sheets/budget/`;
export const META: WorkbookMetadata = {
  title: 'Budget "2026"\n🍃',
  created: new Date("2026-10-24T10:00:00Z"),
  modified: new Date("2026-10-25T10:00:00Z"),
  creator: `${POD}profile/card#me`,
  sheets: [
    { number: 1, name: "Income" },
    { number: 2, name: "Costs" },
  ],
};
export const GRID: Grid = {
  columns: ["Label", "Amount", "When"],
  rows: [["Example", 42.5, new Date("2026-10-25T00:00:00Z")]],
};
