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
  FILTER_MUTATIONS,
  SHEET_FILTER_SNAPSHOT_ID,
  UniverSheetsFilterPreset,
} from "@univerjs/preset-sheets-filter";
import UniverPresetSheetsFilterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import {
  OpenReplaceDialogOperation,
  UniverSheetsFindReplacePreset,
} from "@univerjs/preset-sheets-find-replace";
import UniverPresetSheetsFindReplaceEnUS from "@univerjs/preset-sheets-find-replace/locales/en-US";
import { SortRangeCommand, SortType, UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import UniverPresetSheetsSortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
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

const FILTER_COMMANDS = new Set([
  "sheet.command.smart-toggle-filter",
  "sheet.command.set-filter-range",
  "sheet.command.remove-sheet-filter",
  "sheet.command.set-filter-criteria",
  "sheet.command.clear-filter-criteria",
  "sheet.command.re-calc-filter",
]);
const isFilterCommand = (id: string) => FILTER_COMMANDS.has(id);

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
        UniverPresetSheetsSortEnUS,
        UniverPresetSheetsFilterEnUS,
        UniverPresetSheetsFindReplaceEnUS,
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
      UniverSheetsSortPreset(),
      UniverSheetsFilterPreset(),
      UniverSheetsFindReplacePreset(),
    ],
  });
  let workbook = univerAPI.createWorkbook(options.snapshot as Partial<IWorkbookData>);
  let charts = options.snapshot.charts;
  // Only manual source edits (including deletion/recreation) advance revisions.
  const chartRevisions = new Map<string, number>();
  let readOnly = options.readOnly ?? false;
  let commentsLoading = options.commentsLoading ?? false;
  // View filters never become authoritative, even when Write is later restored.
  let filterBaseline = options.snapshot.resources;
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
  let savedRevision = options.workbookRevision;
  let mountRevision = savedRevision;
  let logGeneration = 0;
  // Saves acknowledge the snapshot captured before I/O, even if more edits ran
  // before the response. Never associate that ETag with the response-time cursor.
  const savedCursors = new Map<string, number>();
  const snapshotCursors = new WeakMap<Snapshot, { generation: number; cursor: number }>();
  snapshotCursors.set(options.snapshot, { generation: logGeneration, cursor: 0 });
  const structuralLog: {
    revision: string | undefined;
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
    if (command.type !== CommandType.COMMAND) return;
    if (commentsLoading && !isFilterCommand(command.id)) throw new CanceledError();
    if (
      readOnly &&
      (/^sheet\.command\.(sort-|reorder-range|replace)/.test(command.id) ||
        /^ui\.command\.replace-/.test(command.id) ||
        /^univer\.command\.(undo|redo)$/.test(command.id))
    )
      throw new CanceledError();
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
      readOnly &&
      !loading &&
      FILTER_MUTATIONS.has(event.id) &&
      event.params?.unitId === workbook.getId()
    ) {
      for (const listener of valueListeners) listener();
    }
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
      structuralLog.push({ revision: savedRevision, edit, deleted, inverse });
      for (const listener of structures) listener(edit);
    }
    editedSinceLoad = true;
    notify();
  });
  const snapshot = (): Snapshot => {
    const data: Snapshot = JSON.parse(JSON.stringify(workbook.save()));
    if (readOnly && (data.resources !== undefined || filterBaseline !== undefined)) {
      const resources = Array.isArray(data.resources) ? data.resources : [];
      const baseline = Array.isArray(filterBaseline) ? filterBaseline : [];
      data.resources = [
        ...resources.filter(
          (resource) =>
            resource &&
            typeof resource === "object" &&
            !Array.isArray(resource) &&
            resource.name !== SHEET_FILTER_SNAPSHOT_ID,
        ),
        ...baseline.filter(
          (resource) =>
            resource &&
            typeof resource === "object" &&
            !Array.isArray(resource) &&
            resource.name === SHEET_FILTER_SNAPSHOT_ID,
        ),
      ];
    }
    delete data.commentAnchors;
    Object.assign(data, anchors.snapshot());
    // Univer drops unknown top-level metadata when saving its canvas model.
    if (charts !== undefined) data.charts = JSON.parse(JSON.stringify(charts));
    serializeSnapshot(data);
    snapshotCursors.set(data, { generation: logGeneration, cursor: structuralLog.length });
    return data;
  };
  const load = (data: Snapshot, newerSnapshot = true, revision?: string) => {
    serializeSnapshot(data);
    loading = true;
    charts = data.charts;
    filterBaseline = data.resources;
    editedSinceLoad = false;
    ++generation;
    queued = false;
    try {
      univerAPI.disposeUnit(workbook.getId());
      workbook = univerAPI.createWorkbook(data as Partial<IWorkbookData>);
      setEditable();
      anchors.load(data);
      if (newerSnapshot) {
        structuralLog.length = 0;
        savedCursors.clear();
        ++logGeneration;
        mountRevision = revision;
        savedRevision = revision;
        snapshotCursors.set(data, { generation: logGeneration, cursor: 0 });
      }
      activeOperation = undefined;
      selectionChanged();
    } finally {
      loading = false;
    }
  };
  return {
    sortRange(config) {
      if (readOnly || commentsLoading) return false;
      const sheet = workbook.getActiveSheet();
      const range =
        config.scope === "sheet"
          ? sheet.getDataRange().getRange()
          : sheet.getActiveRange()?.getRange();
      if (
        !range ||
        !Number.isInteger(config.column) ||
        config.column < range.startColumn ||
        config.column > range.endColumn ||
        range.endRow < range.startRow + Number(config.header)
      )
        return false;
      return commands.syncExecuteCommand(SortRangeCommand.id, {
        unitId: workbook.getId(),
        subUnitId: sheet.getSheetId(),
        range,
        hasTitle: config.header,
        orderRules: [
          { colIndex: config.column, type: config.ascending ? SortType.ASC : SortType.DESC },
        ],
      });
    },
    hasFilter: () => workbook.getActiveSheet().getFilter() !== null,
    async toggleFilter() {
      return commands.executeCommand("sheet.command.smart-toggle-filter");
    },
    async clearFilter() {
      return commands.executeCommand("sheet.command.clear-filter-criteria", {
        unitId: workbook.getId(),
        subUnitId: workbook.getActiveSheet().getSheetId(),
      });
    },
    async findReplace() {
      await commands.executeCommand(OpenReplaceDialogOperation.id);
    },
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
    commentRevision: () => savedRevision,
    setWorkbookRevision(revision, data) {
      const checkpoint = snapshotCursors.get(data);
      if (disposed || !revision || checkpoint?.generation !== logGeneration) return;
      savedCursors.set(revision, checkpoint.cursor);
      savedRevision = revision;
    },
    registerCommentAnchors(values, position = "snapshot", revisions = {}) {
      const existing = anchors.snapshot().commentAnchors?.anchors ?? {};
      const rebased: Record<string, CellAnchor> = {};
      for (const [id, selector] of Object.entries(values)) {
        if (Object.hasOwn(existing, id)) continue;
        let anchor = selector;
        const revision = revisions[id];
        // An absent/foreign baseline cannot safely be inferred from coordinates.
        const start = revision
          ? (savedCursors.get(revision) ?? (revision === mountRevision ? 0 : -1))
          : -1;
        if (position === "snapshot" && start >= 0) {
          for (const { edit, deleted, inverse } of structuralLog.slice(start)) {
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
    load(data, revision) {
      load(data, true, revision);
    },
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
      const previous = readOnly;
      const data = snapshot();
      readOnly = value;
      if (!previous && value) filterBaseline = data.resources;
      if (previous && !value) load(data, false);
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
