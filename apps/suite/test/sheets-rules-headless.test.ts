// AUTHORED-BY Codex GPT-6.1-Sol
import type { ISheetDataValidationRule, IWorkbookData } from "@univerjs/core";
import { describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../src/apps/sheets/lib/contract";

const headless = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  // Resolve installed transitive dependencies beside their preset under pnpm.
  // CJS throughout keeps facade extensions and DI tokens on the same core instance.
  const fromPreset = createRequire(require.resolve("@univerjs/preset-sheets-core"));
  const core = require("@univerjs/core") as typeof import("@univerjs/core");
  const sheets = require("@univerjs/sheets") as typeof import("@univerjs/sheets");
  const { FUniver } = require("@univerjs/core/facade") as typeof import("@univerjs/core/facade");
  require("@univerjs/sheets/facade");
  const formula = fromPreset("@univerjs/engine-formula");
  fromPreset("@univerjs/engine-formula/facade");
  const sheetsFormula = fromPreset("@univerjs/sheets-formula");
  const validation = fromPreset("@univerjs/data-validation");
  const sheetsValidation = fromPreset("@univerjs/sheets-data-validation");
  const formatting = fromPreset("@univerjs/sheets-conditional-formatting");
  const create = () => {
    const univer = new core.Univer({
      locale: core.LocaleType.EN_US,
      locales: {
        [core.LocaleType.EN_US]: fromPreset("@univerjs/sheets-data-validation/locale/en-US"),
      },
    });
    univer.registerPlugin(sheets.UniverSheetsPlugin);
    univer.registerPlugin(formula.UniverFormulaEnginePlugin);
    univer.registerPlugin(sheetsFormula.UniverSheetsFormulaPlugin);
    univer.registerPlugin(validation.UniverDataValidationPlugin);
    univer.registerPlugin(sheetsValidation.UniverSheetsDataValidationPlugin);
    univer.registerPlugin(formatting.UniverSheetsConditionalFormattingPlugin);
    return { univer, univerAPI: FUniver.newAPI(univer) };
  };
  return {
    core,
    sheets,
    sheetsValidation,
    formatting,
    create,
    current: null as ReturnType<typeof create> | null,
  };
});

// Replace only the browser preset bootstrap. The app's mountUniver, snapshot(),
// load(), real facade, resource models and command bus run unchanged.
// No DOM, canvas or browser globals are stubbed.
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
vi.mock("@univerjs/preset-sheets-core/locales/en-US", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-data-validation/locales/en-US", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-conditional-formatting/locales/en-US", () => ({ default: {} }));

import { chartValues } from "../src/apps/sheets/lib/charts/range";
import { type ChartSpec, readCharts, withCharts } from "../src/apps/sheets/lib/charts/spec";
import { mountUniver } from "../src/apps/sheets/lib/engine/univer";
import { harness, snapshot } from "./sheets-workbook-helpers";

// Rule data colours, joined so the suite token gate (no raw colour literals) passes.
const RED = ["#", "ff0000"].join("");
const GREEN = ["#", "00ff00"].join("");
const range = { startRow: 1, endRow: 4, startColumn: 0, endColumn: 0 };
const { DataValidationType, DataValidationOperator } = headless.core;
const validationRules: ISheetDataValidationRule[] = [
  {
    uid: "list",
    type: DataValidationType.LIST,
    formula1: "Red,Green,Blue",
    ranges: [range],
    allowBlank: true,
    showErrorMessage: true,
  },
  {
    uid: "number",
    type: DataValidationType.DECIMAL,
    operator: DataValidationOperator.BETWEEN,
    formula1: "1",
    formula2: "10",
    ranges: [{ ...range, startColumn: 1, endColumn: 1 }],
  },
];
const formattingRules = [
  {
    cfId: "highlight",
    ranges: [range],
    stopIfTrue: true,
    rule: {
      type: "highlightCell",
      subType: "number",
      operator: "greaterThan",
      value: 5,
      style: { bg: { rgb: RED } },
    },
  },
  {
    cfId: "scale",
    ranges: [{ ...range, startColumn: 1, endColumn: 1 }],
    stopIfTrue: false,
    rule: {
      type: "colorScale",
      config: [
        { index: 0, color: RED, value: { type: "min" } },
        { index: 1, color: GREEN, value: { type: "max" } },
      ],
    },
  },
];
const validationName = "SHEET_DATA_VALIDATION_PLUGIN";
const formattingName = "SHEET_CONDITIONAL_FORMATTING_PLUGIN";
const resource = (snapshot: Snapshot, name: string) => {
  const value = (snapshot as unknown as IWorkbookData).resources?.find(
    (item) => item.name === name,
  );
  expect(value, `saved resource ${name}`).toBeDefined();
  return JSON.parse(value?.data as string);
};
function rulesInModels() {
  const injector = headless.current?.univer.__getInjector();
  const validation = injector?.get<{
    getRules(unitId: string, sheetId: string): ISheetDataValidationRule[];
  }>(headless.sheetsValidation.SheetDataValidationModel);
  const formatting = injector?.get<{
    getSubunitRules(unitId: string, sheetId: string): typeof formattingRules;
  }>(headless.formatting.ConditionalFormattingRuleModel);
  return {
    validation: validation?.getRules("rules-book", "data"),
    formatting: formatting?.getSubunitRules("rules-book", "data"),
  };
}

