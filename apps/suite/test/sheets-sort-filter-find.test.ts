// AUTHORED-BY Codex GPT-6.1-Sol

import type { IWorkbookData } from "@univerjs/core";
import type { FormulaDataModel } from "@univerjs/preset-sheets-core";
import type { IFindQuery, IFindReplaceService } from "@univerjs/preset-sheets-find-replace";
import { describe, expect, it, vi } from "vitest";

const headless = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const fromCore = createRequire(require.resolve("@univerjs/preset-sheets-core"));
  const fromFilter = createRequire(require.resolve("@univerjs/preset-sheets-filter"));
  const fromSort = createRequire(require.resolve("@univerjs/preset-sheets-sort"));
  const fromFind = createRequire(require.resolve("@univerjs/preset-sheets-find-replace"));
  const core = require("@univerjs/core") as typeof import("@univerjs/core");
  const sheets = require("@univerjs/sheets") as typeof import("@univerjs/sheets");
  const { FUniver } = require("@univerjs/core/facade") as typeof import("@univerjs/core/facade");
  require("@univerjs/sheets/facade");
  const formula = fromCore("@univerjs/engine-formula");
  fromCore("@univerjs/engine-formula/facade");
  const sheetsFormula = fromCore("@univerjs/sheets-formula");
  const sheetsUI = fromCore("@univerjs/sheets-ui");
  const sort = fromSort("@univerjs/sheets-sort");
  const filter = fromFilter("@univerjs/sheets-filter");
  fromFilter("@univerjs/sheets-filter/facade");
  const find = fromFind("@univerjs/find-replace");
  const sheetsFind = fromFind("@univerjs/sheets-find-replace");
  fromFind("@univerjs/sheets-find-replace/facade");
  const render = fromFind("@univerjs/engine-render");
  const { BehaviorSubject } = fromFind("rxjs");
  const create = () => {
    const scrollToRange = vi.fn(() => true);
    const univer = new core.Univer({
      locale: core.LocaleType.EN_US,
      locales: { [core.LocaleType.EN_US]: {} },
    });
    univer.registerPlugin(sheets.UniverSheetsPlugin);
    univer.registerPlugin(formula.UniverFormulaEnginePlugin);
    univer.registerPlugin(sheetsFormula.UniverSheetsFormulaPlugin);
    univer.registerPlugin(sort.UniverSheetsSortPlugin);
    univer.registerPlugin(filter.UniverSheetsFilterPlugin);
    const injector = univer.__getInjector();
    injector.add([find.IFindReplaceService, { useClass: find.FindReplaceService }]);
    // Only the canvas is absent: real provider, search model, replace commands and DI.
    injector.add([
      render.IRenderManagerService,
      {
        useValue: {
          getRenderUnitById: () => ({
            with: () => ({
              // biome-ignore lint/style/useNamingConvention: Univer observable
              currentSkeleton$: new BehaviorSubject(null),
              getCurrentSkeleton: () => null,
              scrollToRange,
            }),
          }),
        },
      },
    ]);
    const controller = injector.createInstance(sheetsFind.SheetsFindReplaceController) as {
      dispose(): void;
    };
    const commands = injector.get(core.ICommandService);
    commands.registerCommand(filter.SmartToggleSheetsFilterCommand);
    commands.registerCommand(sheetsUI.ScrollToCellCommand);
    for (const command of [find.OpenReplaceDialogOperation, find.ReplaceCurrentMatchCommand])
      commands.registerCommand(command);
    const api = FUniver.newAPI(univer);
    const dispose = univer.dispose.bind(univer);
    univer.dispose = () => {
      const service = injector.get(find.IFindReplaceService) as IFindReplaceService;
      for (const provider of service.getProviders()) provider.terminate();
      controller.dispose();
      dispose();
    };
    return { univer, univerAPI: api, scrollToRange };
  };
  return {
    core,
    sheets,
    formula,
    sort,
    filter,
    find,
    create,
    current: null as ReturnType<typeof create> | null,
  };
});
vi.mock("@univerjs/core", () => headless.core);
vi.mock("@univerjs/sheets", () => headless.sheets);
vi.mock("@univerjs/presets", () => ({
  CommandType: headless.core.CommandType,
  LocaleType: headless.core.LocaleType,
  mergeLocales: headless.core.mergeLocales,
  createUniver: () => {
    headless.current = headless.create();
    return headless.current;
  },
}));
vi.mock("@univerjs/preset-sheets-core", () => ({ UniverSheetsCorePreset: () => ({}) }));
vi.mock("@univerjs/preset-sheets-data-validation", () => ({
  UniverSheetsDataValidationPreset: () => ({}),
}));
vi.mock("@univerjs/preset-sheets-conditional-formatting", () => ({
  UniverSheetsConditionalFormattingPreset: () => ({}),
}));
vi.mock("@univerjs/preset-sheets-sort", () => ({
  ...headless.sort,
  UniverSheetsSortPreset: () => ({}),
}));
vi.mock("@univerjs/preset-sheets-filter", () => ({
  ...headless.filter,
  UniverSheetsFilterPreset: () => ({}),
}));
vi.mock("@univerjs/preset-sheets-find-replace", () => ({
  ...headless.find,
  UniverSheetsFindReplacePreset: () => ({}),
}));

