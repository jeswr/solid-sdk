// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  chartData,
  chartModel,
  detectHeaders,
  numeric,
  type SvgChartModel,
  seriesColour,
} from "../src/apps/sheets/lib/charts/model";
import { chartSource, chartValues, parseChartRange } from "../src/apps/sheets/lib/charts/range";
import {
  type ChartSpec,
  chartSpecSchema,
  chartTypes,
  readCharts,
  validateChartSnapshot,
  withCharts,
} from "../src/apps/sheets/lib/charts/spec";
import type { Snapshot } from "../src/apps/sheets/lib/contract";
import { harness, snapshot } from "./sheets-workbook-helpers";

const spec: ChartSpec = {
  id: "chart1",
  sheetId: "data",
  type: "column",
  range: "A1:C4",
  title: "Sales",
  legend: true,
  series: "columns",
};
const values = [
  ["Month", "Sales", "Costs"],
  ["Jan", 10, -5],
  ["Feb", "20", null],
  ["Mar", -10, "missing"],
];
const source = (): Snapshot => ({
  sheets: {
    data: {
      name: "Data",
      rowCount: 20,
      columnCount: 10,
      cellData: { 0: { 0: { v: "Header" } }, 1: { 0: { f: "=1+1", v: 2 } } },
    },
  },
});

function expectFiniteGeometry(model: SvgChartModel) {
  for (const item of [...model.marks, ...model.labels]) {
    for (const value of Object.values(item)) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
  }
  for (const mark of model.marks) {
    if (mark.kind === "path") expect(mark.d).not.toMatch(/NaN|Infinity/);
  }
}

describe("chart A1 sources", () => {
  it("parses absolute cells and sheet-qualified rectangles", () => {
    expect(parseChartRange(" $b$2:C4 ")).toMatchObject({
      startRow: 1,
      endRow: 3,
      startColumn: 1,
      endColumn: 2,
      a1: "$B$2:C4",
    });
    expect(parseChartRange("A1")).toMatchObject({ startRow: 0, endRow: 0 });
    expect(chartSource(source(), "data", "'Data'!A1:B2").range.sheet).toBe("Data");
    expect(parseChartRange("A1:CV100").endColumn).toBe(99);
  });
  it.each([
    "",
    "A0",
    "B2:A1",
    "A1,B2",
    "A:A",
    "1:2",
    "A1:A10001",
    "A1:B2:C3",
    "A9007199254740992",
  ])("rejects invalid or unbounded range %s", (range) => {
    expect(() => parseChartRange(range)).toThrow();
    expect(chartSpecSchema.safeParse({ ...spec, range }).success).toBe(false);
  });
  it("validates identity, qualifiers, dimensions and cached values", () => {
    expect(() => chartSource(source(), "missing", "A1")).toThrow("existing sheet");
    expect(() => chartSource(source(), "__proto__", "A1")).toThrow("existing sheet");
    expect(() => chartSource({}, "missing", "A1")).toThrow("existing sheet");
    expect(() => chartSource(source(), "data", "Other!A1")).toThrow("this chart's sheet");
    expect(() => chartSource(source(), "data", "A21")).toThrow("beyond");
    expect(() => chartSource(source(), "data", "K1")).toThrow("beyond");
    expect(chartValues(source(), "data", "A1:B3")).toEqual([
      ["Header", null],
      [2, null],
      [null, null],
    ]);
    const empty = source();
    delete (empty.sheets as Record<string, Snapshot>).data?.cellData;
    expect(chartValues(empty, "data", "A1")).toEqual([[null]]);
  });
});

