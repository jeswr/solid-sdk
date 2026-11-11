// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ChartSpec, withCharts } from "../src/apps/sheets/lib/charts/spec";
import type { Snapshot } from "../src/apps/sheets/lib/contract";

const mock = vi.hoisted(() => {
  let data: Record<string, unknown>;
  let active = "data";
  let handler: (event: {
    type: number;
    id: string;
    params?: { unitId?: string };
    options?: { fromChangeset?: boolean; fromFormula?: boolean };
  }) => void;
  const subscription = { dispose: vi.fn() };
  let selection: string | null = "B2:C4";
  let calculated: () => void;
  const calculation = { dispose: vi.fn() };
  const workbook = {
    getId: () => "book",
    save: () => data,
    getActiveSheet: () => ({
      getSheetId: () => active,
      getSheetName: () => (data.sheets as Record<string, { name: string }>)[active]?.name,
      getActiveRange: () => (selection === null ? null : { getA1Notation: () => selection }),
    }),
    setEditable: vi.fn(),
    setActiveSheet: vi.fn((id: string) => {
      active = id;
    }),
  };
  const api = {
    getFormula: () => ({
      calculationResultApplied: (callback: () => void) => {
        calculated = callback;
        return calculation;
      },
    }),
    Event: { CommandExecuted: "executed" },
    createWorkbook: vi.fn((next: Record<string, unknown>) => {
      data = next;
      active = "data";
      return workbook;
    }),
    disposeUnit: vi.fn(),
    toggleDarkMode: vi.fn(),
    addEvent: vi.fn((_name: string, callback: typeof handler) => {
      handler = callback;
      return subscription;
    }),
  };
  const chartHistory = {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    interceptCommand: vi.fn(() => ({ dispose: vi.fn() })),
    interceptAfterCommand: vi.fn(() => ({ dispose: vi.fn() })),
  };
  const univer = {
    dispose: vi.fn(),
    // biome-ignore lint/style/useNamingConvention: match Univer's injector access method
    __getInjector: () => ({ get: () => chartHistory }),
  };
  return {
    api,
    workbook,
    univer,
    subscription,
    calculation,
    calculated: () => calculated(),
    select: (range: string | null) => {
      selection = range;
    },
    emit: (event: Parameters<typeof handler>[0]) => handler(event),
    create: vi.fn(() => ({ univer, univerAPI: api })),
    preset: vi.fn((_options: unknown) => ({ plugins: ["core"] })),
    dataValidationPreset: vi.fn(() => ({ plugins: ["data-validation"] })),
    conditionalFormattingPreset: vi.fn(() => ({ plugins: ["conditional-formatting"] })),
    mergeLocales: vi.fn((...values: object[]) => Object.assign({}, ...values)),
  };
});
vi.mock("@univerjs/preset-sheets-core", () => ({ UniverSheetsCorePreset: mock.preset }));
vi.mock("@univerjs/preset-sheets-core/locales/en-US", () => ({ default: { core: "Core" } }));
vi.mock("@univerjs/preset-sheets-data-validation", () => ({
  UniverSheetsDataValidationPreset: mock.dataValidationPreset,
}));
vi.mock("@univerjs/preset-sheets-data-validation/locales/en-US", () => ({
  default: { dataValidation: "Data validation" },
}));
vi.mock("@univerjs/preset-sheets-conditional-formatting", () => ({
  UniverSheetsConditionalFormattingPreset: mock.conditionalFormattingPreset,
}));
vi.mock("@univerjs/preset-sheets-conditional-formatting/locales/en-US", () => ({
  default: { conditionalFormatting: "Conditional formatting" },
}));
vi.mock("@univerjs/presets", () => ({
  CommandType: { MUTATION: 1 },
  ICommandService: "commands",
  createUniver: mock.create,
  LocaleType: { EN_US: "en-US" },
  mergeLocales: mock.mergeLocales,
}));

import { loadEngine } from "../src/apps/sheets/lib/engine";

function initial(): Snapshot {
  return {
    id: "book",
    name: "Book",
    sheetOrder: ["data"],
    sheets: {
      data: {
        id: "data",
        name: "Data",
        rowCount: 5,
        columnCount: 4,
        cellData: { 0: { 0: { v: "Header", t: 1 } }, 1: { 0: { v: "Value", t: 1 } } },
      },
    },
  };
}
const mutation = { type: 1, id: "sheet.set-cell", params: { unitId: "book" } };
async function mount(compact = false) {
  return (await loadEngine())({} as HTMLElement, { snapshot: initial(), dark: false, compact });
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.api.disposeUnit.mockReset();
});

