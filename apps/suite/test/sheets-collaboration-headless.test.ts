// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ICellData, IWorkbookData } from "@univerjs/core";
import { expect, it, vi } from "vitest";
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
// The engine needs no DOM or canvas. Failure regressions mount the panel in a temporary DOM.
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
vi.mock("@/lib/session/pod-session", () => ({
  usePodSessionState: () => ({ status: "loading" }),
}));

import * as Y from "yjs";
import { type ChartSpec, readCharts, withCharts } from "../src/apps/sheets/lib/charts/spec";
import { seedSheets } from "../src/apps/sheets/lib/collaboration/model";
import type { WorkbookCollaboration } from "../src/apps/sheets/lib/collaboration/persistence";
import { mountUniver } from "../src/apps/sheets/lib/engine/univer";
import { harness } from "./sheets-workbook-helpers";

function initial(): Snapshot {
  return withCharts(
    {
      id: "collaborative",
      name: "Shared",
      sheetOrder: ["data"],
      styles: {},
      sheets: {
        data: {
          id: "data",
          name: "Data",
          rowCount: 6,
          columnCount: 4,
          cellData: { 0: { 0: { v: "Header", t: 1 } }, 2: { 1: { v: "Below", t: 1 } } },
        },
      },
      commentAnchors: { version: 1, anchors: { root: { sheetId: "data", cell: "B3" } } },
    },
    [
      {
        id: "chart",
        sheetId: "data",
        range: "A1:B3",
        type: "column",
        title: "Values",
        legend: true,
        series: "columns",
      },
    ],
  );
}

async function mounted(doc: Y.Doc, snapshot = initial(), readOnly = false) {
  const collaboration = { doc, readOnly } as WorkbookCollaboration;
  const engine = await mountUniver({} as HTMLElement, {
    snapshot,
    dark: false,
    compact: true,
    readOnly,
    collaboration,
  });
  const injector = headless.current?.univer.__getInjector();
  injector?.get(headless.core.IUniverInstanceService).focusUnit(snapshot.id as string);
  const commands = injector?.get(headless.core.ICommandService);
  const history = injector?.get(headless.core.IUndoRedoService);
  const execute = async (id: string, params?: object) => {
    expect(await commands?.executeCommand(id, params)).toBe(true);
  };
  const cell = (row: number, column: number, value: ICellData) =>
    execute("sheet.command.set-range-values", {
      unitId: snapshot.id,
      subUnitId: "data",
      value,
      range: { startRow: row, endRow: row, startColumn: column, endColumn: column },
    });
  const structural = (axis: "row" | "col", kind: "insert" | "remove", index: number, count = 1) =>
    execute(`sheet.command.${kind}-${axis}`, {
      unitId: snapshot.id,
      subUnitId: "data",
      direction: axis === "row" ? headless.core.Direction.UP : headless.core.Direction.LEFT,
      range: {
        startRow: axis === "row" ? index : 0,
        endRow: axis === "row" ? index + count - 1 : 5,
        startColumn: axis === "col" ? index : 0,
        endColumn: axis === "col" ? index + count - 1 : 3,
      },
    });
  return {
    engine,
    doc,
    commands,
    history,
    execute,
    cell,
    structural,
    undo: () => execute("univer.command.undo"),
    redo: () => execute("univer.command.redo"),
    data: () => (engine.snapshot() as unknown as IWorkbookData).sheets.data,
  };
}

async function pair() {
  const a = new Y.Doc();
  a.transact(() => seedSheets(a, initial()));
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const left = await mounted(a);
  const right = await mounted(b);
  const transport = {};
  const queueA: Uint8Array[] = [];
  const queueB: Uint8Array[] = [];
  a.on("update", (update, origin) => {
    if (origin !== transport) queueA.push(update);
  });
  b.on("update", (update, origin) => {
    if (origin !== transport) queueB.push(update);
  });
  const sync = () => {
    const fromA = queueA.splice(0);
    const fromB = queueB.splice(0);
    if (fromA.length) Y.applyUpdate(b, Y.mergeUpdates(fromA), transport);
    if (fromB.length) Y.applyUpdate(a, Y.mergeUpdates(fromB), transport);
  };
  const dispose = () => {
    left.engine.dispose();
    right.engine.dispose();
    a.destroy();
    b.destroy();
  };
  return { left, right, sync, dispose };
}

