// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import type AxeBuilder from "@axe-core/playwright";
import { expect, it, vi } from "vitest";
import { BucketTable, type ChartSeries, TrendChart } from "../src/apps/health/components/charts";
import { relativeTime, trendText } from "../src/apps/health/components/dashboard";
import { recordSchema } from "../src/apps/health/components/records-view";
import { ElevationDrawing, RouteDrawing } from "../src/apps/health/components/workouts-view";
import { fingerprintAppleRecord } from "../src/apps/health/lib/browser/chunks";
import { act, h, key, mount } from "./drive-ui-dom";

vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("../src/apps/health/components/health-app", () => ({ useMeasurement: () => vi.fn() }));

const requireSuite = createRequire(new URL("../package.json", import.meta.url));
const axe = createRequire(requireSuite.resolve("@axe-core/playwright"))("axe-core") as {
  run(
    node: Element,
    options: Parameters<AxeBuilder["options"]>[0],
  ): ReturnType<AxeBuilder["analyze"]>;
};

it("exposes aggregate values consistently and supports one tab stop with arrow-key point inspection", async () => {
  const series: ChartSeries[] = [
    {
      label: "Weight",
      aggregation: "mean",
      buckets: [
        { key: "2026-10-31", value: 81, count: 1 },
        { key: "2026-11-01", value: 80.2, count: 2 },
      ],
    },
  ];
  const view = await mount(
    h(TrendChart, { series, unit: "kg", label: "Weight over 7d. Daily averages in kg." }),
  );
  const chart = view.host.querySelector("svg");
  expect(chart?.getAttribute("role")).toBe("group");
  expect(chart?.getAttribute("aria-label")).toContain(
    "Latest plotted Weight, 2026-11-01: average of 2 readings: 80.2 kg.",
  );
  expect(view.host.querySelectorAll('circle[tabindex="0"]')).toHaveLength(1);
  const points = view.host.querySelectorAll<SVGCircleElement>('circle[role="button"]');
  await act(async () => points[0]?.focus());
  await key(points[0] as Element, "ArrowRight");
  expect(document.activeElement).toBe(points[1]);
  expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
    "average of 2 readings: 80.2 kg",
  );
  expect(points[1]?.querySelector("title")?.textContent).toContain(
    "average of 2 readings: 80.2 kg",
  );
  await key(points[1] as Element, "Home");
  expect(document.activeElement).toBe(points[0]);
  await key(points[0] as Element, "End");
  expect(document.activeElement).toBe(points[1]);
  await key(points[1] as Element, "ArrowDown");
  expect(document.activeElement).toBe(points[0]);
  await key(points[0] as Element, "ArrowUp");
  expect(document.activeElement).toBe(points[1]);
  const result = await axe.run(view.host, {
    runOnly: {
      type: "rule",
      values: ["nested-interactive", "aria-allowed-role", "aria-allowed-attr", "button-name"],
    },
  });
  expect(result.violations).toEqual([]);
  await view.render(h(BucketTable, { series, unit: "kg" }));
  expect(view.host.querySelector("tbody tr:last-child")?.textContent).toContain("80.2");
  await view.render(h(TrendChart, { series, unit: "kg", label: "Weight over 7d." }));
  const last = view.host.querySelector<SVGCircleElement>("circle:last-child");
  await act(async () => last?.focus());
  await view.render(
    h(TrendChart, {
      series: [
        { ...(series[0] as ChartSeries), buckets: [{ key: "2026-11-01", value: 81.5, count: 3 }] },
      ],
      unit: "kg",
      label: "Weight over 7d.",
    }),
  );
  expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
    "average of 3 readings: 81.5 kg",
  );
  expect(view.host.querySelector('circle[tabindex="0"]')).toBe(document.activeElement);
  await view.render(
    h(TrendChart, {
      series: [
        {
          label: "Steps",
          aggregation: "sum",
          buckets: [{ key: "2026-11-01", value: 2400, count: 2 }],
        },
      ],
      unit: "steps",
      label: "Steps over 7d.",
    }),
  );
  expect(view.host.querySelector("circle")?.getAttribute("aria-label")).toContain(
    "total of 2 readings: 2,400 steps",
  );
});

