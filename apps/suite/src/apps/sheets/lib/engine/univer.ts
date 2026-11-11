// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { ICommandService } from "@univerjs/core";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import UniverPresetSheetsConditionalFormattingEnUS from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import UniverPresetSheetsDataValidationEnUS from "@univerjs/preset-sheets-data-validation/locales/en-US";
import {
  CommandType,
  createUniver,
  type IWorkbookData,
  LocaleType,
  mergeLocales,
} from "@univerjs/presets";
import { SheetInterceptorService, SheetsSelectionsService } from "@univerjs/sheets";
import { type AnchorDeletions, WorkbookCommentAnchors } from "../comments/anchors";
import { type CellAnchor, commentStructuralEdit } from "../comments/selector";
import type { MountEngine, Snapshot } from "../contract";
import { serializeSnapshot } from "../model/snapshot";
import type { StructuralEdit } from "../refs/model";
import { indexToColumn } from "../refs/notation";
import { parseCsv } from "../univer-spike/csv";
import { workbookToCsv } from "../univer-spike/workbook";

/**
 * `formula.*` mutations are background calculation traffic, except these, which
 * change persisted workbook state (named ranges, tables) and must autosave.
 */
const PERSISTED_FORMULA_MUTATIONS = new Set([
  "formula.mutation.set-defined-name",
  "formula.mutation.remove-defined-name",
  "formula.mutation.set-super-table",
  "formula.mutation.remove-super-table",
  "formula.mutation.set-super-table-option",
]);

// The other-formula dirty signal (used by DV and CF formulas) carries no persisted
// state. Its params are keyed by unit id, so the unitId check below drops it too; this
// names it explicitly. CF viewport and style caches update without mutations.
const RECOMPUTE_MUTATIONS = new Set(["sheet.mutation.data-validation-formula-mark-dirty"]);

interface AnchorOperation {
  redo: AnchorDeletions[];
  undo: AnchorDeletions[];
}
interface AnchorMutation {
  unitId: string;
  operation: AnchorOperation;
  direction: "undo" | "redo";
  phase: "begin" | "end";
}