import { readCharts, withCharts } from "../src/apps/sheets/lib/charts/spec";
import { currentCommentAnchor } from "../src/apps/sheets/lib/comments/anchors";
import type { MountEngineOptions } from "../src/apps/sheets/lib/contract";
import { mountUniver } from "../src/apps/sheets/lib/engine/univer";
import { csvToGrid, inferDescriptor, parseDescriptor } from "../src/apps/sheets/lib/model";
import { harness, snapshot } from "./sheets-workbook-helpers";

async function mount(
  data = snapshot("Name,Score\nZoe,3\nAmy,1\nBob,2", true),
  options: Partial<MountEngineOptions> = {},
) {
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: data,
    dark: false,
    compact: true,
    ...options,
  });
  const current = headless.current as ReturnType<typeof headless.create>;
  current.univer
    .__getInjector()
    .get(headless.core.IUniverInstanceService)
    .focusUnit(data.id as string);
  const sheet = () => {
    const sheet = current.univerAPI.getActiveWorkbook()?.getActiveSheet();
    if (!sheet) throw new Error("Missing active sheet");
    return sheet;
  };
  sheet().setActiveRange(sheet().getDataRange());
  const commands = current.univer.__getInjector().get(headless.core.ICommandService);
  return { engine, current, sheet, commands };
}

async function find(f: Awaited<ReturnType<typeof mount>>, query: Partial<IFindQuery>) {
  const service = f.current.univer
    .__getInjector()
    .get(headless.find.IFindReplaceService) as IFindReplaceService;
  const provider = [...service.getProviders()][0];
  if (!provider) throw new Error("Missing find provider");
  const models = await provider.find({
    findString: "cat",
    caseSensitive: false,
    matchesTheWholeCell: false,
    matchesTheWholeWord: false,
    findBy: headless.find.FindBy.VALUE,
    findDirection: headless.find.FindDirection.ROW,
    findScope: headless.find.FindScope.SUBUNIT,
    replaceRevealed: true,
    ...query,
  });
  const model = models[0];
  if (!model) throw new Error("Missing find model");
  return model;
}