it("keeps historical dates in the record form while enforcing the medication schedule horizon", () => {
  const draft = {
    name: "Childhood record",
    note: "",
    dose: "",
    date: "1987-04-11",
    frequency: "none",
    time: "08:00",
    timeZone: "UTC",
  };
  expect(recordSchema("conditions").safeParse(draft).success).toBe(true);
  expect(recordSchema("immunisations").safeParse(draft).success).toBe(true);
  expect(recordSchema("medications").safeParse(draft).success).toBe(false);
  expect(recordSchema("conditions").safeParse({ ...draft, date: "1987-02-29" }).success).toBe(
    false,
  );
});

it("uses daily dates for aggregates, UTC calendar days, and plain copy for rounded-flat trends", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  expect(relativeTime(new Date("2026-11-01Z"), now, true)).toBe("Today");
  expect(relativeTime(new Date("2026-11-01T08:00:00Z"), now)).toBe("Today at 08:00");
  expect(relativeTime(new Date("2026-10-31T23:55:00Z"), now, true)).toBe("yesterday");
  expect(trendText(0)).toBe("Same as previous week");
  expect(trendText(0.4)).toBe("Same as previous week");
  expect(trendText(-0.4)).toBe("Same as previous week");
  expect(trendText(4.1)).toBe("Up 4% vs previous week");
  expect(trendText(-4.1)).toBe("Down 4% vs previous week");
  expect(trendText(null)).toBe("More readings will reveal a trend");
});

it("fits tiny routes with padding and equal geographic scale, including vertical, horizontal and single-point tracks", async () => {
  const view = await mount(
    h(RouteDrawing, {
      segments: [
        [
          { lat: 51, long: 0 },
          { lat: 51.000001, long: 0.000001 },
        ],
      ],
    }),
  );
  const coords = () =>
    (view.host.querySelector("polyline")?.getAttribute("points") ?? "")
      .split(" ")
      .map((point) => point.split(",").map(Number));
  const first = coords();
  expect(first[0]?.[1]).toBeCloseTo(215);
  expect(first[1]?.[1]).toBeCloseTo(25);
  const dx = (first[1]?.[0] ?? 0) - (first[0]?.[0] ?? 0);
  expect(dx / 190).toBeCloseTo(Math.cos((51.0000005 * Math.PI) / 180));
  await view.render(
    h(RouteDrawing, {
      segments: [
        [
          { lat: 1, long: 0 },
          { lat: 1, long: 0.000001 },
        ],
      ],
    }),
  );
  expect(coords()[0]?.[0]).toBeCloseTo(40);
  expect(coords()[1]?.[0]).toBeCloseTo(600);
  expect(coords().map((point) => point[1])).toEqual([120, 120]);
  await view.render(
    h(RouteDrawing, {
      segments: [
        [
          { lat: 1, long: 0 },
          { lat: 1.000001, long: 0 },
        ],
      ],
    }),
  );
  expect(coords()[0]?.[0]).toBe(320);
  expect(coords()[1]?.[0]).toBe(320);
  await view.render(h(RouteDrawing, { segments: [[{ lat: 1, long: 0 }]] }));
  expect(view.host.querySelector("circle")?.getAttribute("cx")).toBe("320");
  expect(coords()).toEqual([[320, 120]]);
});

it("renders a long segmented track in linear work without spread argument limits, including its elevation profile", async () => {
  let coordinateReads = 0;
  const points = Array.from({ length: 150_000 }, (_, index) => ({
    get lat() {
      coordinateReads++;
      return 51 + index * 0.000001;
    },
    get long() {
      coordinateReads++;
      return -0.12 + index * 0.000001;
    },
  }));
  const view = await mount(
    h(RouteDrawing, { segments: [points.slice(0, 100_000), points.slice(100_000)] }),
  );
  expect(view.host.querySelector("svg")?.getAttribute("aria-label")).toContain(
    "150000 points in 2 segments",
  );
  expect(view.host.querySelectorAll("polyline")).toHaveLength(2);
  expect(coordinateReads).toBeLessThanOrEqual(points.length * 8);
  expect(view.host.querySelector("polyline")?.getAttribute("points")).not.toMatch(/NaN|Infinity/);
  await view.render(
    h(ElevationDrawing, {
      profile: points.map((_, index) => ({ distance: index * 2, elevation: index % 100 })),
    }),
  );
  expect(view.host.querySelector("svg")?.getAttribute("aria-label")).toContain(
    "Minimum 0 m, maximum 99 m",
  );
  expect(view.host.querySelector("polyline")?.getAttribute("points")).not.toMatch(/NaN|Infinity/);
});

it("hashes source-record identities at the browser boundary using SHA-256", async () => {
  expect(await fingerprintAppleRecord("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
