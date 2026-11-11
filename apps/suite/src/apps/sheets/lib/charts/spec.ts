// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";
import type { Snapshot } from "../model/snapshot";
import { chartSource, parseChartRange } from "./range";

export const chartTypes = ["column", "bar", "line", "pie", "scatter"] as const;
export const chartSpecSchema = z.object({
  id: z.string().min(1).max(100),
  sheetId: z.string().min(1).max(100),
  type: z.enum(chartTypes),
  range: z
    .string()
    .max(200)
    .refine((value) => {
      try {
        parseChartRange(value);
        return true;
      } catch {
        return false;
      }
    }, "Enter a rectangular A1 range"),
  title: z.string().max(200),
  legend: z.boolean(),
  series: z.enum(["columns", "rows"]),
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export const chartCollectionSchema = z.object({
  version: z.literal(1),
  entries: z.array(z.unknown()).max(100),
});

/** Validate independently so one bad chart cannot hide the workbook or its other charts. */
export function readCharts(
  snapshot: Snapshot,
  validateSource = false,
): { charts: ChartSpec[]; issues: string[] } {
  if (snapshot.charts === undefined) return { charts: [], issues: [] };
  const collection = chartCollectionSchema.safeParse(snapshot.charts);
  if (!collection.success)
    return { charts: [], issues: ["Ignored an invalid or unsupported chart collection"] };
  const charts: ChartSpec[] = [];
  const issues: string[] = [];
  for (const [index, entry] of collection.data.entries.entries()) {
    const parsed = chartSpecSchema.safeParse(entry);
    try {
      if (!parsed.success || charts.some((chart) => chart.id === parsed.data.id)) throw new Error();
      if (validateSource)
        parsed.data.range = chartSource(snapshot, parsed.data.sheetId, parsed.data.range).range.a1;
      charts.push(parsed.data);
    } catch {
      issues.push(`Ignored invalid chart entry ${index + 1}`);
    }
  }
  return { charts, issues };
}

export function withCharts(
  snapshot: Snapshot,
  charts: ChartSpec[],
): Snapshot & { charts: { version: 1; entries: ChartSpec[] } } {
  return { ...snapshot, charts: { version: 1, entries: charts } };
}

export function validateChartSnapshot(snapshot: Snapshot): Snapshot {
  const { charts, issues } = readCharts(snapshot, true);
  for (const issue of issues) console.warn(`Sheets: ${issue}`);
  return withCharts(snapshot, charts);
}