describe("real Univer data tools", () => {
  it.each([
    "range",
    "sheet",
  ] as const)("sorts %s data below a merged header and preserves the merge through undo/redo", async (scope) => {
    const data = snapshot("Names,\nZoe,3\nAmy,1\nBob,2");
    const merge = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 };
    const sheet = (data as unknown as IWorkbookData).sheets.data;
    if (!sheet) throw new Error("Missing data sheet");
    sheet.mergeData = [merge];
    const f = await mount(data);
    try {
      expect(f.engine.sortRange?.({ scope, column: 0, ascending: true, header: true })).toEqual({
        status: "sorted",
      });
      const sorted = "Names,\r\nAmy,1\r\nBob,2\r\nZoe,3\r\n";
      expect(f.engine.exportCsv()).toBe(sorted);
      expect(f.sheet().getRange("A1:B1").isMerged()).toBe(true);
      expect(await f.current.univerAPI.undo()).toBe(true);
      expect(f.engine.exportCsv()).toBe("Names,\r\nZoe,3\r\nAmy,1\r\nBob,2\r\n");
      expect(await f.current.univerAPI.redo()).toBe(true);
      expect(f.engine.exportCsv()).toBe(sorted);
      expect(f.sheet().getRange("A1:B1").isMerged()).toBe(true);
    } finally {
      f.engine.dispose();
    }
  });

  it.each([
    { startRow: 0, header: false },
    { startRow: 1, header: true },
    { startRow: 1, header: false },
  ])("refuses nonuniform merged cells in the data (%j) before dispatching sort", async ({
    startRow,
    header,
  }) => {
    const data = snapshot("Name,Score\nZoe,3\nAmy,1\nBob,2");
    const sheet = (data as unknown as IWorkbookData).sheets.data;
    if (!sheet) throw new Error("Missing data sheet");
    sheet.mergeData = [{ startRow, endRow: startRow, startColumn: 0, endColumn: 1 }];
    const f = await mount(data);
    const dispatched = vi.fn();
    const subscription = f.commands.onCommandExecuted(dispatched);
    try {
      const before = f.engine.snapshot();
      expect(f.engine.sortRange?.({ scope: "range", column: 0, ascending: true, header })).toEqual({
        status: "blocked",
        reason: "Merged cells must be the same size to sort this range.",
      });
      expect(dispatched).not.toHaveBeenCalled();
      expect(f.engine.snapshot()).toEqual(before);
    } finally {
      subscription.dispose();
      f.engine.dispose();
    }
  });

  it("sorts ranges and sheets with headers without shifting comments, drafts or charts, including undo/redo", async () => {
    const chart = {
      id: "chart",
      sheetId: "data",
      range: "A1:B4",
      type: "column" as const,
      title: "Scores",
      series: "columns" as const,
      legend: true,
    };
    const f = await mount(withCharts(snapshot("Name,Score\nZoe,3\nAmy,1\nBob,2"), [chart]));
    const anchor = { sheetId: "data", cell: "A2", deleted: false };
    f.engine.registerCommentAnchors?.({ root: anchor });
    const draft = f.engine.trackCommentDraft?.(anchor);
    const changes = vi.fn();
    const structures = vi.fn();
    f.engine.onChange(changes);
    f.engine.onStructure?.(structures);
    const assertAnchors = () => {
      expect(currentCommentAnchor(f.engine.snapshot(), "root", anchor)).toEqual(anchor);
      expect(draft?.current()).toEqual(anchor);
      expect(readCharts(f.engine.snapshot()).charts).toEqual([chart]);
      expect(structures).not.toHaveBeenCalled();
    };
    try {
      expect(
        f.engine.sortRange?.({ scope: "range", column: 0, ascending: true, header: true }),
      ).toEqual({ status: "sorted" });
      expect(f.engine.exportCsv()).toBe("Name,Score\r\nAmy,1\r\nBob,2\r\nZoe,3\r\n");
      assertAnchors();
      await Promise.resolve();
      expect(changes).toHaveBeenCalled();
      expect(await f.current.univerAPI.undo()).toBe(true);
      assertAnchors();
      expect(await f.current.univerAPI.redo()).toBe(true);
      assertAnchors();
      expect(
        f.engine.sortRange?.({ scope: "sheet", column: 1, ascending: false, header: true }),
      ).toEqual({ status: "sorted" });
      expect(f.engine.exportCsv()).toBe("Name,Score\r\nZoe,3\r\nBob,2\r\nAmy,1\r\n");
      assertAnchors();
      expect(
        f.engine.sortRange?.({ scope: "sheet", column: 0, ascending: true, header: false }),
      ).toEqual({ status: "sorted" });
      expect(f.sheet().getRange("A1").getValue()).toBe("Amy");
    } finally {
      draft?.dispose();
      f.engine.dispose();
    }
  });

  it("round trips filter ranges and value/condition criteria through workbook.json and exports every row", async () => {
    const pod = await harness();
    const f = await mount();
    const anchor = { sheetId: "data", cell: "A2", deleted: false };
    f.engine.registerCommentAnchors?.({ root: anchor });
    const structures = vi.fn();
    f.engine.onStructure?.(structures);
    try {
      f.sheet()
        .getRange("B2:B4")
        .setValues([[3], [1], [2]]);
      expect(await f.engine.toggleFilter?.()).toBe(true);
      expect(f.engine.hasFilter?.()).toBe(true);
      const filter = f.sheet().getFilter();
      if (!filter) throw new Error("Missing filter");
      filter.setColumnFilterCriteria(0, { colId: 0, filters: { filters: ["Amy", "Bob"] } });
      filter.setColumnFilterCriteria(1, {
        colId: 1,
        customFilters: {
          customFilters: [
            { operator: headless.filter.CustomFilterOperator.GREATER_THAN, val: "1" },
          ],
        },
      });
      expect(filter.getFilteredOutRows()).toEqual([1, 2]);
      expect(currentCommentAnchor(f.engine.snapshot(), "root", anchor)).toEqual(anchor);
      expect(structures).not.toHaveBeenCalled();
      f.sheet().getRange("B2").setValue("hidden text");
      const criteria = filter.getColumnFilterCriteria(0);
      const data = f.engine.snapshot();
      const book = await pod.service.create({ title: "Filters", snapshot: data });
      await pod.service.save(book.container, book.snapshot, book.version);
      const opened = await pod.service.open(book.container);
      expect(opened.snapshot).toEqual(book.snapshot);
      expect(opened.snapshot.resources).toEqual(data.resources);
      f.engine.load(opened.snapshot);
      expect(f.sheet().getFilter()?.getFilteredOutRows()).toEqual([1, 2]);
      expect(f.sheet().getFilter()?.getColumnFilterCriteria(0)).toEqual(criteria);
      const csv = "Name,Score\r\nZoe,hidden text\r\nAmy,1\r\nBob,2\r\n";
      expect(f.engine.exportCsv()).toBe(csv);
      expect(await (await pod.fetch(`${book.container}sheets/1.csv`)).text()).toBe(csv);
      const descriptor = await (await pod.fetch(`${book.container}sheets/1.jsonld`)).text();
      const parsed = await parseDescriptor(book.container, 1, descriptor);
      expect(parsed).toEqual(inferDescriptor("Data", csvToGrid(csv)));
      expect(parsed.columns[1]?.type).toBe("text");
      expect(await f.engine.clearFilter?.()).toBe(true);
      expect(f.sheet().getFilter()?.getFilteredOutRows()).toEqual([]);
      expect(await f.engine.toggleFilter?.()).toBe(true);
      expect(f.engine.hasFilter?.()).toBe(false);
    } finally {
      f.engine.dispose();
    }
  });

  it.each([
    false,
    true,
  ])("finds and replaces with match-case and whole-cell (case sensitive: %s)", async (matchCase) => {
    const f = await mount(snapshot("Word\nCat\ncat\ncatfish", true));
    try {
      f.sheet().setActiveRange(f.sheet().getRange("A1"));
      const finder = await find(f, {
        findString: "cat",
        caseSensitive: matchCase,
        matchesTheWholeCell: true,
      });
      expect(finder.getMatches().map((match) => match.range)).toEqual(
        (matchCase ? [2] : [1, 2]).map((row) => ({
          subUnitId: "data",
          range: { startRow: row, endRow: row, startColumn: 0, endColumn: 0 },
        })),
      );
      expect(await finder.replaceAll("Dog")).toEqual({ success: matchCase ? 1 : 2, failure: 0 });
      expect(f.engine.exportCsv()).toBe(
        `Word\r\n${matchCase ? "Cat" : "Dog"}\r\nDog\r\ncatfish\r\n`,
      );
    } finally {
      f.engine.dispose();
    }
  });
});