it("merges concurrent edits to different cells, converges one cell, and only undoes the local edit", async () => {
  const p = await pair();
  try {
    await p.left.cell(0, 0, { v: "Alice" });
    await p.right.cell(1, 0, { v: "Bob" });
    p.sync();
    for (const replica of [p.left, p.right]) {
      expect(replica.data()?.cellData?.[0]?.[0]?.v).toBe("Alice");
      expect(replica.data()?.cellData?.[1]?.[0]?.v).toBe("Bob");
    }
    await p.left.undo();
    p.sync();
    expect(p.right.data()?.cellData?.[0]?.[0]?.v).toBe("Header");
    expect(p.right.data()?.cellData?.[1]?.[0]?.v).toBe("Bob");
    await p.left.redo();
    p.sync();
    await p.left.cell(1, 1, { v: "One" });
    await p.right.cell(1, 1, { v: "Two" });
    p.sync();
    expect(p.left.data()?.cellData).toEqual(p.right.data()?.cellData);
    expect(["One", "Two"]).toContain(p.left.data()?.cellData?.[1]?.[1]?.v);
  } finally {
    p.dispose();
  }
});

it("keeps a concurrent edit attached to its row and shifts remote chart/comment metadata through the native pipeline", async () => {
  const p = await pair();
  try {
    await p.left.structural("row", "insert", 1);
    await p.right.cell(2, 1, { v: "Still below" });
    p.sync();
    for (const replica of [p.left, p.right]) {
      expect(replica.data()?.cellData?.[3]?.[1]?.v).toBe("Still below");
      expect(replica.engine.snapshot().commentAnchors).toMatchObject({
        anchors: { root: { cell: "B4" } },
      });
      expect(readCharts(replica.engine.snapshot()).charts[0]?.range).toBe("A1:B4");
    }
    // B's native history originally targeted row 2; Yjs undo follows row 3.
    expect(p.right.history?.pitchTopUndoElement()?.undoMutations[0]?.id).toBe(
      "sheets.mutation.collaborative-history",
    );
    await p.right.undo();
    p.sync();
    expect(p.left.data()?.cellData?.[3]?.[1]?.v).toBe("Below");
    await p.left.undo();
    p.sync();
    expect(p.left.data()?.rowCount).toBe(6);
    expect(p.right.data()?.cellData?.[2]?.[1]?.v).toBe("Below");
  } finally {
    p.dispose();
  }
});

it("merges concurrent insertions, column edits, styles and clears; remote traffic adds no native undo entry", async () => {
  const p = await pair();
  try {
    await p.left.structural("row", "insert", 1);
    await p.right.structural("row", "insert", 1);
    p.sync();
    expect(p.left.data()?.rowCount).toBe(8);
    expect(p.left.data()?.cellData).toEqual(p.right.data()?.cellData);
    await p.left.cell(4, 1, { v: "Bold", s: { bl: 1 } });
    await p.right.structural("col", "insert", 0);
    p.sync();
    expect(p.right.data()?.cellData?.[4]?.[2]?.v).toBe("Bold");
    expect(p.left.data()?.cellData).toEqual(p.right.data()?.cellData);
    await p.left.cell(4, 2, { v: null, s: null });
    p.sync();
    expect(p.left.data()?.cellData).toEqual(p.right.data()?.cellData);
  } finally {
    p.dispose();
  }
});

it("hydrates an older snapshot from Y state and applies remote mutations in view-only mode", async () => {
  const doc = new Y.Doc();
  doc.transact(() => seedSheets(doc, initial()));
  const writer = await mounted(doc);
  await writer.structural("row", "insert", 1);
  await writer.cell(3, 1, { v: "Latest" });
  const viewerDoc = new Y.Doc();
  Y.applyUpdate(viewerDoc, Y.encodeStateAsUpdate(doc));
  const viewer = await mounted(viewerDoc, initial(), true);
  const updates = vi.fn();
  viewerDoc.on("update", updates);
  try {
    expect(viewer.data()?.cellData?.[3]?.[1]?.v).toBe("Latest");
    expect(viewer.engine.snapshot().commentAnchors).toMatchObject({
      anchors: { root: { cell: "B4" } },
    });
    await writer.structural("row", "insert", 1);
    Y.applyUpdate(viewerDoc, Y.encodeStateAsUpdate(doc), "remote");
    expect(viewer.data()?.cellData?.[4]?.[1]?.v).toBe("Latest");
    expect(updates).toHaveBeenCalledOnce();
    expect(viewer.engine.snapshot().collaboration).toHaveProperty("stateVector");
  } finally {
    viewer.engine.dispose();
    writer.engine.dispose();
    viewerDoc.destroy();
    doc.destroy();
  }
});