describe("headers and numeric data", () => {
  it("recognises either text edge, both, blank corners and numeric text", () => {
    expect(detectHeaders(values)).toEqual({ row: true, column: true });
    expect(
      detectHeaders([
        ["x", "y"],
        [1, 2],
      ]),
    ).toEqual({ row: true, column: false });
    expect(
      detectHeaders([
        ["Jan", 1],
        ["Feb", 2],
      ]),
    ).toEqual({ row: false, column: true });
    expect(
      detectHeaders([
        [1, 2],
        [3, 4],
      ]),
    ).toEqual({ row: false, column: false });
    expect(
      detectHeaders([
        [null, "Sales"],
        ["Jan", 1],
      ]),
    ).toEqual({ row: true, column: true });
    expect(detectHeaders([])).toEqual({ row: false, column: false });
    expect(detectHeaders([["Value"], [1]])).toEqual({ row: true, column: false });
    expect(detectHeaders([["1", "2"]])).toEqual({ row: false, column: false });
    expect(
      detectHeaders([
        [false, "text", 1],
        [undefined, 2],
      ]),
    ).toEqual({ row: false, column: false });
    expect(
      detectHeaders([
        [null, "name", undefined, null],
        [null, 1],
      ]),
    ).toEqual({ row: true, column: false });
    expect(detectHeaders([["", "name", false]])).toEqual({ row: false, column: false });
    expect(
      [null, undefined, true, {}, "", " ", "text", Infinity, "Infinity", NaN].map(numeric),
    ).toEqual(Array(10).fill(null));
    expect([0, -2, " 3.5 ", "1e2"].map(numeric)).toEqual([0, -2, 3.5, 100]);
    expect(seriesColour(5)).toBe("var(--chart-1)");
  });
  it("transposes row series and pads ragged cells without mutating inputs", () => {
    expect(chartData(spec, values)).toEqual({
      labels: ["Jan", "Feb", "Mar"],
      series: [
        { name: "Sales", values: [10, 20, -10] },
        { name: "Costs", values: [-5, null, null] },
      ],
    });
    const transposed = (values[0] as unknown[]).map((_, i) => values.map((row) => row[i]));
    expect(chartData({ ...spec, series: "rows" }, transposed)).toEqual(chartData(spec, values));
    expect(chartData(spec, [[1, 2], [3]])).toEqual({
      labels: ["Item 1", "Item 2"],
      series: [
        { name: "Series 1", values: [1, 3] },
        { name: "Series 2", values: [2, null] },
      ],
    });
    expect(chartData(spec, [["Header", "Second"]]).series).toHaveLength(2);
    expect(
      chartData(spec, [
        ["", 1],
        ["Label", 2],
        [null, 3],
      ]).labels,
    ).toEqual(["", "Label", ""]);
    expect(chartData(spec, [])).toEqual({ labels: [], series: [] });
    expect(values[0]).toEqual(["Month", "Sales", "Costs"]);
  });
});