it.each([
  "view-only",
  "comments-loading",
] as const)("allows finding and local filtering but blocks sorting and replacement while %s", async (lock) => {
  const f = await mount(snapshot("Word\nCat\ncat\ncatfish", true), {
    readOnly: lock === "view-only",
    commentsLoading: lock === "comments-loading",
  });
  const changed = vi.fn();
  const values = vi.fn();
  f.engine.onChange(changed);
  f.engine.onValuesChange?.(values);
  try {
    const before = f.engine.exportCsv();
    const finder = await find(f, { matchesTheWholeCell: true });
    expect(finder.getMatches()).toHaveLength(2);
    expect(await finder.replaceAll("Dog")).toBe(false);
    // The native single-replacement path uses set-range-values directly.
    finder.moveToNextMatch({ noFocus: true });
    expect(await finder.replace("Dog")).toBe(false);
    expect(
      f.engine.sortRange?.({ scope: "sheet", column: 0, ascending: true, header: true }),
    ).toEqual({
      status: "blocked",
      reason:
        lock === "view-only"
          ? "This spreadsheet is view only."
          : "Wait for comments to finish loading before sorting.",
    });
    expect(
      await f.commands.executeCommand(headless.sort.SortRangeCommand.id, {
        unitId: "original",
        subUnitId: "data",
        range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 0 },
        hasTitle: true,
        orderRules: [{ colIndex: 0, type: headless.sort.SortType.ASC }],
      }),
    ).toBe(false);
    expect(await f.engine.toggleFilter?.()).toBe(true);
    f.sheet()
      .getFilter()
      ?.setColumnFilterCriteria(0, { colId: 0, filters: { filters: ["cat"] } });
    expect(f.sheet().getFilter()?.getFilteredOutRows()).toEqual([1, 3]);
    expect(f.engine.exportCsv()).toBe(before);
    if (lock === "view-only") {
      await Promise.resolve();
      expect(changed).not.toHaveBeenCalled();
      expect(values).toHaveBeenCalled();
      const data = f.engine.snapshot();
      expect(JSON.stringify(data.resources)).not.toContain('"colId":0');
      // Restoring Write discards local filter state and its undo entries.
      f.engine.setReadOnly(false);
      expect(f.engine.hasFilter?.()).toBe(false);
      expect(await f.current.univerAPI.undo()).toBe(false);
    } else {
      f.engine.setCommentsLoading?.(false);
      expect(await f.engine.clearFilter?.()).toBe(true);
      const unlocked = await find(f, { matchesTheWholeCell: true });
      expect(await unlocked.replaceAll("Dog")).toEqual({ success: 2, failure: 0 });
    }
  } finally {
    f.engine.dispose();
  }
});