it.each([
  "row",
  "col",
] as const)("moves %ss in either direction through the structural pipeline and preserves stable cell identities", async (axis) => {
  const p = await pair();
  try {
    for (const [from, to] of [
      [2, 0],
      [0, 4],
    ] as const) {
      const range = {
        startRow: axis === "row" ? from : 0,
        endRow: axis === "row" ? from : 5,
        startColumn: axis === "col" ? from : 0,
        endColumn: axis === "col" ? from : 3,
        rangeType: axis === "row" ? headless.core.RANGE_TYPE.ROW : headless.core.RANGE_TYPE.COLUMN,
      };
      await p.left.execute(`sheet.command.move-${axis === "row" ? "rows" : "cols"}`, {
        unitId: "collaborative",
        subUnitId: "data",
        range,
        fromRange: range,
        toRange: {
          ...range,
          ...(axis === "row" ? { startRow: to, endRow: to } : { startColumn: to, endColumn: to }),
        },
      });
      p.sync();
      expect(p.left.data()?.cellData).toEqual(p.right.data()?.cellData);
      expect(p.left.engine.snapshot().commentAnchors).toEqual(
        p.right.engine.snapshot().commentAnchors,
      );
      expect(readCharts(p.left.engine.snapshot()).charts).toEqual(
        readCharts(p.right.engine.snapshot()).charts,
      );
      await p.left.undo();
      p.sync();
      expect(p.left.data()?.cellData).toEqual(p.right.data()?.cellData);
    }
  } finally {
    p.dispose();
  }
});

it("replays multi-row/column deletion and its metadata checkpoints, including redo", async () => {
  const p = await pair();
  const draft = p.right.engine.trackCommentDraft?.({ sheetId: "data", cell: "B3", deleted: false });
  try {
    await p.left.structural("row", "remove", 1, 2);
    p.sync();
    expect(p.right.engine.snapshot().commentAnchors).toMatchObject({
      anchors: { root: "deleted" },
    });
    expect(draft?.current().deleted).toBe(true);
    await p.left.undo();
    p.sync();
    expect(p.left.engine.snapshot().commentAnchors).toMatchObject({
      anchors: { root: { cell: "B3" } },
    });
    expect(p.right.engine.snapshot().commentAnchors).toEqual(
      p.left.engine.snapshot().commentAnchors,
    );
    expect(draft?.current()).toMatchObject({ cell: "B3", deleted: false });
    expect(readCharts(p.right.engine.snapshot()).charts[0]?.range).toBe("A1:B3");
    expect(p.left.data()?.cellData).toEqual(p.right.data()?.cellData);
    await p.left.redo();
    p.sync();
    await p.right.structural("col", "remove", 1);
    p.sync();
    expect(p.left.data()?.columnCount).toBe(3);
    await p.right.undo();
    p.sync();
    expect(p.left.data()?.cellData).toEqual(p.right.data()?.cellData);
  } finally {
    draft?.dispose();
    p.dispose();
  }
});

it("imports CSV into the merged state and keeps sheet-list edits on native snapshot history", async () => {
  const p = await pair();
  try {
    p.left.engine.importCsv("New,Values,Extra,Columns,Five\n1,2,3,4,5", { mode: "replace-active" });
    p.sync();
    expect(p.left.data()?.cellData).toEqual(p.right.data()?.cellData);
    expect(p.right.data()?.columnCount).toBe(5);
    p.left.engine.importCsv("Second\nSheet", { mode: "new-sheet", name: "Second" });
    p.sync();
    expect(p.right.engine.snapshot().sheetOrder as string[]).toEqual(["data"]);
    expect(p.left.engine.activeSheet().name).toBe("Second");
    const saved = p.left.engine.snapshot();
    p.left.engine.load(saved);
    expect(p.left.engine.snapshot().sheets).toEqual(saved.sheets);
  } finally {
    p.dispose();
  }
});

it("commits one Y transaction per structural command and still accepts edits after a rejected native command", async () => {
  const p = await pair();
  try {
    const updated = vi.fn();
    p.left.doc.on("update", updated);
    await p.left.structural("row", "insert", 1, 2);
    expect(updated).toHaveBeenCalledOnce();
    await expect(
      p.left.commands?.executeCommand("sheet.command.insert-col", {
        unitId: "collaborative",
        subUnitId: "data",
        direction: headless.core.Direction.UP,
        range: { startRow: 0, endRow: 5, startColumn: 0, endColumn: 0 },
      }),
    ).rejects.toThrow("out of bounds");
    await p.left.cell(0, 0, { v: "After failure" });
    p.sync();
    expect(p.right.data()?.cellData?.[0]?.[0]?.v).toBe("After failure");
    expect(p.right.history?.getUndoRedoStatus("collaborative").undos).toBe(0);
  } finally {
    p.dispose();
  }
});