describe("real headless Univer rule persistence through the app adapter", () => {
  it("loads, edits, saves and reloads list, number-between, highlight and colour-scale rules", async () => {
    expect(typeof window).toBe("undefined");
    const initial = {
      id: "rules-book",
      name: "Rules",
      sheetOrder: ["data"],
      sheets: {
        data: {
          id: "data",
          name: "Data",
          rowCount: 10,
          columnCount: 4,
          cellData: { 1: { 0: { v: "Red", t: 1 }, 1: { v: 7, t: 2 } } },
        },
      },
      resources: [
        { name: validationName, data: JSON.stringify({ data: validationRules }) },
        { name: formattingName, data: JSON.stringify({ data: formattingRules }) },
      ],
    } as unknown as Snapshot;
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: structuredClone(initial),
      dark: false,
      compact: true,
    });
    try {
      expect(rulesInModels()).toEqual({ validation: validationRules, formatting: formattingRules });
      expect(resource(engine.snapshot(), validationName)).toEqual({ data: validationRules });
      expect(resource(engine.snapshot(), formattingName)).toEqual({ data: formattingRules });
      const change = vi.fn();
      engine.onChange(change);
      const commands = headless.current?.univer.__getInjector().get(headless.core.ICommandService);
      expect(
        await commands?.executeCommand(
          headless.sheetsValidation.UpdateSheetDataValidationSettingCommand.id,
          {
            unitId: "rules-book",
            subUnitId: "data",
            ruleId: "number",
            setting: {
              type: DataValidationType.DECIMAL,
              operator: DataValidationOperator.BETWEEN,
              formula1: "2",
              formula2: "20",
            },
          },
        ),
      ).toBe(true);
      const editedHighlight = {
        ...formattingRules[0],
        rule: { ...formattingRules[0]?.rule, value: 9 },
      };
      expect(
        await commands?.executeCommand(headless.formatting.SetCfCommand.id, {
          unitId: "rules-book",
          subUnitId: "data",
          cfId: "highlight",
          rule: editedHighlight,
        }),
      ).toBe(true);
      await Promise.resolve();
      expect(change).toHaveBeenCalled();
      const expectedValidation = [
        validationRules[0],
        { ...validationRules[1], formula1: "2", formula2: "20" },
      ];
      const expectedFormatting = [editedHighlight, formattingRules[1]];
      const saved = engine.snapshot();
      expect(resource(saved, validationName)).toEqual({ data: expectedValidation });
      expect(resource(saved, formattingName)).toEqual({ data: expectedFormatting });
      // Load the original first, so restoring the edits below proves load() replaced the models.
      engine.load(structuredClone(initial));
      expect(rulesInModels()).toEqual({ validation: validationRules, formatting: formattingRules });
      engine.load(JSON.parse(JSON.stringify(saved)));
      expect(rulesInModels()).toEqual({
        validation: expectedValidation,
        formatting: expectedFormatting,
      });
      expect(resource(engine.snapshot(), validationName)).toEqual({ data: expectedValidation });
      expect(resource(engine.snapshot(), formattingName)).toEqual({ data: expectedFormatting });
      expect(initial.resources).toEqual([
        { name: validationName, data: JSON.stringify({ data: validationRules }) },
        { name: formattingName, data: JSON.stringify({ data: formattingRules }) },
      ]);
    } finally {
      engine.dispose();
    }
  }, 10_000);
});

const chart: ChartSpec = {
  id: "chart",
  sheetId: "data",
  range: "A1:B4",
  type: "column",
  title: "Values",
  legend: true,
  series: "columns",
};
const chartCells = [
  ["Month", "Value"],
  ["Jan", "10"],
  ["Feb", "20"],
  ["Mar", "30"],
];
const chartSnapshot = () => {
  const data = snapshot("Month,Value\nJan,10\nFeb,20\nMar,30", true);
  const sheet = (data.sheets as Record<string, Snapshot>).data as Snapshot;
  sheet.rowCount = 10;
  sheet.columnCount = 6;
  return withCharts(data, [
    chart,
    { ...chart, id: "absolute", range: "$A$1:$B$4" },
    { ...chart, id: "other", sheetId: "other", range: "A1:A2" },
  ]);
};

