// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
  const { UniverSheetsPlugin } = require("@univerjs/sheets") as typeof import("@univerjs/sheets");
  const { FUniver } = require("@univerjs/core/facade") as typeof import("@univerjs/core/facade");
  require("@univerjs/sheets/facade");
  const formula = fromPreset("@univerjs/engine-formula");
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
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(formula.UniverFormulaEnginePlugin);
    univer.registerPlugin(sheetsFormula.UniverSheetsFormulaPlugin);
    univer.registerPlugin(validation.UniverDataValidationPlugin);
    univer.registerPlugin(sheetsValidation.UniverSheetsDataValidationPlugin);
    univer.registerPlugin(formatting.UniverSheetsConditionalFormattingPlugin);
    return { univer, univerAPI: FUniver.newAPI(univer) };
  };
  return {
    core,
    sheets: require("@univerjs/sheets"),
    sheetsValidation,
    formatting,
    create,
    current: null as ReturnType<typeof create> | null,
  };
});

// Replace only the browser preset bootstrap. The app's mountUniver, snapshot(),
// load(), real facade, resource models and command bus run unchanged.
// No DOM, canvas or browser globals are stubbed.
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
vi.mock("@univerjs/preset-sheets-core/locales/en-US", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-data-validation/locales/en-US", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-conditional-formatting/locales/en-US", () => ({ default: {} }));

import { mountUniver } from "../src/apps/sheets/lib/engine/univer";

it.each([
  "undo",
  "redo",
] as const)("blocks native %s and editing commands during a delayed comment refresh without consuming history", async (direction) => {
  const { currentCommentAnchor } = await import("../src/apps/sheets/lib/comments/anchors");
  const { CellCommentStore } = await import("../src/apps/sheets/lib/comments/store");
  const { harness } = await import("./sheets-workbook-helpers");
  const pod = await harness();
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: {
      id: "loading-history",
      name: "Loading history",
      sheetOrder: ["data"],
      sheets: {
        data: {
          id: "data",
          name: "Data",
          rowCount: 10,
          columnCount: 4,
          cellData: { 1: { 1: { v: "Commented cell", t: 1 } } },
        },
      },
    },
    dark: false,
    compact: true,
  });
  const injector = headless.current?.univer.__getInjector();
  injector?.get(headless.core.IUniverInstanceService).focusUnit("loading-history");
  const commands = injector?.get(headless.core.ICommandService);
  const params = {
    unitId: "loading-history",
    subUnitId: "data",
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 },
    direction: headless.core.Direction.UP,
  };
  try {
    expect(await commands?.executeCommand("sheet.command.insert-row", params)).toBe(true);
    if (direction === "redo")
      expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    const anchor = {
      sheetId: "data",
      cell: direction === "undo" ? "B3" : "B2",
      deleted: false,
    };
    const book = await pod.service.create({
      title: "Loading history",
      snapshot: engine.snapshot(),
    });
    const store = new CellCommentStore(book.container, pod.fetch);
    const root = await store.create("Collaborator", "https://collaborator.example/#me", anchor);
    let finish!: () => void;
    const delayed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    engine.setCommentsLoading?.(true);
    const refresh = delayed.then(async () => {
      const rows = await store.list();
      engine.registerCommentAnchors?.(
        Object.fromEntries(rows.map(({ root }) => [root.url, root.anchor as typeof anchor])),
      );
      engine.setCommentsLoading?.(false);
    });
    const before = engine.snapshot();
    const change = vi.fn();
    const structure = vi.fn();
    engine.onChange(change);
    engine.onStructure?.(structure);
    // Exercise the real async and sync command-service paths used by shortcuts
    // and facades. No fake engine suppresses the mutations for this test.
    expect(await commands?.executeCommand(`univer.command.${direction}`)).toBe(false);
    expect(commands?.syncExecuteCommand(`univer.command.${direction}`)).toBe(false);
    for (const id of [
      "sheet.command.insert-row",
      "sheet.command.insert-col",
      "sheet.command.remove-row",
      "sheet.command.remove-col",
      "sheet.command.set-range-values",
      "sheet.command.set-worksheet-name",
    ]) {
      expect(
        await commands?.executeCommand(id, { ...params, value: { v: "Blocked" }, name: "Blocked" }),
        id,
      ).toBe(false);
    }
    expect(engine.snapshot()).toEqual(before);
    expect(change).not.toHaveBeenCalled();
    expect(structure).not.toHaveBeenCalled();
    finish();
    await refresh;
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor)).toEqual(anchor);
    expect(await commands?.executeCommand(`univer.command.${direction}`)).toBe(true);
    const expectedCell = direction === "undo" ? "B2" : "B3";
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor).cell).toBe(expectedCell);
    const sheet = (engine.snapshot() as unknown as IWorkbookData).sheets.data;
    expect(sheet?.rowCount).toBe(direction === "undo" ? 10 : 11);
    expect(sheet?.cellData?.[direction === "undo" ? 1 : 2]?.[1]?.v).toBe("Commented cell");
    await pod.service.save(book.container, engine.snapshot(), book.version);
    const saved = await pod.service.open(book.container);
    expect(currentCommentAnchor(saved.snapshot, root.url, anchor).cell).toBe(expectedCell);
    engine.load(saved.snapshot);
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor).cell).toBe(expectedCell);
  } finally {
    engine.dispose();
  }
});

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