describe("pure SVG models", () => {
  it.each([NaN, Infinity, -Infinity])("detects non-finite numeric geometry %s directly", (x) => {
    const model = chartModel(spec, values);
    model.marks.push({ kind: "circle", x, y: 1, radius: 1, colour: seriesColour(0) });
    expect(() => expectFiniteGeometry(model)).toThrow();
    model.marks.pop();
    model.labels.push({ x: 1, y: x, text: "Bad geometry" });
    expect(() => expectFiniteGeometry(model)).toThrow();
  });
  it("detects non-finite coordinates in generated path strings separately", () => {
    const model = chartModel(spec, values);
    model.marks.push({ kind: "path", d: "MNaN Infinity", fill: false, colour: seriesColour(0) });
    expect(() => expectFiniteGeometry(model)).toThrow();
  });
  it.each(chartTypes)("renders %s, empty, nonnumeric, zero and negative sources", (type) => {
    const chart = { ...spec, type };
    const model = chartModel(chart, values);
    expect(model.title).toBe("Sales");
    expect(model.description).toContain("Sales: 3 values, -10 to 20.");
    expect(model.marks.length).toBeGreaterThan(0);
    expectFiniteGeometry(model);
    expect(chartModel(chart, []).empty).toBe(true);
    expect(
      chartModel(chart, [
        [null, false],
        ["text", "?"],
      ]).empty,
    ).toBe(true);
    const zero = chartModel({ ...chart, title: "", legend: false }, [
      [0, 0],
      [0, 0],
    ]);
    expect(zero.title).toBe(`${type} chart`);
    expect(zero.legend).toEqual([]);
    expectFiniteGeometry(zero);
    const negatives = chartModel(chart, [
      [-1, -2],
      [-3, -4],
    ]);
    expect(negatives.empty).toBe(type === "pie");
    expectFiniteGeometry(negatives);
    expect(
      chartModel({ ...chart, legend: false }, [
        [2, 10],
        [1, null],
      ]).legend,
    ).toEqual([]);
    expectFiniteGeometry(
      chartModel(chart, [
        [Number.MAX_VALUE, -Number.MAX_VALUE],
        [1, 0],
      ]),
    );
  });
  it("draws columns and bars across zero and retains independent series", () => {
    const columns = chartModel(spec, values);
    const rects = columns.marks.filter((m) => m.kind === "rect");
    expect(rects).toHaveLength(4);
    expect(rects[0]?.y).toBeCloseTo(30 + 200 / 3);
    expect(rects[0]?.height).toBeCloseTo(200 / 3);
    expect(rects[2]?.y).toBeGreaterThan(rects[0]?.y as number);
    const bars = chartModel({ ...spec, type: "bar" }, values);
    expect(bars.marks.every((m) => m.kind === "rect" && m.width >= 0 && m.height > 0)).toBe(true);
    expect(bars.labels.map((l) => l.text)).toContain("Jan");
    expect(columns.legend.map((l) => l.name)).toEqual(["Sales", "Costs"]);
  });
  it("breaks lines at missing values and keeps isolated points visible", () => {
    const model = chartModel({ ...spec, type: "line" }, [[1], [null], [2], [3]]);
    expect(model.marks.filter((m) => m.kind === "circle")).toHaveLength(3);
    const path = model.marks.find((m) => m.kind === "path");
    expect(path?.kind === "path" && path.d.match(/M/g)).toHaveLength(2);
    expect(path?.kind === "path" && path.d.match(/L/g)).toHaveLength(1);
    expect(chartModel(spec, [[1, "bad"]]).description).toContain("no numeric values");
  });
  it("uses only positive first-series pie slices, including a full circle", () => {
    const pie = chartModel({ ...spec, type: "pie" }, [
      ["Label", "Value"],
      ["A", 3],
      ["B", 1],
      ["C", -2],
      ["D", null],
    ]);
    expect(pie.legend.map((l) => l.name)).toEqual(["A", "B"]);
    expect(pie.marks).toHaveLength(2);
    expect(pie.marks[0]).toMatchObject({ kind: "path", fill: true });
    expect(pie.marks[0]?.kind === "path" && pie.marks[0].d).toContain("A100 100 0 1 1");
    expect(chartModel({ ...spec, type: "pie" }, [[2]]).marks[0]).toMatchObject({
      kind: "circle",
      radius: 100,
    });
  });
  it("pairs numeric scatter x/y values and omits unpaired cells", () => {
    const model = chartModel({ ...spec, type: "scatter" }, [
      ["X", "Y", "Z"],
      [1, 10, 5],
      [2, null, 6],
      [null, 3, 4],
      [3, 15, null],
    ]);
    expect(model.marks).toHaveLength(4);
    expect(model.legend.map((l) => l.name)).toEqual(["Y", "Z"]);
    expect(chartModel({ ...spec, type: "scatter" }, [[1], [2]]).empty).toBe(true);
  });
});

it("validates versioned specs through the real workbook create/save/open path", async () => {
  const h = await harness();
  const book = await h.service.create({
    title: "Charts",
    snapshot: withCharts(snapshot(), [spec]),
  });
  expect(readCharts(book.snapshot)).toEqual({ charts: [spec], issues: [] });
  expect(readCharts((await h.service.open(book.container)).snapshot).charts).toEqual([spec]);
  const changed = {
    ...spec,
    type: "pie" as const,
    title: "Updated",
    legend: false,
    series: "rows" as const,
  };
  await h.service.save(book.container, withCharts(book.snapshot, [changed]), book.version);
  const opened = await h.service.open(book.container);
  expect(readCharts(opened.snapshot).charts).toEqual([changed]);
  expect(
    h.calls.find((c) => c.method === "PUT" && c.url.endsWith("workbook.json"))?.init.body,
  ).toContain('"version":1');
  const copy = await h.service.copy(book.container, "Copied chart");
  expect(readCharts(copy.snapshot).charts).toEqual([changed]);
  await h.service.save(book.container, withCharts(opened.snapshot, []), opened.version);
  expect(readCharts((await h.service.open(book.container)).snapshot).charts).toEqual([]);
});

