// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { CanceledError, ICommandService } from "@univerjs/core";
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
import { shiftChartRanges } from "../charts/range";
import { type ChartSpec, readCharts, withCharts } from "../charts/spec";
import { type AnchorDeletions, WorkbookCommentAnchors } from "../comments/anchors";
import { type CellAnchor, commentStructuralEdit, shiftCellAnchor } from "../comments/selector";
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

interface StructuralOperation {
  chartSources?: {
    sheetId: string;
    sources: { id: string; sheetId: string; range: ChartSpec["range"]; revision: number }[];
  };
  redo: AnchorDeletions[];
  undo: AnchorDeletions[];
}
interface StructuralMutation {
  unitId: string;
  operation: StructuralOperation;
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
  let charts = options.snapshot.charts;
  // Only manual source edits (including deletion/recreation) advance revisions.
  const chartRevisions = new Map<string, number>();
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
  const valueListeners = new Set<() => void>();
  const anchors = new WorkbookCommentAnchors(options.snapshot);
  // Keep the actual deletion records carried by native undo/redo. Late discovery
  // fills those same records so a future inverse can revive the newly found root.
  const structuralLog: {
    edit: StructuralEdit;
    deleted: AnchorDeletions;
    inverse: AnchorDeletions | undefined;
  }[] = [];
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
      for (const listener of valueListeners) listener();
    });
  };
  const commands = injector.get(ICommandService);
  // setEditable does not guard native history replay. Cancel user commands before
  // they can mutate the workbook or consume undo/redo history while anchors load.
  // Operations (navigation) and background calculation mutations can still run.
  const loadingGuard = commands.beforeCommandExecuted((command) => {
    if (commentsLoading && command.type === CommandType.COMMAND) throw new CanceledError();
  });
  const interceptors = injector.get(SheetInterceptorService);
  const structuralMutation = "sheets.mutation.structural-metadata";
  let activeOperation: StructuralMutation | undefined;
  const structuralCommand = commands.registerCommand({
    id: structuralMutation,
    type: CommandType.MUTATION,
    handler: (_accessor, params: StructuralMutation) => {
      if (readOnly || commentsLoading || params.unitId !== workbook.getId()) return false;
      if (params.phase === "begin") {
        params.operation[params.direction] = [];
        activeOperation = params;
        const record = params.operation.chartSources;
        if (params.direction === "redo" && record) {
          // Refresh before every deletion replay, including redo after source edits.
          record.sources = readCharts({ charts } as Snapshot)
            .charts.filter((chart) => chart.sheetId === record.sheetId)
            .map((chart) => ({
              id: chart.id,
              sheetId: chart.sheetId,
              range: chart.range,
              revision: chartRevisions.get(chart.id) ?? 0,
            }));
        }
      } else {
        const record = params.operation.chartSources;
        if (params.direction === "undo" && record && charts !== undefined) {
          const sources = new Map(record.sources.map((source) => [source.id, source]));
          // Inverse mutations shift both features first. Restore lost chart boundaries
          // only if the user has not manually replaced that source since capture.
          charts = withCharts(
            {},
            readCharts({ charts }).charts.map((chart) => {
              const source = sources.get(chart.id);
              return source?.sheetId === chart.sheetId &&
                source.revision === (chartRevisions.get(chart.id) ?? 0)
                ? { ...chart, range: source.range }
                : chart;
            }),
          ).charts;
        }
        activeOperation = undefined;
      }
      return true;
    },
  });
  const mutation = (
    operation: StructuralOperation,
    direction: "undo" | "redo",
    phase: "begin" | "end",
  ) => ({
    id: structuralMutation,
    params: { unitId: workbook.getId(), operation, direction, phase },
  });
  // Native undo/redo carries each command's deletion history, including deletions
  // caused by undo itself. Unrelated insertions never get that history.
  const beforeStructure = interceptors.interceptCommand({
    getMutations(command) {
      const params = command.params as { unitId: string; subUnitId: string } | undefined;
      if (
        readOnly ||
        params?.unitId !== workbook.getId() ||
        !/^sheet\.command\.(insert-row|insert-col|remove-row|remove-col)$/.test(command.id)
      )
        return { redos: [], undos: [] };
      const operation: StructuralOperation = { redo: [], undo: [] };
      if (charts !== undefined && /^sheet\.command\.remove-(row|col)$/.test(command.id)) {
        operation.chartSources = { sheetId: params.subUnitId, sources: [] };
      }
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
  const calculation = univerAPI.getFormula().calculationResultApplied(() => {
    if (!disposed && !loading) for (const listener of valueListeners) listener();
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
      if (charts !== undefined) {
        charts = withCharts(
          {},
          shiftChartRanges(readCharts({ charts }).charts, edit.sheet, edit),
        ).charts;
      }
      const deleted = anchors.shift(edit);
      let inverse: AnchorDeletions | undefined;
      if (activeOperation) {
        const { operation, direction } = activeOperation;
        operation[direction].push(deleted);
        inverse = operation[direction === "undo" ? "redo" : "undo"].pop();
        if (inverse) anchors.revive(inverse);
      }
      structuralLog.push({ edit, deleted, inverse });
      for (const listener of structures) listener(edit);
    }
    editedSinceLoad = true;
    notify();
  });
  const snapshot = (): Snapshot => {
    const data: Snapshot = JSON.parse(JSON.stringify(workbook.save()));
    delete data.commentAnchors;
    Object.assign(data, anchors.snapshot());
    // Univer drops unknown top-level metadata when saving its canvas model.
    if (charts !== undefined) data.charts = JSON.parse(JSON.stringify(charts));
    serializeSnapshot(data);
    return data;
  };
  const load = (data: Snapshot, newerSnapshot = true) => {
    serializeSnapshot(data);
    loading = true;
    charts = data.charts;
    editedSinceLoad = false;
    ++generation;
    queued = false;
    try {
      univerAPI.disposeUnit(workbook.getId());
      workbook = univerAPI.createWorkbook(data as Partial<IWorkbookData>);
      setEditable();
      anchors.load(data);
      if (newerSnapshot) structuralLog.length = 0;
      activeOperation = undefined;
      selectionChanged();
    } finally {
      loading = false;
    }
  };
  return {
    setCharts(value) {
      if (readOnly || commentsLoading) return;
      const previous = new Map(
        readCharts({ charts } as Snapshot).charts.map((chart) => [
          chart.id,
          JSON.stringify([chart.sheetId, chart.range]),
        ]),
      );
      const next = new Map(
        readCharts({ charts: value }).charts.map((chart) => [
          chart.id,
          JSON.stringify([chart.sheetId, chart.range]),
        ]),
      );
      // Keep tombstones so removing and recreating an ID cannot revive its history.
      for (const id of new Set([...previous.keys(), ...next.keys()])) {
        if (previous.get(id) !== next.get(id))
          chartRevisions.set(id, (chartRevisions.get(id) ?? 0) + 1);
      }
      charts = JSON.parse(JSON.stringify(value));
      notify();
    },
    selection() {
      const sheet = workbook.getActiveSheet();
      return {
        sheetId: sheet.getSheetId(),
        range: sheet.getActiveRange()?.getA1Notation() ?? "A1",
      };
    },
    onValuesChange(listener) {
      valueListeners.add(listener);
      return () => valueListeners.delete(listener);
    },
    setCommentsLoading(value) {
      commentsLoading = value;
      setEditable();
    },
    registerCommentAnchors(values, position = "snapshot") {
      const existing = anchors.snapshot().commentAnchors?.anchors ?? {};
      const rebased: Record<string, CellAnchor> = {};
      for (const [id, selector] of Object.entries(values)) {
        if (Object.hasOwn(existing, id)) continue;
        let anchor = selector;
        if (position === "snapshot") {
          for (const { edit, deleted, inverse } of structuralLog) {
            const next = shiftCellAnchor(anchor, edit);
            if (!anchor.deleted && next.deleted)
              deleted.anchors[id] = { sheetId: anchor.sheetId, cell: anchor.cell };
            anchor = next;
            const revived = inverse?.anchors[id];
            if (anchor.deleted && revived) anchor = { ...revived, deleted: false };
          }
        }
        rebased[id] = anchor;
      }
      if (anchors.register(rebased) && !readOnly) notify();
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
      if (commentsLoading) return { status: "blocked", reason: "comments-loading" };
      if (readOnly) return { status: "blocked", reason: "read-only" };
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
      // CSV import replaces canvas state, but unseen selectors still refer to
      // the mounted snapshot. Only an external snapshot reload resets the log.
      load(data as unknown as Snapshot, false);
      workbook.setActiveSheet(id);
      editedSinceLoad = true;
      notify();
      return { status: "imported" };
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
      calculation.dispose();
      loadingGuard.dispose();
      selectionSubscription.unsubscribe();
      sheetSubscription.dispose();
      beforeStructure.dispose();
      afterStructure.dispose();
      structuralCommand.dispose();
      selections.clear();
      structures.clear();
      listeners.clear();
      valueListeners.clear();
      univer.dispose();
    },
  };
};