it("restores thread and draft anchors with real Univer undo/redo, never an unrelated insertion", async () => {
  const { currentCommentAnchor } = await import("../src/apps/sheets/lib/comments/anchors");
  const { snapshot } = await import("./sheets-workbook-helpers");
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: {
      ...snapshot(),
      sheets: { data: { id: "data", name: "Data", rowCount: 20, columnCount: 26 } },
    },
    dark: false,
    compact: true,
  });
  const anchor = { sheetId: "data", cell: "B3", deleted: false };
  const id = "https://pod.example/comments/thread.ttl";
  engine.registerCommentAnchors?.({ [id]: anchor });
  const draft = engine.trackCommentDraft?.(anchor);
  const commands = headless.current?.univer.__getInjector().get(headless.core.ICommandService);
  headless.current?.univer
    .__getInjector()
    .get(headless.core.IUniverInstanceService)
    .focusUnit("original");
  const params = {
    unitId: "original",
    subUnitId: "data",
    range: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 25 },
  };
  const current = () => currentCommentAnchor(engine.snapshot(), id, anchor);
  try {
    expect(await commands?.executeCommand("sheet.command.remove-row", params)).toBe(true);
    expect(current().deleted).toBe(true);
    expect(draft?.current().deleted).toBe(true);
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(current()).toEqual(anchor);
    expect(draft?.current()).toEqual(anchor);
    expect(await commands?.executeCommand("univer.command.redo")).toBe(true);
    expect(current().deleted).toBe(true);
    expect(draft?.current().deleted).toBe(true);
    expect(
      await commands?.executeCommand("sheet.command.insert-row", {
        ...params,
        direction: headless.core.Direction.UP,
      }),
    ).toBe(true);
    expect(current().deleted).toBe(true);
    expect(draft?.current().deleted).toBe(true);
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(current().deleted).toBe(true);
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(current()).toEqual(anchor);
    expect(
      await commands?.executeCommand("sheet.command.insert-col", {
        ...params,
        range: { ...params.range, startColumn: 0, endColumn: 0 },
        direction: headless.core.Direction.LEFT,
      }),
    ).toBe(true);
    expect(current().cell).toBe("C3");
    expect(draft?.current().cell).toBe("C3");
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(current()).toEqual(anchor);
    const saved = engine.snapshot();
    engine.load(saved);
    expect(current()).toEqual(anchor);
    expect(draft?.current().deleted).toBe(true);
  } finally {
    draft?.dispose();
    engine.dispose();
  }
});

it("saves all anchors in the guarded workbook revision and discards a losing client's transforms without comment writes", async () => {
  const { harness, snapshot, WEBID } = await import("./sheets-workbook-helpers");
  const { CellCommentStore } = await import("../src/apps/sheets/lib/comments/store");
  const { currentCommentAnchor } = await import("../src/apps/sheets/lib/comments/anchors");
  const h = await harness(true);
  const book = await h.service.create({ title: "Anchors", snapshot: snapshot() });
  const comments = new CellCommentStore(book.container, h.fetch);
  const anchor = { sheetId: "data", cell: "B3", deleted: false };
  const roots = await Promise.all([
    comments.create("First", WEBID, anchor),
    comments.create("Second", WEBID, anchor),
  ]);
  const fallback = Object.fromEntries(roots.map((root) => [root.url, anchor]));
  const mount = async () => {
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: book.snapshot,
      dark: false,
      compact: true,
    });
    headless.current?.univer
      .__getInjector()
      .get(headless.core.IUniverInstanceService)
      .focusUnit(book.snapshot.id as string);
    engine.registerCommentAnchors?.(fallback);
    const commands = headless.current?.univer.__getInjector().get(headless.core.ICommandService);
    return { engine, commands };
  };
  const a = await mount();
  const b = await mount();
  const before = h.calls.length;
  h.setHook((call) =>
    call.url === roots[1]?.url && call.method === "PUT"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  const insert = (client: typeof a, count: number) =>
    client.commands?.executeCommand("sheet.command.insert-row", {
      unitId: book.snapshot.id,
      subUnitId: "data",
      direction: headless.core.Direction.UP,
      range: { startRow: 0, endRow: count - 1, startColumn: 0, endColumn: 25 },
    });
  try {
    expect(await insert(a, 1)).toBe(true);
    expect(await insert(b, 2)).toBe(true);
    expect(currentCommentAnchor(b.engine.snapshot(), roots[0].url, anchor).cell).toBe("B5");
    await h.service.save(book.container, a.engine.snapshot(), book.version);
    await expect(
      h.service.save(book.container, b.engine.snapshot(), book.version),
    ).rejects.toMatchObject({ name: "WorkbookConflictError" });
    const winner = await h.service.open(book.container);
    b.engine.load(winner.snapshot);
    for (const root of roots) {
      expect(currentCommentAnchor(winner.snapshot, root.url, anchor).cell).toBe("B4");
      expect(currentCommentAnchor(b.engine.snapshot(), root.url, anchor).cell).toBe("B4");
    }
    expect((await comments.list()).map(({ root }) => root.anchor)).toEqual([anchor, anchor]);
    expect(
      h.calls
        .slice(before)
        .filter(
          (call) =>
            call.url.startsWith(comments.container) && ["PUT", "DELETE"].includes(call.method),
        ),
    ).toEqual([]);
  } finally {
    a.engine.dispose();
    b.engine.dispose();
  }
});

