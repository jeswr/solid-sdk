// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BarChart,
  Legend,
  LineChart,
  ScatterChart,
  Sparkline,
  StatTile,
  TimelineChart,
} from "../src/index.js";
import type { Series } from "../src/types.js";

const series: Series[] = [
  {
    id: "a",
    label: "Morning",
    points: [
      { x: 1, y: 10, label: "First reading" },
      { x: 2, y: 20 },
      { x: 3, y: 15 },
    ],
  },
];
const other: Series = { id: "b", label: "Evening", points: [{ x: 1, y: 12 }] };
const bars = [
  { id: "a", label: "Income", value: 12 },
  { id: "b", label: "Spending", value: -8 },
  { id: "c", label: "Neither", value: 0 },
];
const scatter = [
  { id: "a", x: 1, y: 2, label: "Monday" },
  { id: "b", x: 2, y: 4 },
  { id: "c", x: 3, y: 6 },
];
const lanes = [
  {
    id: "med",
    label: "Medication",
    items: [
      { id: "active", start: "2026-01-01", label: "Current course", tone: "active" as const },
      { id: "visit", start: "2026-01-02", label: "Doctor visit" },
      {
        id: "past",
        start: "2025-12-01",
        end: "2025-12-15",
        label: "Past course",
        tone: "past" as const,
      },
    ],
  },
];
afterEach(() => vi.unstubAllGlobals());
function chartPoints(container: HTMLElement) {
  return Array.from(container.querySelectorAll<SVGGElement>('[role="button"]'));
}