it("normalizes a qualified source before a sheet rename, save and reopen", async () => {
  const h = await harness();
  const book = await h.service.create({
    title: "Stable chart source",
    snapshot: withCharts(snapshot(), [{ ...spec, range: "'Data'!A1:B3" }]),
  });
  expect(readCharts(book.snapshot).charts[0]?.range).toBe("A1:B3");
  const renamed = structuredClone(book.snapshot);
  const sheet = (renamed.sheets as Record<string, Snapshot>).data as Snapshot;
  sheet.name = "Renamed data";
  await h.service.save(book.container, renamed, book.version);
  const reopened = await h.service.open(book.container);
  expect(readCharts(reopened.snapshot).charts).toEqual([{ ...spec, range: "A1:B3" }]);
  expect(chartValues(reopened.snapshot, "data", "A1:B3")).toEqual(
    chartValues(book.snapshot, "data", "A1:B3"),
  );
});

it.each([
  '{"version":1,"entries":[{"title":1e309}]}',
  '{"version":1e309,"entries":[]}',
  '{"version":1,"entries":[],"extra":1e309}',
])("discards malformed chart metadata %s before strict workbook validation", async (metadata) => {
  const h = await harness();
  const book = await h.service.create({ title: "Existing cells", snapshot: snapshot() });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await h.fetch(`${book.container}workbook.json`, {
      method: "PUT",
      body: JSON.stringify(book.snapshot).replace(/}$/, `,"charts":${metadata}}`),
    });
    const opened = await h.service.open(book.container);
    expect(readCharts(opened.snapshot).charts).toEqual([]);
    expect(chartValues(opened.snapshot, "data", "A1:B2")).toEqual([
      ["Label", "Amount"],
      ["Text, quoted", "42.5"],
    ]);
    expect(opened.snapshot.sheets).toEqual(book.snapshot.sheets);
  } finally {
    warn.mockRestore();
  }
});

it("retains valid charts beside overflowing metadata and rejects non-finite workbook cells", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Strict cells", snapshot: snapshot() });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const stored = JSON.stringify(withCharts(book.snapshot, [spec])).replace(
      '"entries":[',
      '"entries":[{"title":1e309},',
    );
    await h.fetch(`${book.container}workbook.json`, { method: "PUT", body: stored });
    expect(readCharts((await h.service.open(book.container)).snapshot).charts).toEqual([spec]);
    await h.fetch(`${book.container}workbook.json`, {
      method: "PUT",
      body: stored.replace('"v":"42.5"', '"v":1e309'),
    });
    await expect(h.storage.loadSnapshot(book.container)).rejects.toThrow("JSON");
    for (const json of ["null", "[]", "1", "{"]) {
      await h.fetch(`${book.container}workbook.json`, { method: "PUT", body: json });
      await expect(h.storage.loadSnapshot(book.container)).rejects.toThrow();
    }
  } finally {
    warn.mockRestore();
  }
});

it("ignores and reports invalid entries without losing valid charts or the sheet", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Tolerant", snapshot: snapshot() });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const bad = {
      ...book.snapshot,
      charts: {
        version: 1,
        entries: [
          spec,
          { ...spec, id: "invalid", type: "unknown" },
          spec,
          { ...spec, id: "gone", sheetId: "missing" },
          { ...spec, id: "bounds", range: "ZZZ1" },
        ],
      },
    };
    // Write deliberately malformed stored JSON, bypassing the storage validator.
    await h.fetch(`${book.container}workbook.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bad),
    });
    const opened = await h.service.open(book.container);
    expect(readCharts(opened.snapshot).charts).toEqual([spec]);
    expect(opened.snapshot.sheets).toEqual(book.snapshot.sheets);
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledWith("Sheets: Ignored invalid chart entry 2");
    await h.service.save(book.container, bad, opened.version);
    expect(readCharts((await h.service.open(book.container)).snapshot).charts).toEqual([spec]);
    const invalidCreate = await h.service.create({ title: "Invalid create", snapshot: bad });
    expect(readCharts(invalidCreate.snapshot).charts).toEqual([spec]);
    for (const charts of [
      { version: 2, entries: [spec] },
      { version: 1, entries: "invalid" },
      null,
    ]) {
      await h.fetch(`${book.container}workbook.json`, {
        method: "PUT",
        body: JSON.stringify({ ...book.snapshot, charts }),
      });
      expect(readCharts((await h.service.open(book.container)).snapshot).charts).toEqual([]);
    }
    expect(readCharts(snapshot())).toEqual({ charts: [], issues: [] });
    expect(readCharts(validateChartSnapshot(snapshot())).charts).toEqual([]);
  } finally {
    warn.mockRestore();
  }
});
