// AUTHORED-BY Codex GPT-6.1-Sol
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BarChart,
  LineChart,
  ScatterChart,
  Sparkline,
  StatTile,
  TimelineChart,
} from "../src/index.js";

afterEach(() => vi.restoreAllMocks());

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
  it("renders an ongoing timeline without reading the server clock", () => {
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("The clock must only be read after mount");
    });
    const markup = renderToString(
      createElement(TimelineChart, {
        title: "Ongoing",
        lanes: [
          {
            id: "lane",
            label: "Lane",
            items: [{ id: "active", label: "Active", start: "2026-01-01", tone: "active" }],
          },
        ],
      }),
    );
    expect(clock).not.toHaveBeenCalled();
    expect(markup).toContain("2026-01-01T00:00:00.000Z");
    expect(markup).not.toContain('data-open-end="true"');
  });
});