it("navigates Find matches across worksheets and changes selection while comments load, but blocks edits and history", async () => {
  const data = snapshot("Word\nCat\ncat", true);
  const other = (data as unknown as IWorkbookData).sheets.other;
  if (!other) throw new Error("Missing other sheet");
  other.cellData = { 1: { 0: { v: "cat", t: headless.core.CellValueType.STRING } } };
  const f = await mount(data, { commentsLoading: true });
  try {
    const before = f.engine.exportCsv();
    const finder = await find(f, {
      findScope: headless.find.FindScope.UNIT,
      matchesTheWholeCell: true,
    });
    expect(finder.getMatches()).toHaveLength(3);
    const range = { startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 };
    finder.moveToNextMatch({ ignoreSelection: true });
    expect(f.current.scrollToRange).toHaveBeenLastCalledWith(range, undefined, undefined);
    finder.moveToNextMatch();
    expect(f.current.scrollToRange).toHaveBeenLastCalledWith(
      { ...range, startRow: 2, endRow: 2 },
      undefined,
      undefined,
    );
    finder.moveToNextMatch();
    await vi.waitFor(() => expect(f.engine.activeSheet().id).toBe("other"));
    expect(f.current.scrollToRange).toHaveBeenLastCalledWith(range, undefined, undefined);
    expect(f.current.scrollToRange).toHaveBeenCalledTimes(3);
    expect(
      await f.commands.executeCommand(headless.sheets.SelectRangeCommand.id, {
        unitId: "original",
        subUnit: "other",
        range,
      }),
    ).toBe(true);
    expect(f.engine.selection?.()).toEqual({ sheetId: "other", range: "A2" });
    expect(
      await f.commands.executeCommand(headless.sheets.SetRangeValuesCommand.id, {
        unitId: "original",
        subUnitId: "data",
        range,
        value: { 1: { 0: { v: "Changed" } } },
      }),
    ).toBe(false);
    expect(await f.current.univerAPI.undo()).toBe(false);
    expect(await f.current.univerAPI.redo()).toBe(false);
    expect(f.engine.exportCsv("data")).toBe(before);
  } finally {
    f.engine.dispose();
  }
});