describe("shared chart contract", () => {
  const cases = [
    {
      name: "Line",
      chart: <LineChart title="Line" description="Daily values" series={series} unit="bpm" />,
      count: 3,
    },
    { name: "Bar", chart: <BarChart title="Bar" data={bars} unit="GBP" />, count: 3 },
    {
      name: "Scatter",
      chart: <ScatterChart title="Scatter" points={scatter} xLabel="Sleep" yLabel="Energy" />,
      count: 3,
    },
    {
      name: "Timeline",
      chart: <TimelineChart title="Timeline" lanes={lanes} now="2026-01-10" />,
      count: 3,
    },
  ];
  it.each(cases)("renders $name's title, labelled frame, description and every table row", ({
    name,
    chart,
    count,
  }) => {
    const { container } = render(chart);
    expect(screen.getByRole("figure", { name })).toBeTruthy();
    expect(screen.getByRole("heading", { name })).toBeTruthy();
    expect(container.querySelector("figcaption")?.textContent).toContain("Use arrow keys");
    if (name === "Line")
      expect(container.querySelector("figcaption")?.textContent).toContain("Daily values");
    fireEvent.click(screen.getByRole("button", { name: "Show table" }));
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(count);
    expect(container.querySelector("svg[role='group']")).toBeNull();
    expect(screen.getByRole("button", { name: "Show chart" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show chart" }));
    expect(container.querySelector("svg[role='group']")).toBeTruthy();
  });
  it.each(cases)("provides one point tab stop, navigation and a tooltip for $name", ({ chart }) => {
    const { container } = render(chart);
    const points = chartPoints(container);
    expect(points.filter((p) => p.tabIndex === 0)).toHaveLength(1);
    act(() => points[0]?.focus());
    expect(document.activeElement).toBe(points[0]);
    expect(screen.getByRole("tooltip").textContent).toBe(points[0]?.getAttribute("aria-label"));
    if (points[0]) fireEvent.keyDown(points[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(points[1]);
    expect(screen.getByRole("tooltip").textContent).toBe(points[1]?.getAttribute("aria-label"));
    if (points[1]) fireEvent.keyDown(points[1], { key: "End" });
    expect(document.activeElement).toBe(points.at(-1));
    const last = points.at(-1);
    if (last) fireEvent.keyDown(last, { key: "Home" });
    expect(document.activeElement).toBe(points[0]);
    if (points[0]) fireEvent.keyDown(points[0], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(last);
    expect(chartPoints(container).filter((p) => p.tabIndex === 0)).toHaveLength(1);
    if (last) fireEvent.keyDown(last, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    if (last) fireEvent.keyDown(last, { key: "Enter" });
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
  it.each([
    <LineChart key="line" title="Empty" series={[]} unit="" />,
    <BarChart key="bar" title="Empty" data={[]} unit="" />,
    <ScatterChart key="scatter" title="Empty" points={[]} xLabel="X" yLabel="Y" />,
    <TimelineChart key="timeline" title="Empty" lanes={[]} now="2026-01-01" />,
  ])("handles empty input", (chart) => {
    render(chart);
    expect(screen.getByRole("figure", { name: "Empty" })).toBeTruthy();
    expect(screen.getByText("No data yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show table" }));
    expect(screen.getByRole("table")).toBeTruthy();
  });
  it("can hide the visible title without hiding the accessible name", () => {
    render(
      <LineChart
        title="Hidden title"
        series={series}
        unit="bpm"
        showTitle={false}
        className="caller"
        height={200}
      />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("figure", { name: "Hidden title" }).classList.contains("caller")).toBe(
      true,
    );
    expect(screen.getByRole("group").getAttribute("height")).toBe("200");
  });
  it("recomputes the tab stop when a selected point is removed", () => {
    const { container, rerender } = render(<BarChart title="Changing" data={bars} unit="" />);
    act(() => chartPoints(container)[1]?.focus());
    rerender(<BarChart title="Changing" data={bars.slice(2)} unit="" />);
    expect(chartPoints(container).filter((p) => p.tabIndex === 0)).toHaveLength(1);
  });
});

describe("LineChart and Legend", () => {
  it("has no single-series legend and gives additional series stable slots and dashes", () => {
    const { container, rerender } = render(<LineChart title="Pulse" series={series} unit="bpm" />);
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
    rerender(<LineChart title="Pulse" series={[...series, other]} unit="bpm" />);
    expect(
      within(screen.getByRole("list", { name: "Legend" })).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(
      container.querySelector("polyline.sc-series-1")?.getAttribute("stroke-dasharray"),
    ).toBeNull();
    expect(container.querySelector("polyline.sc-series-2")?.getAttribute("stroke-dasharray")).toBe(
      "8 4",
    );
    rerender(<LineChart title="Pulse" series={[other, ...series]} unit="bpm" />);
    expect(chartPoints(container)[0]?.classList.contains("sc-series-1")).toBe(true);
    expect(chartPoints(container)[0]?.getAttribute("aria-label")).toContain("Evening");
  });
  it("assigns a unique dash pattern to each of five slots", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      ...other,
      id: String(i),
      label: String(i),
    }));
    const { container } = render(<LineChart title="Five" series={five} unit="" />);
    expect(
      new Set(
        Array.from(container.querySelectorAll("polyline")).map((p) =>
          p.getAttribute("stroke-dasharray"),
        ),
      ).size,
    ).toBe(5);
  });
  it("rejects a sixth series and tells the caller to fold into Other", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ ...other, id: String(i) }));
    expect(() => render(<LineChart title="Many" series={six} unit="" />)).toThrow(RangeError);
    expect(() => render(<Legend series={six} />)).toThrow(/Other/);
  });
  it("skips nonfinite x/y values, counts them and keeps all rows in the table", () => {
    const { container } = render(
      <LineChart
        title="Partial"
        unit="bpm"
        series={[
          {
            id: "a",
            label: "Pulse",
            points: [
              { x: 1, y: 10 },
              { x: 2, y: NaN },
              { x: Infinity, y: 20 },
            ],
          },
        ]}
      />,
    );
    expect(chartPoints(container)).toHaveLength(1);
    expect(screen.getByText(/2 values could not be plotted/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show table" }));
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(3);
    expect(within(screen.getByRole("table")).getByText("NaN")).toBeTruthy();
  });
  it("supports time values, explicit domains, events, bands and custom formatting", () => {
    const { container } = render(
      <LineChart
        title="Health"
        unit="bpm"
        series={[
          {
            id: "a",
            label: "Pulse",
            points: [
              { x: "2026-01-01", y: 65 },
              { x: new Date("2026-01-02"), y: 70 },
            ],
          },
        ]}
        yDomain={[50, 100]}
        band={{ from: 60, to: 80, label: "Reference" }}
        events={[{ x: "2026-01-02", label: "Started medication" }]}
        formatX={(t) => new Date(t).toISOString().slice(0, 10)}
        formatY={(v) => `${v.toFixed(1)}`}
      />,
    );
    expect(container.querySelector(".sc-band")).toBeTruthy();
    expect(screen.getByText("Reference")).toBeTruthy();
    expect(screen.getByText("Started medication")).toBeTruthy();
    const point = chartPoints(container)[0];
    if (point) fireEvent.mouseEnter(point);
    expect(screen.getByRole("tooltip").textContent).toContain("Pulse, 2026-01-01: 65.0 bpm");
  });
  it("rejects mixed numeric/time x inputs", () => {
    expect(() =>
      render(
        <LineChart
          title="Mixed"
          unit=""
          series={[
            {
              id: "a",
              label: "A",
              points: [
                { x: 1, y: 1 },
                { x: "2026-01-01", y: 2 },
              ],
            },
          ]}
        />,
      ),
    ).toThrow(TypeError);
  });
  it("snaps the crosshair to the nearest x on plot hover", () => {
    const { container } = render(<LineChart title="Pulse" series={series} unit="bpm" />);
    fireEvent.mouseMove(screen.getByRole("group"), { clientX: 65, clientY: 80 });
    expect(container.querySelector(".sc-crosshair")?.getAttribute("x1")).toBe("62");
    expect(screen.getByRole("tooltip").textContent).toContain("Morning, 1: 10 bpm");
    fireEvent.mouseLeave(screen.getByRole("group"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("BarChart", () => {
  it.each([
    "vertical",
    "horizontal",
  ] as const)("starts positive and negative %s bars at zero", (orientation) => {
    const { container } = render(
      <BarChart title="Money" data={bars} unit="GBP" orientation={orientation} />,
    );
    const baseline = container.querySelector(".sc-baseline");
    const marks = container.querySelectorAll("rect.sc-bar");
    const positive = marks[0],
      negative = marks[1];
    if (orientation === "vertical") {
      const zero = Number(baseline?.getAttribute("y1"));
      expect(
        Number(positive?.getAttribute("y")) + Number(positive?.getAttribute("height")),
      ).toBeCloseTo(zero);
      expect(Number(negative?.getAttribute("y"))).toBeCloseTo(zero);
      expect(Number(negative?.getAttribute("height"))).toBeGreaterThan(0);
    } else {
      const zero = Number(baseline?.getAttribute("x1"));
      expect(Number(positive?.getAttribute("x"))).toBeCloseTo(zero);
      expect(
        Number(negative?.getAttribute("x")) + Number(negative?.getAttribute("width")),
      ).toBeCloseTo(zero);
    }
  });
  it("counts NaN and Infinity without creating invalid SVG coordinates", () => {
    const { container } = render(
      <BarChart
        title="Invalid"
        data={[
          { id: "a", label: "A", value: NaN },
          { id: "b", label: "B", value: Infinity },
        ]}
        unit=""
      />,
    );
    expect(screen.getByText("No data yet")).toBeTruthy();
    expect(screen.getByText(/2 values could not be plotted/)).toBeTruthy();
    expect(container.querySelector("svg")?.outerHTML).not.toMatch(/NaN|Infinity/);
  });
});
describe("ScatterChart", () => {
  it("draws the least-squares line and states r and n", () => {
    const { container } = render(
      <ScatterChart
        title="Association"
        points={scatter}
        xLabel="Sleep"
        yLabel="Energy"
        xUnit="h"
        yUnit="points"
        trend
      />,
    );
    expect(screen.getByText(/r = 1.00 \(n = 3\)/)).toBeTruthy();
    expect(container.querySelector(".sc-trend")).toBeTruthy();
    act(() => chartPoints(container)[0]?.focus());
    expect(screen.getByRole("tooltip").textContent).toContain("Sleep: 1 h, Energy: 2 points");
  });
  it.each([
    { points: scatter.slice(0, 2) },
    { points: scatter.map((p) => ({ ...p, x: 1 })) },
    { points: scatter.map((p) => ({ ...p, y: 1 })) },
  ])("draws no trend without enough data and both variances", ({ points }) => {
    const { container } = render(
      <ScatterChart title="Sparse" points={points} xLabel="X" yLabel="Y" trend />,
    );
    expect(screen.getByText(/Not enough data for a trend/)).toBeTruthy();
    expect(container.querySelector(".sc-trend")).toBeNull();
  });
  it("reports a negative correlation using only finite observations", () => {
    const { container } = render(
      <ScatterChart
        title="Inverse"
        points={[...scatter.map((p) => ({ ...p, y: -p.y })), { id: "bad", x: NaN, y: 1 }]}
        xLabel="X"
        yLabel="Y"
        trend
      />,
    );
    expect(screen.getByText(/r = -1.00 \(n = 3\)/)).toBeTruthy();
    expect(screen.getByText(/1 value could not be plotted/)).toBeTruthy();
    expect(chartPoints(container)).toHaveLength(3);
  });
});
describe("TimelineChart", () => {
  it("renders a rounded interval, an active open end through now and a point diamond", () => {
    const { container } = render(
      <TimelineChart title="Treatment" lanes={lanes} now="2026-01-10" />,
    );
    expect(container.querySelector(".sc-interval[rx='4']")).toBeTruthy();
    expect(container.querySelector("[data-open-end='true']")).toBeTruthy();
    expect(container.querySelectorAll(".sc-diamond")).toHaveLength(1);
    const active = screen.getByRole("button", { name: /Current course/ });
    fireEvent.focus(active);
    expect(screen.getByRole("tooltip").textContent).toContain(
      "ongoing through 2026-01-10T00:00:00.000Z",
    );
  });
  it("uses the clock for an active item's omitted now, and reflects an updated now prop", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 0, 8));
    const { rerender } = render(<TimelineChart title="Treatment" lanes={lanes} />);
    expect(
      screen.getByRole("button", { name: /Current course/ }).getAttribute("aria-label"),
    ).toContain("2026-01-08");
    rerender(<TimelineChart title="Treatment" lanes={lanes} now="2026-01-09" />);
    expect(
      screen.getByRole("button", { name: /Current course/ }).getAttribute("aria-label"),
    ).toContain("2026-01-09");
    vi.restoreAllMocks();
  });
  it("treats end-less neutral and past items as points and clips to the supplied range", () => {
    const { container } = render(
      <TimelineChart
        title="Events"
        lanes={[
          {
            id: "l",
            label: "Visits",
            items: [
              { id: "n", start: "2026-01-01", label: "Neutral" },
              { id: "p", start: "2026-01-02", label: "Past", tone: "past" },
              { id: "outside", start: "2025-01-01", label: "Outside" },
            ],
          },
        ]}
        range={["2026-01-01", "2026-01-03"]}
      />,
    );
    expect(container.querySelectorAll(".sc-diamond")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show table" }));
    expect(within(screen.getByRole("table")).getByText("Outside")).toBeTruthy();
  });
  it("counts nonfinite endpoints and reversed intervals", () => {
    render(
      <TimelineChart
        title="Invalid"
        lanes={[
          {
            id: "l",
            label: "Lane",
            items: [
              { id: "a", label: "A", start: NaN },
              { id: "b", label: "B", start: 2, end: 1 },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText(/2 values could not be plotted/)).toBeTruthy();
    expect(screen.getByText("No data yet")).toBeTruthy();
  });
});
describe("responsive sizing", () => {
  it("falls back to 640 without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<BarChart title="Fallback" data={bars} unit="" />);
    expect(screen.getByRole("group").getAttribute("width")).toBe("640");
    expect(screen.getByRole("group").hasAttribute("viewBox")).toBe(false);
  });
  it("measures 320px, puts lane labels above rows and cleans up observation", () => {
    let resize: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const { container, unmount } = render(
      <TimelineChart title="Narrow" lanes={lanes} now="2026-01-10" />,
    );
    act(() =>
      resize?.([{ contentRect: { width: 320 } } as ResizeObserverEntry], {} as ResizeObserver),
    );
    expect(screen.getByRole("group").getAttribute("width")).toBe("320");
    expect(screen.getByRole("group").hasAttribute("viewBox")).toBe(false);
    const label = container.querySelector(".sc-lane-label");
    expect(label?.getAttribute("text-anchor")).toBe("start");
    expect(Number(label?.getAttribute("y"))).toBeLessThan(
      Number(container.querySelector(".sc-hit")?.getAttribute("cy")),
    );
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
describe("Sparkline and StatTile", () => {
  it("describes first, last, min, max and skipped values", () => {
    render(<Sparkline label="Pulse history" values={[10, NaN, 20, 5, 15]} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Pulse history: First 10, last 15, min 5, max 20. 1 value could not be plotted",
    );
  });
  it("handles empty and single-value sparklines", () => {
    const { container, rerender } = render(<Sparkline label="Empty" values={[]} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("No data yet");
    rerender(<Sparkline label="One" values={[4]} />);
    expect(container.querySelector("circle")).toBeTruthy();
    expect(container.querySelector("svg")?.outerHTML).not.toContain("NaN");
  });
  it.each([
    "up",
    "down",
    "flat",
  ] as const)("renders the %s delta with text and an arrow icon", (direction) => {
    const { container } = render(
      <StatTile
        label="Resting pulse"
        value={64}
        unit="bpm"
        delta={{ direction, value: "2 bpm", good: true }}
        sparkline={[70, 66, 64]}
        footnote="Past week"
      />,
    );
    expect(screen.getByRole("region", { name: "Resting pulse" })).toBeTruthy();
    expect(
      screen.getByText(
        `${direction === "flat" ? "No change" : direction === "up" ? "Up" : "Down"}: 2 bpm`,
      ),
    ).toBeTruthy();
    expect(container.querySelector(".sc-delta-icon path")?.getAttribute("d")).toBeTruthy();
    expect(screen.getByText("Past week")).toBeTruthy();
    expect(screen.getByRole("img")).toBeTruthy();
  });
});