it("does not undo an earlier local command when the latest cell edit has already been replaced remotely", async () => {
  const p = await pair();
  try {
    await p.left.cell(0, 0, { v: "Keep until second undo" });
    await p.left.cell(1, 0, { v: "Local" });
    p.sync();
    await p.right.cell(1, 0, { v: "Remote winner" });
    p.sync();
    await p.left.undo();
    p.sync();
    expect(p.left.data()?.cellData?.[0]?.[0]?.v).toBe("Keep until second undo");
    expect(p.left.data()?.cellData?.[1]?.[0]?.v).toBe("Remote winner");
    await p.left.redo();
    p.sync();
    expect(p.left.data()?.cellData?.[1]?.[0]?.v).toBe("Remote winner");
    await p.left.undo();
    await p.left.undo();
    p.sync();
    expect(p.left.data()?.cellData?.[0]?.[0]?.v).toBe("Header");
  } finally {
    p.dispose();
  }
});

it("seeds a locally added sheet without putting sheet-list edits on collaborative history", async () => {
  const p = await pair();
  try {
    await p.left.execute("sheet.command.insert-sheet", {
      unitId: "collaborative",
      sheet: { id: "new-sheet", name: "New", rowCount: 3, columnCount: 2, cellData: {} },
    });
    p.sync();
    expect(p.right.engine.snapshot().sheetOrder).toEqual(["data"]);
    await p.left.cell(0, 0, { v: "Local" });
    await p.left.undo();
    p.sync();
    expect(p.left.data()?.cellData?.[0]?.[0]?.v).toBe("Header");
    expect(p.left.engine.snapshot().sheetOrder).toContain("new-sheet");
  } finally {
    p.dispose();
  }
});

it("rejects history replay as a viewer and ignores stale history after a snapshot reload", async () => {
  const p = await pair();
  try {
    await p.left.cell(0, 0, { v: "Local" });
    const replay = p.left.history
      ?.pitchTopUndoElement()
      ?.undoMutations.find(({ id }) => id === "sheets.mutation.collaborative-history");
    if (!replay) throw new Error("Missing collaborative history");
    p.left.engine.setReadOnly(true);
    expect(p.left.commands?.syncExecuteCommand(replay.id, replay.params)).toBe(false);
    p.left.engine.setReadOnly(false);
    p.left.engine.load(p.left.engine.snapshot());
    expect(p.left.commands?.syncExecuteCommand(replay.id, replay.params)).toBe(true);
    expect(p.left.data()?.cellData?.[0]?.[0]?.v).toBe("Local");
    const command = p.left.commands?.registerCommand({
      id: "sheets.command.no-change",
      type: headless.core.CommandType.COMMAND,
      handler: () => true,
    });
    await p.left.execute("sheets.command.no-change");
    command?.dispose();
  } finally {
    p.dispose();
  }
});

it("handles direct clears, empty mutations, absent sheets and invalid cell coordinates without manufacturing Y cells", async () => {
  const p = await pair();
  try {
    const params = { unitId: "collaborative", subUnitId: "data" };
    await p.left.execute("sheet.mutation.set-range-values", {
      ...params,
      cellValue: { 0: { 0: null } },
    });
    p.sync();
    expect(p.right.data()?.cellData?.[0]?.[0]).toBeUndefined();
    await p.left.execute("sheet.mutation.set-range-values", params);
    expect(
      await p.left.commands?.executeCommand("sheet.mutation.set-range-values", {
        ...params,
        subUnitId: "missing",
        cellValue: { 0: { 0: { v: "Absent" } } },
      }),
    ).toBe(false);
    await p.left.execute("sheet.mutation.set-range-values", {
      ...params,
      cellValue: { 90: { 0: { v: "Outside rows" } }, 0: { 90: { v: "Outside columns" } } },
    });
    p.sync();
    expect(p.right.data()?.cellData?.[90]).toBeUndefined();
    expect(p.right.data()?.cellData?.[0]?.[90]).toBeUndefined();
  } finally {
    p.dispose();
  }
});