export const mountUniver: MountEngine = async (container, options) => {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(
        UniverPresetSheetsCoreEnUS,
        UniverPresetSheetsDataValidationEnUS,
        UniverPresetSheetsConditionalFormattingEnUS,
      ),
    },
    darkMode: options.dark,
    presets: [
      UniverSheetsCorePreset({
        container,
        header: !options.compact,
        toolbar: !options.compact,
        formulaBar: true,
        footer: {
          sheetBar: true,
          statisticBar: !options.compact,
          menus: !options.compact,
          zoomSlider: !options.compact,
        },
      }),
      UniverSheetsDataValidationPreset(),
      UniverSheetsConditionalFormattingPreset(),
    ],
  });
  let workbook = univerAPI.createWorkbook(options.snapshot as Partial<IWorkbookData>);
  let readOnly = options.readOnly ?? false;
  let commentsLoading = options.commentsLoading ?? false;
  const setEditable = () => workbook.setEditable(!readOnly && !commentsLoading);
  setEditable();
  const selections = new Set<(anchor: CellAnchor | undefined) => void>();
  const structures = new Set<(edit: StructuralEdit) => void>();
  const selectedCell = (): CellAnchor | undefined => {
    const range = workbook.getActiveCell();
    if (!range) return undefined;
    return {
      sheetId: workbook.getActiveSheet().getSheetId(),
      cell: `${indexToColumn(range.getColumn() + 1)}${range.getRow() + 1}`,
      deleted: false,
    };
  };
  const selectionChanged = () => {
    for (const listener of selections) listener(selectedCell());
  };
  const injector = univer.__getInjector();
  const selectionSubscription = injector
    .get(SheetsSelectionsService)
    .selectionChanged$.subscribe(selectionChanged);
  const sheetSubscription = univerAPI.addEvent(
    univerAPI.Event.ActiveSheetChanged,
    selectionChanged,
  );
  const listeners = new Set<() => void>();
  const anchors = new WorkbookCommentAnchors(options.snapshot);
  let disposed = false;
  let loading = false;
  let queued = false;
  let generation = 0;
  let editedSinceLoad = false;
  const notify = () => {
    if (disposed || queued) return;
    queued = true;
    const current = generation;
    queueMicrotask(() => {
      if (disposed || current !== generation) return;
      queued = false;
      for (const listener of listeners) listener();
    });
  };
  const commands = injector.get(ICommandService);
  const interceptors = injector.get(SheetInterceptorService);
  const anchorMutation = "sheets.mutation.comment-anchors";
  let activeOperation: AnchorMutation | undefined;
  const anchorCommand = commands.registerCommand({
    id: anchorMutation,
    type: CommandType.MUTATION,
    handler: (_accessor, params: AnchorMutation) => {
      if (params.phase === "begin") {
        params.operation[params.direction] = [];
        activeOperation = params;
      } else activeOperation = undefined;
      return true;
    },
  });
  const mutation = (
    operation: AnchorOperation,
    direction: "undo" | "redo",
    phase: "begin" | "end",
  ) => ({
    id: anchorMutation,
    params: { unitId: workbook.getId(), operation, direction, phase },
  });
  // Native undo/redo carries each command's deletion history, including deletions
  // caused by undo itself. Unrelated insertions never get that history.
  const beforeStructure = interceptors.interceptCommand({
    getMutations(command) {
      if (!/^sheet\.command\.(insert-row|insert-col|remove-row|remove-col)$/.test(command.id))
        return { redos: [], undos: [] };
      const operation: AnchorOperation = { redo: [], undo: [] };
      return {
        preRedos: [mutation(operation, "redo", "begin")],
        preUndos: [mutation(operation, "undo", "begin")],
        redos: [],
        undos: [],
      };
    },
  });
  const afterStructure = interceptors.interceptAfterCommand({
    getMutations(command) {
      if (
        !/^sheet\.command\.(insert-row|insert-col|remove-row|remove-col)$/.test(command.id) ||
        !activeOperation
      )
        return { redos: [], undos: [] };
      const { operation } = activeOperation;
      return {
        redos: [mutation(operation, "redo", "end")],
        undos: [mutation(operation, "undo", "end")],
      };
    },
  });
  const subscription = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
    if (
      event.type !== CommandType.MUTATION ||
      readOnly ||
      loading ||
      event.options?.fromChangeset ||
      RECOMPUTE_MUTATIONS.has(event.id) ||
      (event.id.startsWith("formula.") && !PERSISTED_FORMULA_MUTATIONS.has(event.id)) ||
      event.params?.unitId !== workbook.getId()
    )
      return;
    // Initial formula calculation belongs to loading, including its asynchronous results.
    if (event.options?.fromFormula && !editedSinceLoad) return;
    const edit = commentStructuralEdit(event.id, event.params);
    if (edit) {
      const deleted = anchors.shift(edit);
      if (activeOperation) {
        const { operation, direction } = activeOperation;
        operation[direction].push(deleted);
        const inverse = operation[direction === "undo" ? "redo" : "undo"].pop();
        if (inverse) anchors.revive(inverse);
      }
      for (const listener of structures) listener(edit);
    }
    editedSinceLoad = true;
    notify();
  });
  const snapshot = (): Snapshot => {
    const data: Snapshot = JSON.parse(JSON.stringify(workbook.save()));
    delete data.commentAnchors;
    Object.assign(data, anchors.snapshot());
    serializeSnapshot(data);
    return data;
  };
  const load = (data: Snapshot) => {
    serializeSnapshot(data);
    loading = true;
    editedSinceLoad = false;
    ++generation;
    queued = false;
    try {
      univerAPI.disposeUnit(workbook.getId());
      workbook = univerAPI.createWorkbook(data as Partial<IWorkbookData>);
      setEditable();
      anchors.load(data);
      activeOperation = undefined;
      selectionChanged();
    } finally {
      loading = false;
    }
  };
  return {
    setCommentsLoading(value) {
      commentsLoading = value;
      setEditable();
    },
    registerCommentAnchors(values) {
      if (anchors.register(values) && !readOnly) notify();
    },
    trackCommentDraft(anchor) {
      const draft = anchors.track(anchor);
      return {
        ...draft,
        commit(annotationId) {
          draft.commit(annotationId);
          if (!readOnly) notify();
        },
      };
    },
    load,
    snapshot,
    selectedCell,
    selectCell(anchor) {
      if (anchor.deleted) return;
      const sheet = workbook.getSheetBySheetId(anchor.sheetId);
      if (!sheet) return;
      workbook.setActiveSheet(anchor.sheetId);
      sheet.setActiveRange(sheet.getRange(anchor.cell));
      selectionChanged();
    },
    onSelection(listener) {
      selections.add(listener);
      return () => selections.delete(listener);
    },
    onStructure(listener) {
      structures.add(listener);
      return () => structures.delete(listener);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activeSheet() {
      const sheet = workbook.getActiveSheet();
      return { id: sheet.getSheetId(), name: sheet.getSheetName() };
    },
    exportCsv(sheetId) {
      return workbookToCsv(
        snapshot() as unknown as IWorkbookData,
        sheetId ?? workbook.getActiveSheet().getSheetId(),
      );
    },
    importCsv(csv, config) {
      if (readOnly || commentsLoading) return;
      const rows = parseCsv(csv);
      const data = snapshot() as unknown as IWorkbookData;
      const active = workbook.getActiveSheet().getSheetId();
      const id = config.mode === "new-sheet" ? crypto.randomUUID() : active;
      const existing = data.sheets[id];
      let name = config.name?.trim() || "Imported sheet";
      if (config.mode === "new-sheet") {
        const names = new Set(Object.values(data.sheets).map((sheet) => sheet.name));
        const base = name;
        for (let n = 2; names.has(name); n++) name = `${base} (${n})`;
        data.sheetOrder.push(id);
      }
      data.sheets[id] = {
        ...existing,
        id,
        name: existing?.name ?? name,
        rowCount: Math.max(existing?.rowCount ?? 1000, rows.length),
        columnCount: Math.max(existing?.columnCount ?? 26, ...rows.map((row) => row.length)),
        cellData: Object.fromEntries(
          rows.map((row, r) => [r, Object.fromEntries(row.map((v, c) => [c, { v, t: 1 }]))]),
        ),
      };
      load(data as unknown as Snapshot);
      workbook.setActiveSheet(id);
      editedSinceLoad = true;
      notify();
    },
    setDark(dark) {
      univerAPI.toggleDarkMode(dark);
    },
    setReadOnly(value) {
      readOnly = value;
      ++generation;
      queued = false;
      setEditable();
    },
    dispose() {
      disposed = true;
      ++generation;
      subscription.dispose();
      selectionSubscription.unsubscribe();
      sheetSubscription.dispose();
      beforeStructure.dispose();
      afterStructure.dispose();
      anchorCommand.dispose();
      selections.clear();
      structures.clear();
      listeners.clear();
      univer.dispose();
    },
  };
};