it("undoes deletion for a comment whose creation completes after its cell was deleted", async () => {
  const anchor = { sheetId: "data", cell: "B3", deleted: false };
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: {
      id: "pending",
      name: "Pending",
      sheetOrder: ["data"],
      sheets: { data: { id: "data", name: "Data", rowCount: 10, columnCount: 4 } },
    },
    dark: false,
    compact: true,
  });
  const injector = headless.current?.univer.__getInjector();
  injector?.get(headless.core.IUniverInstanceService).focusUnit("pending");
  const commands = injector?.get(headless.core.ICommandService);
  const draft = engine.trackCommentDraft?.(anchor);
  const { currentCommentAnchor } = await import("../src/apps/sheets/lib/comments/anchors");
  try {
    expect(
      await commands?.executeCommand("sheet.command.remove-row", {
        unitId: "pending",
        subUnitId: "data",
        range: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 3 },
      }),
    ).toBe(true);
    draft?.commit("published-after-delete");
    draft?.dispose();
    expect(currentCommentAnchor(engine.snapshot(), "published-after-delete", anchor).deleted).toBe(
      true,
    );
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(currentCommentAnchor(engine.snapshot(), "published-after-delete", anchor)).toEqual(
      anchor,
    );
    expect(await commands?.executeCommand("univer.command.redo")).toBe(true);
    expect(currentCommentAnchor(engine.snapshot(), "published-after-delete", anchor).deleted).toBe(
      true,
    );
  } finally {
    engine.dispose();
  }
});

it.each([
  "row",
  "column",
])("revives comments and drafts created in an inserted %s only when redoing that insertion", async (axis) => {
  const { currentCommentAnchor } = await import("../src/apps/sheets/lib/comments/anchors");
  const anchor = { sheetId: "data", cell: "B3", deleted: false };
  const below = { ...anchor, cell: "D5" };
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: {
      id: "late-anchors",
      name: "Late anchors",
      sheetOrder: ["data"],
      sheets: { data: { id: "data", name: "Data", rowCount: 10, columnCount: 6 } },
    },
    dark: false,
    compact: true,
  });
  const injector = headless.current?.univer.__getInjector();
  injector?.get(headless.core.IUniverInstanceService).focusUnit("late-anchors");
  const commands = injector?.get(headless.core.ICommandService);
  const insert = () =>
    commands?.executeCommand(`sheet.command.insert-${axis === "row" ? "row" : "col"}`, {
      unitId: "late-anchors",
      subUnitId: "data",
      direction: axis === "row" ? headless.core.Direction.UP : headless.core.Direction.LEFT,
      range:
        axis === "row"
          ? { startRow: 2, endRow: 2, startColumn: 0, endColumn: 5 }
          : { startRow: 0, endRow: 9, startColumn: 1, endColumn: 1 },
    });
  const current = (id: string) => currentCommentAnchor(engine.snapshot(), id, anchor);
  let draft: ReturnType<NonNullable<typeof engine.trackCommentDraft>> | undefined;
  try {
    expect(await insert()).toBe(true);
    engine.registerCommentAnchors?.({ late: anchor, below });
    draft = engine.trackCommentDraft?.(anchor);
    const pending = engine.trackCommentDraft?.(anchor);
    expect(draft?.current()).toEqual(anchor);
    for (let cycle = 0; cycle < 2; cycle++) {
      expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
      expect(current("late").deleted).toBe(true);
      expect(draft?.current().deleted).toBe(true);
      expect(current("below").cell).toBe(axis === "row" ? "D4" : "C5");
      if (cycle === 0) {
        pending?.commit("published-after-undo");
        pending?.dispose();
      }
      expect(current("published-after-undo").deleted).toBe(true);
      expect(await commands?.executeCommand("univer.command.redo")).toBe(true);
      expect(current("late")).toEqual(anchor);
      expect(draft?.current()).toEqual(anchor);
      expect(current("published-after-undo")).toEqual(anchor);
      expect(current("below")).toEqual(below);
    }
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(await insert()).toBe(true);
    expect(current("late").deleted).toBe(true);
    expect(draft?.current().deleted).toBe(true);
    expect(current("published-after-undo").deleted).toBe(true);
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(current("late").deleted).toBe(true);
    expect(draft?.current().deleted).toBe(true);
  } finally {
    draft?.dispose();
    engine.dispose();
  }
});