it("retains saved filters across permission loss and discards subsequent local changes on download, copy and unlock", async () => {
  const f = await mount();
  try {
    await f.engine.toggleFilter?.();
    f.sheet()
      .getFilter()
      ?.setColumnFilterCriteria(0, { colId: 0, filters: { filters: ["Amy"] } });
    const baseline = f.engine.snapshot().resources;
    f.engine.setReadOnly(true);
    expect(await f.engine.toggleFilter?.()).toBe(true);
    expect(f.engine.hasFilter?.()).toBe(false);
    expect(f.engine.snapshot().resources).toEqual(baseline);
    const saved = f.engine.snapshot();
    f.engine.load(saved);
    expect(f.sheet().getFilter()?.getFilteredOutRows()).toEqual([1, 3]);
    f.sheet()
      .getFilter()
      ?.setColumnFilterCriteria(0, { colId: 0, filters: { filters: ["Bob"] } });
    expect(f.sheet().getFilter()?.getFilteredOutRows()).toEqual([1, 2]);
    f.engine.setReadOnly(false);
    expect(f.sheet().getFilter()?.getFilteredOutRows()).toEqual([1, 3]);
  } finally {
    f.engine.dispose();
  }
});

it("searches formulas and all sheets and replaces through ordinary cell mutations", async () => {
  const data = snapshot("Word,Formula\ncat,0\ncatfish,0", true);
  const sheets = data.sheets as Record<
    string,
    { cellData: Record<string, Record<string, unknown>> }
  >;
  const dataRow = sheets.data?.cellData["1"];
  const otherRow = sheets.other?.cellData["1"];
  if (!dataRow || !otherRow) throw new Error("Missing test cells");
  dataRow["1"] = { f: '=CONCAT("cat","fish")', v: "catfish", t: 1 };
  otherRow["0"] = { v: "cat", t: 1 };
  const f = await mount(data);
  try {
    const withinSheet = await find(f, { matchesTheWholeCell: true });
    expect(withinSheet.getMatches()).toHaveLength(1);
    const all = await find(f, {
      findScope: headless.find.FindScope.UNIT,
      matchesTheWholeCell: true,
    });
    expect(all.getMatches()).toHaveLength(2);
    expect(await all.replaceAll("dog")).toEqual({ success: 2, failure: 0 });
    const formulas = await find(f, { findString: "CONCAT", findBy: headless.find.FindBy.FORMULA });
    expect(formulas.getMatches()).toHaveLength(1);
    expect(await formulas.replaceAll("CONCATENATE")).toEqual({ success: 1, failure: 0 });
    expect(f.sheet().getRange("B2").getFormula()).toBe('=CONCATENATE("cat","fish")');
    expect(
      f.current.univerAPI
        .getActiveWorkbook()
        ?.getSheetBySheetId("other")
        ?.getRange("A2")
        .getValue(),
    ).toBe("dog");
  } finally {
    f.engine.dispose();
  }
});

