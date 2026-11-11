// AUTHORED-BY Codex GPT-6.1-Sol
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
  const events = new Map<string, () => void>();
  const selectionSubscription = { unsubscribe: vi.fn() };
  const sheetSubscription = { dispose: vi.fn() };
  const range = { getRow: () => 2, getColumn: () => 1 };
  const sheet = { getRange: vi.fn((cell: string) => cell), setActiveRange: vi.fn() };
  const subscription = { dispose: vi.fn() };
  const workbook = {
    getId: () => "book",
    getActiveCell: vi.fn(() => range as typeof range | null),
    getSheetBySheetId: vi.fn((id: string) => (id === "data" ? sheet : null)),
    save: () => data,
    getActiveSheet: () => ({
      getSheetId: () => active,
      getSheetName: () => (data.sheets as Record<string, { name: string }>)[active]?.name,
    }),
    setEditable: vi.fn(),
    setActiveSheet: vi.fn((id: string) => {
      active = id;
    }),
  };
  const api = {
    Event: {
      CommandExecuted: "executed",
      SelectionChanged: "selection",
      ActiveSheetChanged: "sheet",
    },
    createWorkbook: vi.fn((next: Record<string, unknown>) => {
      data = next;
      active = "data";
      return workbook;
    }),
    disposeUnit: vi.fn(),
    toggleDarkMode: vi.fn(),
    addEvent: vi.fn((_name: string, callback: typeof handler) => {
      if (_name === "executed") {
        handler = callback;
        return subscription;
      }
      events.set(_name, callback as unknown as () => void);
      return _name === "selection" ? selectionSubscription : sheetSubscription;
    }),
  };
  const interceptor = {
    interceptCommand: vi.fn(() => ({ dispose: vi.fn() })),
    interceptAfterCommand: vi.fn(() => ({ dispose: vi.fn() })),
  };
  const commandService = {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    beforeCommandExecuted: vi.fn(() => ({ dispose: vi.fn() })),
  };
  const univer = {
    dispose: vi.fn(),
    // biome-ignore lint/style/useNamingConvention: Univer API
    __getInjector: () => ({
      get: (token: string) =>
        token === "command-service"
          ? commandService
          : token === "selections"
            ? {
                // biome-ignore lint/style/useNamingConvention: Univer observable
                selectionChanged$: {
                  subscribe: (callback: () => void) => {
                    events.set("selection", callback);
                    return selectionSubscription;
                  },
                },
              }
            : interceptor,
    }),
  };
  return {
    api,
    workbook,
    sheet,
    range,
    selectionSubscription,
    sheetSubscription,
    select: () => events.get("selection")?.(),
    activate: () => events.get("sheet")?.(),
    univer,
    subscription,
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
vi.mock("@univerjs/core", async (original) => ({
  ...(await original<typeof import("@univerjs/core")>()),
  ICommandService: "command-service",
}));
vi.mock("@univerjs/sheets", () => ({
  SheetInterceptorService: "sheet-interceptors",
  SheetsSelectionsService: "selections",
}));
vi.mock("@univerjs/presets", () => ({
  CommandType: { MUTATION: 1 },
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
  expect(engine.importCsv("Blocked", { mode: "replace-active" })).toEqual({
    status: "blocked",
    reason: "read-only",
  });
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

it("holds editing from mount through comment loading without overriding access or dropping registered anchors", async () => {
  const engine = await (await loadEngine())({} as HTMLElement, {
    snapshot: initial(),
    dark: false,
    compact: true,
    commentsLoading: true,
  });
  expect(mock.workbook.setEditable).toHaveBeenLastCalledWith(false);
  engine.setReadOnly(false);
  expect(mock.workbook.setEditable).toHaveBeenLastCalledWith(false);
  engine.load(initial());
  expect(engine.importCsv("Blocked", { mode: "replace-active" })).toEqual({
    status: "blocked",
    reason: "comments-loading",
  });
  expect(engine.snapshot()).toEqual(initial());
  expect(mock.workbook.setEditable).toHaveBeenLastCalledWith(false);
  const change = vi.fn();
  engine.onChange(change);
  engine.registerCommentAnchors?.({ root: { sheetId: "data", cell: "B3", deleted: false } });
  engine.setCommentsLoading?.(false);
  expect(mock.workbook.setEditable).toHaveBeenLastCalledWith(true);
  await Promise.resolve();
  expect(change).toHaveBeenCalledOnce();
  expect(engine.snapshot().commentAnchors).toEqual({
    version: 1,
    anchors: { root: { sheetId: "data", cell: "B3" } },
  });
  engine.setCommentsLoading?.(true);
  engine.setReadOnly(true);
  engine.setCommentsLoading?.(false);
  expect(mock.workbook.setEditable).toHaveBeenLastCalledWith(false);
  engine.dispose();
});

it("bridges cell selections and structural events without the comments preset", async () => {
  const engine = await mount();
  const select = vi.fn();
  const structure = vi.fn();
  const offSelect = engine.onSelection?.(select);
  const offStructure = engine.onStructure?.(structure);
  expect(engine.selectedCell?.()).toEqual({ sheetId: "data", cell: "B3", deleted: false });
  mock.select();
  mock.activate();
  expect(select).toHaveBeenCalledTimes(2);
  engine.selectCell?.({ sheetId: "data", cell: "D5", deleted: false });
  expect(mock.sheet.setActiveRange).toHaveBeenCalledWith("D5");
  engine.selectCell?.({ sheetId: "data", cell: "D5", deleted: true });
  engine.selectCell?.({ sheetId: "missing", cell: "D5", deleted: false });
  expect(mock.sheet.setActiveRange).toHaveBeenCalledOnce();
  mock.workbook.getActiveCell.mockReturnValueOnce(null);
  expect(engine.selectedCell?.()).toBeUndefined();
  mock.emit({
    ...mutation,
    id: "sheet.mutation.insert-row",
    params: {
      unitId: "book",
      subUnitId: "data",
      range: { startRow: 2, endRow: 3 },
    } as typeof mutation.params,
  });
  expect(structure).toHaveBeenCalledWith({
    sheet: "data",
    axis: "row",
    kind: "insert",
    index: 3,
    count: 2,
  });
  offSelect?.();
  offStructure?.();
  mock.select();
  mock.emit({
    ...mutation,
    id: "sheet.mutation.remove-rows",
    params: {
      unitId: "book",
      subUnitId: "data",
      range: { startRow: 2, endRow: 3 },
    } as typeof mutation.params,
  });
  expect(select).toHaveBeenCalledTimes(3);
  expect(structure).toHaveBeenCalledOnce();
  engine.dispose();
  expect(mock.selectionSubscription.unsubscribe).toHaveBeenCalledOnce();
  expect(mock.sheetSubscription.dispose).toHaveBeenCalledOnce();
});

it("ignores unrelated interceptor commands and missing structural checkpoints, and preserves registered addresses", async () => {
  const engine = await mount();
  // Access the exact interceptor registered by the adapter, without mocking its behavior.
  const injector = mock.univer.__getInjector();
  const interceptors = injector.get("sheet-interceptors") as {
    interceptCommand: ReturnType<typeof vi.fn>;
    interceptAfterCommand: ReturnType<typeof vi.fn>;
  };
  const before = interceptors.interceptCommand.mock.calls.at(-1)?.[0] as {
    getMutations(command: { id: string }): unknown;
  };
  const after = interceptors.interceptAfterCommand.mock.calls.at(-1)?.[0] as typeof before;
  expect(before.getMutations({ id: "sheet.command.format" })).toEqual({ redos: [], undos: [] });
  expect(after.getMutations({ id: "sheet.command.format" })).toEqual({ redos: [], undos: [] });
  expect(after.getMutations({ id: "sheet.command.remove-row" })).toEqual({ redos: [], undos: [] });
  engine.registerCommentAnchors?.({ root: { sheetId: "data", cell: "B3", deleted: false } });
  engine.registerCommentAnchors?.({ root: { sheetId: "data", cell: "Z9", deleted: false } });
  expect(engine.snapshot().commentAnchors).toEqual({
    version: 1,
    anchors: { root: { sheetId: "data", cell: "B3" } },
  });
  engine.setReadOnly(true);
  engine.registerCommentAnchors?.({ other: { sheetId: "data", cell: "C4", deleted: false } });
  engine.dispose();
});

it("registers a persisted draft on view-only workbooks without scheduling a workbook write", async () => {
  const engine = await mount();
  const change = vi.fn();
  engine.onChange(change);
  engine.setReadOnly(true);
  const draft = engine.trackCommentDraft?.({ sheetId: "data", cell: "B3", deleted: false });
  draft?.commit("view-only-thread");
  await Promise.resolve();
  expect(engine.snapshot().commentAnchors).toEqual({
    version: 1,
    anchors: { "view-only-thread": { sheetId: "data", cell: "B3" } },
  });
  expect(change).not.toHaveBeenCalled();
  draft?.dispose();
  engine.dispose();
});