describe("Univer engine adapter", () => {
  it("registers data validation and conditional formatting after core with their locales", async () => {
    const engine = await mount();
    expect(mock.dataValidationPreset).toHaveBeenCalledExactlyOnceWith();
    expect(mock.conditionalFormattingPreset).toHaveBeenCalledExactlyOnceWith();
    expect(mock.mergeLocales).toHaveBeenCalledExactlyOnceWith(
      { core: "Core" },
      { dataValidation: "Data validation" },
      { conditionalFormatting: "Conditional formatting" },
    );
    expect(mock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        presets: [
          { plugins: ["core"] },
          { plugins: ["data-validation"] },
          { plugins: ["conditional-formatting"] },
        ],
        locales: {
          "en-US": {
            core: "Core",
            dataValidation: "Data validation",
            conditionalFormatting: "Conditional formatting",
          },
        },
      }),
    );
    engine.dispose();
  });

  it.each([
    "data-validation.mutation.addRule",
    "data-validation.mutation.updateRule",
    "data-validation.mutation.removeRule",
    "sheet.mutation.add-conditional-rule",
    "sheet.mutation.set-conditional-rule",
    "sheet.mutation.move-conditional-rule",
    "sheet.mutation.delete-conditional-rule",
    "sheet.mutation.set-frozen",
    "sheet.mutation.add-worksheet-merge",
    "sheet.mutation.remove-worksheet-merge",
    "sheet.mutation.insert-row",
  ])("marks persisted user mutation %s dirty, including after reload", async (id) => {
    const engine = await mount();
    const change = vi.fn();
    engine.onChange(change);
    mock.emit({ ...mutation, id });
    await Promise.resolve();
    expect(change).toHaveBeenCalledTimes(1);
    engine.load(initial());
    mock.emit({ ...mutation, id });
    await Promise.resolve();
    expect(change).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  it.each([
    "sheet.mutation.data-validation-formula-mark-dirty",
    "formula.mutation.set-other-formula",
    "formula.mutation.remove-other-formula",
    "formula.mutation.set-formula-calculation-result",
  ])("ignores calculation-only mutation %s before and after a user edit", async (id) => {
    const engine = await mount();
    const change = vi.fn();
    engine.onChange(change);
    mock.emit({ ...mutation, id });
    await Promise.resolve();
    expect(change).not.toHaveBeenCalled();
    mock.emit(mutation);
    await Promise.resolve();
    change.mockClear();
    mock.emit({ ...mutation, id });
    await Promise.resolve();
    expect(change).not.toHaveBeenCalled();
    // Ignored traffic must not count as an edit after reloading either.
    engine.load(initial());
    mock.emit({ ...mutation, id });
    mock.emit({ ...mutation, options: { fromFormula: true } });
    await Promise.resolve();
    expect(change).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("ignores the other-formula dirty signal in the shape Univer sends it", async () => {
    const engine = await mount();
    const change = vi.fn();
    engine.onChange(change);
    // Univer keys this mutation's params by unit, sheet and formula id.
    mock.emit({
      type: 1,
      id: "sheet.mutation.data-validation-formula-mark-dirty",
      params: { book: { data: { formula: true } } } as { unitId?: string },
    });
    await Promise.resolve();
    expect(change).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("round-trips plugin resources, freeze and merge state through save and reload", async () => {
    const engine = await mount();
    const data = initial();
    data.resources = [
      { name: "SHEET_DATA_VALIDATION_PLUGIN", data: JSON.stringify({ data: [{ uid: "dv" }] }) },
      {
        name: "SHEET_CONDITIONAL_FORMATTING_PLUGIN",
        data: JSON.stringify({ data: [{ cfId: "cf" }] }),
      },
    ];
    const sheet = (data.sheets as Record<string, Snapshot>).data as Snapshot;
    sheet.freeze = { startRow: 1, startColumn: -1, ySplit: 1, xSplit: 0 };
    sheet.mergeData = [{ startRow: 2, endRow: 2, startColumn: 0, endColumn: 1 }];
    engine.load(data);
    const saved = engine.snapshot();
    expect(saved).toEqual(data);
    engine.dispose();
    const reloaded = await (await loadEngine())({} as HTMLElement, {
      snapshot: JSON.parse(JSON.stringify(saved)),
      dark: false,
      compact: false,
    });
    expect(mock.api.createWorkbook).toHaveBeenLastCalledWith(data);
    expect(reloaded.snapshot()).toEqual(data);
    reloaded.dispose();
  });

  it("mounts with the requested chrome, snapshots safely, exports and switches dark mode", async () => {
    const engine = await mount();
    expect(mock.preset.mock.calls[0]?.[0]).toMatchObject({
      header: true,
      toolbar: true,
      formulaBar: true,
      footer: { statisticBar: true },
    });
    const captured = engine.snapshot();
    expect(captured).toEqual(initial());
    captured.name = "Changed copy";
    expect(engine.snapshot().name).toBe("Book");
    expect(engine.activeSheet()).toEqual({ id: "data", name: "Data" });
    expect(engine.exportCsv()).toBe("Header\r\nValue\r\n");
    expect(engine.exportCsv("data")).toBe("Header\r\nValue\r\n");
    engine.setDark(true);
    expect(mock.api.toggleDarkMode).toHaveBeenCalledWith(true);
    engine.dispose();
    await mount(true);
    expect(mock.preset.mock.calls[1]?.[0]).toMatchObject({
      header: false,
      toolbar: false,
      footer: { statisticBar: false, menus: false, zoomSlider: false },
    });
  });

  it("filters initial calculations and unrelated events, coalesces user edits, and unsubscribes", async () => {
    const engine = await mount();
    const change = vi.fn();
    const unsubscribe = engine.onChange(change);
    mock.emit({ ...mutation, type: 2 });
    mock.emit({ ...mutation, options: { fromChangeset: true } });
    mock.emit({ ...mutation, id: "formula.calculate" });
    mock.emit({ ...mutation, params: { unitId: "other" } });
    mock.emit({ ...mutation, params: undefined } as unknown as typeof mutation);
    mock.emit({ ...mutation, options: { fromFormula: true } });
    await Promise.resolve();
    expect(change).not.toHaveBeenCalled();
    mock.emit(mutation);
    mock.emit(mutation);
    await Promise.resolve();
    expect(change).toHaveBeenCalledTimes(1);
    mock.emit({ ...mutation, options: { fromFormula: true } });
    await Promise.resolve();
    expect(change).toHaveBeenCalledTimes(2);
    // Named ranges are formula.* mutations but persisted user state.
    mock.emit({ ...mutation, id: "formula.mutation.set-defined-name" });
    await Promise.resolve();
    expect(change).toHaveBeenCalledTimes(3);
    unsubscribe();
    mock.emit(mutation);
    await Promise.resolve();
    expect(change).toHaveBeenCalledTimes(3);
    engine.dispose();
    expect(mock.subscription.dispose).toHaveBeenCalledOnce();
    expect(mock.univer.dispose).toHaveBeenCalledOnce();
  });

  it("fences queued notifications on load and disposal, including mutations raised during loading", async () => {
    const engine = await mount();
    const change = vi.fn();
    engine.onChange(change);
    mock.emit(mutation);
    mock.api.disposeUnit.mockImplementationOnce(() => {
      mock.emit(mutation);
    });
    engine.load(initial());
    await Promise.resolve();
    expect(change).not.toHaveBeenCalled();
    mock.emit(mutation);
    engine.dispose();
    await Promise.resolve();
    mock.emit(mutation);
    await Promise.resolve();
    expect(change).not.toHaveBeenCalled();
    expect(() => engine.load({ invalid: Number.NaN })).toThrow("JSON");
  });

  it("imports text CSVs into distinct new names or replaces the active sheet and preserves dimensions", async () => {
    const engine = await mount();
    const change = vi.fn();
    engine.onChange(change);
    engine.importCsv("Code,Formula\n001,=1+1", { mode: "new-sheet", name: " Data " });
    const imported = engine.activeSheet();
    expect(imported.name).toBe("Data (2)");
    expect(imported.id).not.toBe("data");
    expect(engine.exportCsv()).toBe("Code,Formula\r\n001,=1+1\r\n");
    const first = engine.snapshot();
    expect((first.sheets as Record<string, { rowCount: number }>)[imported.id]?.rowCount).toBe(
      1000,
    );
    engine.importCsv("Replacement", { mode: "replace-active", name: "Ignored" });
    expect(engine.activeSheet()).toEqual(imported);
    expect(engine.exportCsv()).toBe("Replacement\r\n");
    engine.importCsv("Default", { mode: "new-sheet" });
    expect(engine.activeSheet().name).toBe("Imported sheet");
    engine.importCsv("Blank name", { mode: "new-sheet", name: "   " });
    expect(engine.activeSheet().name).toBe("Imported sheet (2)");
    engine.load(initial());
    engine.importCsv("A,B,C,D,E\n1,2,3,4,5", { mode: "replace-active" });
    const replaced = engine.snapshot().sheets as Record<
      string,
      { rowCount: number; columnCount: number }
    >;
    expect(replaced.data).toMatchObject({ rowCount: 5, columnCount: 5 });
    await Promise.resolve();
    expect(change).toHaveBeenCalledOnce();
    engine.dispose();
  });
});

it("retains app chart specs on snapshots, CSV import and reload and exposes the current selection", async () => {
  const engine = await mount();
  expect(engine.selection?.()).toEqual({ sheetId: "data", range: "B2:C4" });
  mock.select(null);
  expect(engine.selection?.().range).toBe("A1");
  mock.select("B2:C4");
  const changed = vi.fn();
  const values = vi.fn();
  engine.onChange(changed);
  const off = engine.onValuesChange?.(values);
  const charts = { version: 1, entries: [{ id: "chart" }] };
  engine.setCharts?.(charts);
  charts.entries[0] = { id: "changed outside" };
  await Promise.resolve();
  expect(changed).toHaveBeenCalledOnce();
  expect(values).toHaveBeenCalledOnce();
  const saved = engine.snapshot();
  expect(saved.charts).toEqual({ version: 1, entries: [{ id: "chart" }] });
  engine.importCsv("Value\n1", { mode: "replace-active" });
  expect(engine.snapshot().charts).toEqual(saved.charts);
  engine.load(saved);
  expect(engine.snapshot().charts).toEqual(saved.charts);
  const fromMount = await (await loadEngine())({} as HTMLElement, {
    snapshot: saved,
    dark: false,
    compact: false,
  });
  expect(fromMount.snapshot().charts).toEqual(saved.charts);
  fromMount.dispose();
  off?.();
  mock.calculated();
  expect(values).toHaveBeenCalledOnce();
  engine.dispose();
});

it("refreshes chart values after applied formula results without another autosave", async () => {
  const engine = await mount();
  const changed = vi.fn();
  const values = vi.fn();
  engine.onChange(changed);
  engine.onValuesChange?.(values);
  mock.calculated();
  expect(values).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
  mock.api.disposeUnit.mockImplementationOnce(() => mock.calculated());
  engine.load(initial());
  expect(values).toHaveBeenCalledOnce();
  engine.dispose();
  mock.calculated();
  expect(values).toHaveBeenCalledOnce();
  expect(mock.calculation.dispose).toHaveBeenCalledOnce();
});

it("enforces view-only access at mount, after reload and after losing write access", async () => {
  const engine = await (await loadEngine())({} as HTMLElement, {
    snapshot: initial(),
    dark: false,
    compact: true,
    readOnly: true,
  });
  expect(mock.workbook.setEditable).toHaveBeenLastCalledWith(false);
  const change = vi.fn();
  engine.onChange(change);
  engine.importCsv("Blocked", { mode: "replace-active" });
  mock.emit(mutation);
  await Promise.resolve();
  expect(engine.snapshot()).toEqual(initial());
  expect(change).not.toHaveBeenCalled();
  engine.load(initial());
  expect(mock.workbook.setEditable).toHaveBeenLastCalledWith(false);
  engine.setReadOnly(false);
  expect(mock.workbook.setEditable).toHaveBeenLastCalledWith(true);
  mock.emit(mutation);
  engine.setReadOnly(true);
  await Promise.resolve();
  expect(change).not.toHaveBeenCalled();
  engine.setReadOnly(false);
  mock.emit(mutation);
  await Promise.resolve();
  expect(change).toHaveBeenCalledOnce();
  engine.dispose();
});

it.each([
  "insert",
  "edit",
  "delete",
] as const)("blocks chart %s in view-only snapshots and suppresses queued saves after losing write access", async (operation) => {
  const chart: ChartSpec = {
    id: "chart",
    sheetId: "data",
    range: "A1:B3",
    type: "column",
    title: "Revenue",
    legend: true,
    series: "columns",
  };
  const data = withCharts(initial(), operation === "insert" ? [] : [chart]);
  const next = withCharts(
    initial(),
    operation === "delete" ? [] : [{ ...chart, title: "Changed revenue" }],
  ).charts;
  const engine = await (await loadEngine())({} as HTMLElement, {
    snapshot: data,
    dark: false,
    compact: false,
    readOnly: true,
  });
  const change = vi.fn();
  engine.onChange(change);
  engine.setCharts?.(next);
  await Promise.resolve();
  expect(engine.snapshot()).toEqual(data);
  expect(change).not.toHaveBeenCalled();
  engine.load(data);
  engine.setCharts?.(next);
  await Promise.resolve();
  expect(engine.snapshot()).toEqual(data);
  expect(change).not.toHaveBeenCalled();
  engine.setReadOnly(false);
  engine.setCharts?.(next);
  expect(engine.snapshot().charts).toEqual(next);
  engine.setReadOnly(true);
  engine.setCharts?.(data.charts);
  await Promise.resolve();
  expect(engine.snapshot().charts).toEqual(next);
  expect(change).not.toHaveBeenCalled();
  engine.setReadOnly(false);
  engine.setCharts?.(data.charts);
  await Promise.resolve();
  expect(engine.snapshot()).toEqual(data);
  expect(change).toHaveBeenCalledOnce();
  engine.dispose();
});