it("opens the native find dialog and rejects invalid sort columns and header-only ranges", async () => {
  const f = await mount();
  try {
    await f.engine.findReplace?.();
    const service = f.current.univer
      .__getInjector()
      .get(headless.find.IFindReplaceService) as IFindReplaceService;
    expect(service.revealed).toBe(true);
    expect(service.replaceRevealed).toBe(true);
    for (const column of [-1, 2, Number.NaN, 0.5]) {
      expect(
        f.engine.sortRange?.({ scope: "range", column, ascending: true, header: true }),
      ).toEqual({
        status: "blocked",
        reason: "Select a range with data and enter a column within it.",
      });
    }
    f.sheet().setActiveRange(f.sheet().getRange("A1:B1"));
    expect(
      f.engine.sortRange?.({ scope: "range", column: 0, ascending: true, header: true }),
    ).toEqual({
      status: "blocked",
      reason: "Select a range with data and enter a column within it.",
    });
  } finally {
    f.engine.dispose();
  }
});

it("applies Univer's native single-row, empty-range and array-formula sort validation", async () => {
  const data = snapshot("Name,Score\nZoe,3\nAmy,1\nBob,2");
  const sheet = (data as unknown as IWorkbookData).sheets.data;
  if (!sheet) throw new Error("Missing data sheet");
  sheet.rowCount = 12;
  const f = await mount(data);
  try {
    f.sheet().setActiveRange(f.sheet().getRange("A1:B2"));
    expect(
      f.engine.sortRange?.({ scope: "range", column: 0, ascending: true, header: true }),
    ).toEqual({
      status: "blocked",
      reason: "Select at least two data rows to sort.",
    });
    f.sheet().setActiveRange(f.sheet().getRange("A10:B12"));
    expect(
      f.engine.sortRange?.({ scope: "range", column: 0, ascending: true, header: false }),
    ).toEqual({
      status: "blocked",
      reason: "Select a range with data to sort.",
    });
    f.sheet().setActiveRange(f.sheet().getRange("A1:B4"));
    f.current.univer
      .__getInjector()
      .get<FormulaDataModel>(headless.formula.FormulaDataModel)
      .setArrayFormulaRange({
        original: { data: { 1: { 1: { startRow: 1, endRow: 3, startColumn: 1, endColumn: 1 } } } },
      });
    expect(
      f.engine.sortRange?.({ scope: "range", column: 0, ascending: true, header: true }),
    ).toEqual({
      status: "blocked",
      reason: "Ranges containing array formulas cannot be sorted.",
    });
  } finally {
    f.engine.dispose();
  }
});

it("reports missing selections and sort commands refused after validation", async () => {
  const f = await mount();
  const guard = f.commands.beforeCommandExecuted((command) => {
    if (command.id === headless.sort.SortRangeCommand.id) throw new headless.core.CanceledError();
  });
  try {
    expect(
      f.engine.sortRange?.({ scope: "range", column: 0, ascending: true, header: true }),
    ).toEqual({
      status: "blocked",
      reason: "Couldn't sort this range.",
    });
    f.current.univer.__getInjector().get(headless.sheets.SheetsSelectionsService).setSelections([]);
    expect(
      f.engine.sortRange?.({ scope: "range", column: 0, ascending: true, header: false }),
    ).toEqual({
      status: "blocked",
      reason: "Select a range with data and enter a column within it.",
    });
  } finally {
    guard.dispose();
    f.engine.dispose();
  }
});