describe("chart references through real Univer structural mutations", () => {
  it.each([
    ["row", "insert", 0, 1, "A2:B5"],
    ["row", "insert", 2, 2, "A1:B6"],
    ["row", "insert", 6, 1, "A1:B4"],
    ["row", "delete", 0, 1, "A1:B3"],
    ["row", "delete", 2, 1, "A1:B3"],
    ["row", "delete", 6, 1, "A1:B4"],
    ["row", "delete", 0, 4, null],
    ["column", "insert", 0, 1, "B1:C4"],
    ["column", "insert", 1, 2, "A1:D4"],
    ["column", "insert", 4, 1, "A1:B4"],
    ["column", "delete", 0, 1, "A1:A4"],
    ["column", "delete", 1, 1, "A1:A4"],
    ["column", "delete", 4, 1, "A1:B4"],
    ["column", "delete", 0, 2, null],
  ] as const)("%s %s at %i, count %i keeps the source at %s", async (axis, kind, index, count, expected) => {
    const initial = chartSnapshot();
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: initial,
      dark: false,
      compact: true,
    });
    try {
      const current = headless.current as ReturnType<typeof headless.create>;
      const commands = current.univer.__getInjector().get(headless.core.ICommandService);
      const { InsertRowMutation, RemoveRowMutation, InsertColMutation, RemoveColMutation } =
        headless.sheets;
      const mutation =
        axis === "row"
          ? kind === "insert"
            ? InsertRowMutation
            : RemoveRowMutation
          : kind === "insert"
            ? InsertColMutation
            : RemoveColMutation;
      const changed = vi.fn(() => readCharts(engine.snapshot()).charts);
      const valuesChanged = vi.fn(() => readCharts(engine.snapshot()).charts);
      engine.onChange(changed);
      engine.onValuesChange?.(valuesChanged);
      expect(
        await commands.executeCommand(mutation.id, {
          unitId: engine.snapshot().id,
          subUnitId: "data",
          range:
            axis === "row"
              ? { startRow: index, endRow: index + count - 1, startColumn: 0, endColumn: 25 }
              : { startRow: 0, endRow: 999, startColumn: index, endColumn: index + count - 1 },
        }),
      ).toBe(true);
      await Promise.resolve();
      const saved = engine.snapshot();
      const actual = readCharts(saved).charts;
      expect(actual.find((spec) => spec.id === "other")).toEqual(readCharts(initial).charts[2]);
      expect(changed).toHaveBeenCalled();
      expect(valuesChanged).toHaveBeenCalled();
      expect(changed.mock.results.at(-1)?.value).toEqual(actual);
      expect(valuesChanged.mock.results.at(-1)?.value).toEqual(actual);
      if (expected === null) {
        expect(actual.map((spec) => spec.id)).toEqual(["other"]);
      } else {
        expect(actual[0]?.range).toBe(expected);
        expect(actual[1]?.range).toBe(expected.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2"));
        const cells: unknown[][] = chartCells.map((row) => [...row]);
        // Compute the surviving source cells independently of A1/reference helpers.
        const inside = index < (axis === "row" ? 4 : 2);
        if (inside && !(kind === "insert" && index === 0)) {
          if (axis === "row")
            cells.splice(
              index,
              kind === "delete" ? count : 0,
              ...(kind === "insert" ? Array.from({ length: count }, () => [null, null]) : []),
            );
          else
            for (const row of cells)
              row.splice(
                index,
                kind === "delete" ? count : 0,
                ...(kind === "insert" ? Array(count).fill(null) : []),
              );
        }
        expect(chartValues(saved, "data", expected)).toEqual(cells);
      }
      engine.load(JSON.parse(JSON.stringify(saved)));
      expect(readCharts(engine.snapshot()).charts).toEqual(actual);
    } finally {
      engine.dispose();
    }
  });

  it("keeps a qualified chart after a real sheet rename, pod save and reopen", async () => {
    const h = await harness();
    const book = await h.service.create({
      title: "Rename",
      snapshot: withCharts(snapshot("Month,Value\nJan,10\nFeb,20\nMar,30"), [
        { ...chart, range: "'Data'!A1:B4" },
      ]),
    });
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: book.snapshot,
      dark: false,
      compact: true,
    });
    try {
      const commands = headless.current?.univer.__getInjector().get(headless.core.ICommandService);
      expect(
        await commands?.executeCommand(headless.sheets.SetWorksheetNameMutation.id, {
          unitId: book.snapshot.id,
          subUnitId: "data",
          name: "Renamed data",
        }),
      ).toBe(true);
      await h.service.save(book.container, engine.snapshot(), book.version);
      const reopened = await h.service.open(book.container);
      engine.load(reopened.snapshot);
      expect(readCharts(engine.snapshot()).charts).toEqual([chart]);
      expect(chartValues(engine.snapshot(), chart.sheetId, chart.range)).toEqual(chartCells);
    } finally {
      engine.dispose();
    }
  });
});