it("can retry a temporarily rejected remote structural replay from the already accepted Y state", async () => {
  const p = await pair();
  try {
    const block = p.right.commands?.beforeCommandExecuted((command, options) => {
      if (options?.fromCollab && command.id === "sheet.mutation.insert-row")
        throw new headless.core.CanceledError();
    });
    await p.left.structural("row", "insert", 1);
    expect(() => p.sync()).toThrow("Couldn't apply spreadsheet update");
    block?.dispose();
    p.right.doc.transact(() => {}, "retry");
    expect(p.left.data()?.cellData).toEqual(p.right.data()?.cellData);
    expect(p.right.engine.snapshot().commentAnchors).toEqual(
      p.left.engine.snapshot().commentAnchors,
    );
  } finally {
    p.dispose();
  }
});

it("keeps changed chart sources and unknown snapshot metadata intact during remote deletion undo", async () => {
  const p = await pair();
  try {
    p.right.engine.registerCommentAnchors?.({
      unknown: { sheetId: "unknown", cell: "A1", deleted: false },
      outside: { sheetId: "data", cell: "Z90", deleted: false },
    });
    const draft = p.right.engine.trackCommentDraft?.({
      sheetId: "data",
      cell: "B3",
      deleted: false,
    });
    await p.left.structural("row", "remove", 0, 3);
    p.sync();
    expect(readCharts(p.right.engine.snapshot()).charts[0]?.range).toBeNull();
    draft?.commit("published-after-deletion");
    draft?.dispose();
    await p.left.undo();
    p.sync();
    expect(p.right.engine.snapshot().commentAnchors).toMatchObject({
      anchors: { "published-after-deletion": { cell: "B3" } },
    });
    await p.left.structural("row", "remove", 1, 2);
    p.sync();
    p.right.engine.setCharts?.(
      withCharts({}, [
        { ...(readCharts(p.right.engine.snapshot()).charts[0] as ChartSpec), range: "C1:D2" },
        {
          id: "foreign",
          sheetId: "unknown",
          range: "A1:B2",
          type: "column",
          title: "Unknown sheet",
          legend: true,
          series: "columns",
        },
      ]).charts,
    );
    await p.left.undo();
    p.sync();
    expect(readCharts(p.right.engine.snapshot()).charts[0]?.range).toBe("C1:D4");
    expect(readCharts(p.right.engine.snapshot()).charts[1]?.range).toBe("A1:B2");
  } finally {
    p.dispose();
  }
});

it("saves merged cells, the Y state vector, CSV values and JSON-LD column descriptors", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Projections", snapshot: initial() });
  const runtime = (await h.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  const active = await mounted(runtime.doc, book.snapshot);
  try {
    await active.cell(0, 0, { v: "Merged header" });
    await active.structural("row", "insert", 1);
    const snapshot = active.engine.snapshot();
    await h.service.save(book.container, snapshot, book.version);
    const stored = await h.storage.loadSnapshot(book.container);
    expect(stored.value.collaboration).toEqual(snapshot.collaboration);
    expect(await (await h.fetch(`${book.container}sheets/1.csv`)).text()).toContain(
      "Merged header",
    );
    expect((await h.storage.loadDescriptor(book.container, 1)).value).toMatchObject({
      columns: expect.arrayContaining([expect.objectContaining({ name: "Merged header" })]),
    });
  } finally {
    active.engine.dispose();
    await runtime.destroy();
  }
});

it("hydrates legacy cell-only snapshots without adding chart or comment metadata", async () => {
  const base = initial();
  delete base.charts;
  delete base.commentAnchors;
  const doc = new Y.Doc();
  doc.transact(() => seedSheets(doc, base));
  const active = await mounted(doc, base);
  try {
    await active.cell(0, 0, { v: "Cell only" });
    expect(active.engine.snapshot().charts).toBeUndefined();
    expect(active.engine.snapshot().commentAnchors).toBeUndefined();
  } finally {
    active.engine.dispose();
    doc.destroy();
  }
});

it.each([
  [9, 7],
  [2, 1],
])("uses the Y structure when a legacy snapshot has %i rows and %i columns", async (rows, columns) => {
  const doc = new Y.Doc();
  doc.transact(() => seedSheets(doc, initial()));
  const stale = initial();
  const sheet = (stale.sheets as Record<string, Snapshot>).data as Snapshot;
  sheet.rowCount = rows;
  sheet.columnCount = columns;
  sheet.cellData = { 0: { 0: { v: "Stale" } } };
  const active = await mounted(doc, stale);
  try {
    expect(active.data()?.rowCount).toBe(6);
    expect(active.data()?.columnCount).toBe(4);
    expect(active.data()?.cellData?.[0]?.[0]?.v).toBe("Header");
  } finally {
    active.engine.dispose();
    doc.destroy();
  }
});
