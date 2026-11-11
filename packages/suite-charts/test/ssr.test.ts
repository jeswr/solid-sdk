// AUTHORED-BY Codex GPT-6.1-Sol
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BarChart,
  LineChart,
  ScatterChart,
  Sparkline,
  StatTile,
  TimelineChart,
} from "../src/index.js";

describe("server rendering without browser globals", () => {
  it("renders every export without window, document or ResizeObserver", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    const charts = [
      createElement(LineChart, {
        title: "Line",
        series: [{ id: "one", label: "One", points: [{ x: "2026-01-01", y: 1 }] }],
        unit: "g",
      }),
      createElement(BarChart, {
        title: "Bar",
        data: [{ id: "one", label: "One", value: -1 }],
        unit: "g",
      }),
      createElement(ScatterChart, { title: "Scatter", points: [], xLabel: "X", yLabel: "Y" }),
      createElement(TimelineChart, { title: "Timeline", lanes: [], now: "2026-01-01" }),
      createElement(Sparkline, { label: "Spark", values: [1, 2] }),
      createElement(StatTile, { label: "Stat", value: 1 }),
    ];
    for (const chart of charts) expect(renderToString(chart)).toContain("sc-");
  });
});
