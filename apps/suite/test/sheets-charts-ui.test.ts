// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { ChartSvg, ChartWorkspace } from "../src/apps/sheets/components/chart-workspace";
import {
  type ChartSpec,
  chartTypes,
  readCharts,
  withCharts,
} from "../src/apps/sheets/lib/charts/spec";
import type { SheetEngine, Snapshot } from "../src/apps/sheets/lib/contract";
import { act, click, h, mount } from "./drive-ui-dom";

const spec: ChartSpec = {
  id: "chart",
  sheetId: "data",
  range: "A1:B3",
  type: "column",
  title: "Revenue",
  legend: true,
  series: "columns",
};
function source(): Snapshot {
  return {
    sheets: {
      data: {
        name: "Data",
        rowCount: 10,
        columnCount: 5,
        cellData: {
          0: { 0: { v: "Month" }, 1: { v: "Value" } },
          1: { 0: { v: "Jan" }, 1: { v: 10 } },
          2: { 0: { v: "Feb" }, 1: { v: 20 } },
        },
      },
    },
  };
}
function fixture(initial = source(), background = true) {
  let data = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const engine: SheetEngine = {
    load: (next) => {
      data = next;
    },
    snapshot: () => data,
    onChange: subscribe,
    ...(background ? { onValuesChange: subscribe } : {}),
    setCharts: vi.fn((charts) => {
      data = { ...data, charts };
      for (const listener of listeners) listener();
    }),
    selection: () => ({ sheetId: "data", range: "A1:B3" }),
    activeSheet: () => ({ id: "data", name: "Data" }),
    importCsv: vi.fn(),
    exportCsv: () => "",
    setDark: vi.fn(),
    setReadOnly: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    engine,
    changed: async (next: Snapshot) =>
      act(() => {
        data = next;
        for (const listener of listeners) listener();
      }),
    listeners,
  };
}
function button(text: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === text,
  );
  if (!node) throw new Error(`Missing ${text}`);
  return node;
}
function field(label: string) {
  const node = [...document.querySelectorAll("label")].find((node) => node.textContent === label);
  const input = document.getElementById(node?.htmlFor ?? "") as
    | HTMLInputElement
    | HTMLSelectElement
    | null;
  if (!input) throw new Error(`Missing ${label}`);
  return input;
}
async function fill(label: string, value: string) {
  const input = field(label);
  await act(() => {
    const prototype =
      input.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit() {
  await act(() => {
    document
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

it("inserts, validates, edits and deletes charts with native controls and focus restoration", async () => {
  const f = fixture(withCharts(source(), [{ ...spec, id: "other", title: "Other" }]));
  const ui = await mount(h(ChartWorkspace, { engine: f.engine, snapshot: source() }));
  await click(button("Insert chart"));
  expect(document.activeElement).toBe(field("Chart title"));
  expect(field("Data range (A1)").value).toBe("A1:B3");
  await fill("Chart title", "New revenue");
  await fill("Chart type", "line");
  await fill("Data range (A1)", "A:A");
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("rectangular A1");
  await fill("Data range (A1)", "A1:Z10");
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("beyond this sheet");
  await fill("Data range (A1)", "Other!A1:B3");
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("this chart's sheet");
  await fill("Data range (A1)", "'Data'!A1:B3");
  await fill("Series from", "rows");
  await click(document.querySelector('input[type="checkbox"]') as Element);
  await submit();
  const inserted = readCharts(f.engine.snapshot()).charts;
  expect(inserted).toHaveLength(2);
  expect(inserted[1]).toMatchObject({
    title: "New revenue",
    type: "line",
    series: "rows",
    legend: false,
    range: "A1:B3",
  });
  expect(document.activeElement).toBe(button("Insert chart"));
  const edits = document.querySelectorAll<HTMLButtonElement>(".sht-chart-heading button");
  await click(edits[1] as Element);
  await fill("Chart title", "Edited revenue");
  await fill("Chart type", "pie");
  await fill("Data range (A1)", "'Data'!$A$1:$B$3");
  await submit();
  expect(readCharts(f.engine.snapshot()).charts[1]?.title).toBe("Edited revenue");
  expect(readCharts(f.engine.snapshot()).charts[1]?.range).toBe("$A$1:$B$3");
  await click(document.querySelectorAll(".sht-chart-heading button")[1] as Element);
  await click(button("Delete chart"));
  expect(readCharts(f.engine.snapshot()).charts.map((s) => s.id)).toEqual(["other"]);
  await click(button("Insert chart"));
  await click(button("Cancel"));
  expect(document.querySelector('aside[aria-label="Chart editor"]')).toBeNull();
  await ui.unmount();
  expect(f.listeners.size).toBe(0);
});

it("rerenders source values and formula results without closing the editor draft", async () => {
  const f = fixture(withCharts(source(), [spec]));
  const ui = await mount(h(ChartWorkspace, { engine: f.engine, snapshot: source() }));
  expect(document.querySelector("svg desc")?.textContent).toContain("10 to 20");
  await click(button("Edit chart"));
  await fill("Chart title", "Unsaved draft");
  const next = withCharts(source(), [spec]);
  const sheet = (next.sheets as Record<string, Snapshot>).data as Snapshot;
  sheet.cellData = {
    0: { 0: { v: "Month" }, 1: { v: "Value" } },
    1: { 0: { v: "Jan" }, 1: { v: 50 } },
  };
  await f.changed(next);
  expect(document.querySelector("svg desc")?.textContent).toContain("50 to 50");
  expect(field("Chart title").value).toBe("Unsaved draft");
  await ui.render(h(ChartWorkspace, { engine: f.engine, snapshot: next }));
  expect(field("Chart title").value).toBe("Unsaved draft");
  await ui.unmount();
});

it("renders view-only charts and blocks insert, edit and delete after write access is lost", async () => {
  const initial = withCharts(source(), [spec]);
  const f = fixture(initial);
  const ui = await mount(
    h(ChartWorkspace, { engine: f.engine, snapshot: initial, readOnly: true }),
  );
  const expectViewOnly = async () => {
    expect(document.querySelector('[aria-label="Workbook charts"] svg')).not.toBeNull();
    expect(document.querySelector("svg title")?.textContent).toBe("Revenue");
    expect(button("Insert chart").disabled).toBe(true);
    expect(button("Edit chart").disabled).toBe(true);
    await click(button("Insert chart"));
    await click(button("Edit chart"));
    expect(document.querySelector('aside[aria-label="Chart editor"]')).toBeNull();
    expect(f.engine.setCharts).not.toHaveBeenCalled();
    expect(f.engine.snapshot()).toEqual(initial);
  };
  await expectViewOnly();
  await ui.render(h(ChartWorkspace, { engine: f.engine, snapshot: initial, readOnly: false }));
  await click(button("Edit chart"));
  await fill("Chart title", "Local draft");
  expect(button("Apply").disabled).toBe(false);
  expect(button("Delete chart").disabled).toBe(false);
  const pendingForm = document.querySelector("form");
  const pendingDelete = button("Delete chart");
  await ui.render(h(ChartWorkspace, { engine: f.engine, snapshot: initial, readOnly: true }));
  await act(() => {
    pendingForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    pendingDelete.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expectViewOnly();
  await ui.unmount();
});

it("shows unavailable source charts and permits deletion, including untitled charts", async () => {
  const f = fixture(withCharts({ sheets: {} }, [{ ...spec, title: "" }]));
  await mount(h(ChartWorkspace, { engine: f.engine, snapshot: source() }));
  expect(document.querySelector("article")?.getAttribute("aria-label")).toBe("Untitled chart");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("no longer available");
  expect(document.querySelector("svg title")?.textContent).toBe("column chart");
  await click(button("Edit chart"));
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("existing sheet");
  await click(button("Delete chart"));
  expect(document.querySelector("article")).toBeNull();
});

it("shows explicit deleted and oversized source states and lets the editor repair them", async () => {
  const data = withCharts(source(), [{ ...spec, range: null }]);
  const f = fixture(data);
  const ui = await mount(h(ChartWorkspace, { engine: f.engine, snapshot: data }));
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Data range deleted");
  await click(button("Edit chart"));
  expect(field("Data range (A1)").value).toBe("");
  await fill("Data range (A1)", "A1:B3");
  await submit();
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.querySelector("svg desc")?.textContent).toContain("10 to 20");
  const oversized = withCharts(source(), [{ ...spec, range: "A1:T501" }]);
  const sheet = (oversized.sheets as Record<string, Snapshot>).data as Snapshot;
  sheet.rowCount = 1000;
  sheet.columnCount = 26;
  await f.changed(oversized);
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "Range too large to chart",
  );
  expect(readCharts(f.engine.snapshot()).charts[0]?.range).toBe("A1:T501");
  await click(button("Edit chart"));
  await fill("Chart title", "Still saved");
  await submit();
  expect(readCharts(f.engine.snapshot()).charts[0]).toMatchObject({
    title: "Still saved",
    range: "A1:T501",
  });
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "Range too large to chart",
  );
  await ui.unmount();
});

it("handles a loading engine, no selection, fallback subscriptions and the chart limit", async () => {
  const ui = await mount(h(ChartWorkspace, { engine: null, snapshot: source() }));
  expect(button("Insert chart").disabled).toBe(true);
  const f = fixture(source(), false);
  delete f.engine.selection;
  await ui.render(h(ChartWorkspace, { engine: f.engine, snapshot: source() }));
  await click(button("Insert chart"));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Select cells");
  await f.changed(withCharts(source(), [spec]));
  expect(document.querySelector("svg")).not.toBeNull();
  const many = fixture(
    withCharts(
      source(),
      Array.from({ length: 100 }, (_, i) => ({ ...spec, id: `c${i}` })),
    ),
  );
  await ui.render(h(ChartWorkspace, { engine: many.engine, snapshot: many.engine.snapshot() }));
  expect(button("Insert chart").disabled).toBe(true);
});

it.each(chartTypes)("renders accessible %s SVG geometry and descriptions", async (type) => {
  const ui = await mount(
    h(ChartSvg, {
      spec: { ...spec, type },
      values: [
        [1, 2],
        [3, 4],
      ],
    }),
  );
  const svg = document.querySelector('svg[role="img"]') as SVGSVGElement;
  const ids = svg.getAttribute("aria-labelledby")?.split(" ") ?? [];
  expect(ids).toHaveLength(2);
  expect(document.getElementById(ids[0] as string)?.textContent).toBe("Revenue");
  expect(document.getElementById(ids[1] as string)?.textContent).toContain("Series");
  expect(svg.querySelectorAll("rect,circle,path").length).toBeGreaterThan(0);
  await ui.unmount();
});

it("keeps the chart when an engine closes while the editor is open", async () => {
  const initial = withCharts(source(), [spec]);
  const f = fixture(initial);
  const ui = await mount(h(ChartWorkspace, { engine: f.engine, snapshot: initial }));
  await click(button("Edit chart"));
  await ui.render(h(ChartWorkspace, { engine: null, snapshot: initial }));
  await click(button("Delete chart"));
  expect(readCharts(f.engine.snapshot()).charts).toEqual([spec]);
  const missingSetter = { ...f.engine };
  delete missingSetter.setCharts;
  await ui.render(h(ChartWorkspace, { engine: missingSetter, snapshot: initial }));
  await submit();
  expect(readCharts(f.engine.snapshot()).charts).toEqual([spec]);
});
