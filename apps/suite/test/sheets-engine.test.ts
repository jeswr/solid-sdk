// AUTHORED-BY Codex GPT-6
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  const workbook = {
    getId: () => "book",
    save: () => data,
    getActiveSheet: () => ({
      getSheetId: () => active,
      getSheetName: () => (data.sheets as Record<string, { name: string }>)[active]?.name,
    }),
    setActiveSheet: vi.fn((id: string) => {
      active = id;
    }),
  };
  const api = {
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
  const univer = { dispose: vi.fn() };
  return {
    api,
    univer,
    subscription,
    emit: (event: Parameters<typeof handler>[0]) => handler(event),
    create: vi.fn(() => ({ univer, univerAPI: api })),
    preset: vi.fn(),
  };
});
vi.mock("@univerjs/preset-sheets-core", () => ({ UniverSheetsCorePreset: mock.preset }));
vi.mock("@univerjs/preset-sheets-core/locales/en-US", () => ({ default: {} }));
vi.mock("@univerjs/presets", () => ({
  CommandType: { MUTATION: 1 },
  createUniver: mock.create,
  LocaleType: { EN_US: "en-US" },
  mergeLocales: (value: unknown) => value,
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
    unsubscribe();
    mock.emit(mutation);
    await Promise.resolve();
    expect(change).toHaveBeenCalledTimes(2);
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
