// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { CanceledError, ICommandService, IUndoRedoService, Rectangle } from "@univerjs/core";
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
import {
  SheetsSortService,
  SortRangeCommand,
  SortType,
  UniverSheetsSortPreset,
} from "@univerjs/preset-sheets-sort";
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
import { CollaborationBridge } from "../collaboration/bridge";
import { type Axes, axes, checkpoint, sheetStates } from "../collaboration/model";
import { type AnchorDeletions, WorkbookCommentAnchors } from "../comments/anchors";
import { type CellAnchor, commentStructuralEdit, shiftCellAnchor } from "../comments/selector";
import type { MountEngine, Snapshot } from "../contract";
import { serializeSnapshot } from "../model/snapshot";
import type { AxisRange, StructuralEdit } from "../refs/model";
import { indexToColumn, parseA1 } from "../refs/notation";
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

// Univer also uses COMMAND for navigation that does not edit cells or history.
const NAVIGATION_COMMANDS = new Set([
  "sheet.command.scroll-to-cell",
  "sheet.command.set-worksheet-activate",
  "sheet.command.select-range",
  "sheet.command.move-selection",
  "sheet.command.move-selection-enter-tab",
  "sheet.command.expand-selection",
  "sheet.command.select-all",
  "sheet.command.set-scroll-relative",
  "sheet.command.scroll-view",
  "sheet.command.scroll-view-reset",
]);

interface StructuralOperation {
  chartSources?: {
    sheetId: string;
    sources: {
      id: string;
      sheetId: string;
      range: ChartSpec["range"];
      revision: number;
      identity?: Axes | undefined;
    }[];
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
  type Identity = { sheetId: string; rowId: string; colId: string };
  const identities = { anchors: new Map<string, Identity>(), drafts: new Map<string, Identity>() };
  let identityRevision = -1;
  const chartIdentities = new Map<
    string,
    { sheetId: string; rowIds: string[]; colIds: string[]; revision: number; lost: boolean }
  >();
  let beforePositions: Map<string, Axes> | undefined;
  const metadata = (phase: "before" | "after", positions: Map<string, Axes>) => {
    if (phase === "before")
      beforePositions = new Map(
        [...positions].map(([id, position]) => [
          id,
          { rowIds: [...position.rowIds], colIds: [...position.colIds] },
        ]),
      );
    const checkpoint = anchors.identitySnapshot();
    if (checkpoint.revision !== identityRevision) {
      identities.anchors.clear();
      identities.drafts.clear();
      chartIdentities.clear();
      identityRevision = checkpoint.revision;
    }
    const restore: AnchorDeletions = { revision: checkpoint.revision, anchors: {}, drafts: {} };
    for (const kind of ["anchors", "drafts"] as const) {
      if (phase === "before") {
        for (const [id, anchor] of Object.entries(checkpoint[kind])) {
          const axes = positions.get(anchor.sheetId);
          const ref = parseA1(anchor.cell);
          const rowId = axes?.rowIds[(ref.rows as AxisRange).start.index - 1];
          const colId = axes?.colIds[(ref.columns as AxisRange).start.index - 1];
          if (rowId && colId) identities[kind].set(id, { sheetId: anchor.sheetId, rowId, colId });
        }
      } else {
        for (const [id, identity] of identities[kind]) {
          const axes = positions.get(identity.sheetId) as Axes;
          const row = axes.rowIds.indexOf(identity.rowId);
          const col = axes.colIds.indexOf(identity.colId);
          if (row >= 0 && col >= 0) {
            const anchor = {
              sheetId: identity.sheetId,
              cell: `${indexToColumn(col + 1)}${row + 1}`,
              deleted: false,
            };
            if (kind === "drafts") restore.drafts[id] = anchor;
            else restore.anchors[id] = { sheetId: anchor.sheetId, cell: anchor.cell };
          }
        }
      }
    }
    if (phase === "after") anchors.revive(restore);
    const current = readCharts({ charts } as Snapshot).charts;
    charts =
      charts === undefined
        ? charts
        : withCharts(
            {},
            current.map((chart) => {
              let identity = chartIdentities.get(chart.id);
              const revision = chartRevisions.get(chart.id) ?? 0;
              if (identity?.revision !== revision) {
                chartIdentities.delete(chart.id);
                identity = undefined;
              }
              const axes = positions.get(chart.sheetId);
              if (!axes) return chart;
              if (phase === "before" && !identity?.lost && chart.range !== null) {
                const ref = parseA1(chart.range);
                identity = {
                  sheetId: chart.sheetId,
                  rowIds: [
                    axes.rowIds[(ref.rows as AxisRange).start.index - 1] as string,
                    axes.rowIds[(ref.rows as AxisRange).end.index - 1] as string,
                  ],
                  colIds: [
                    axes.colIds[(ref.columns as AxisRange).start.index - 1] as string,
                    axes.colIds[(ref.columns as AxisRange).end.index - 1] as string,
                  ],
                  revision,
                  lost: false,
                };
                chartIdentities.set(chart.id, identity);
              }
              if (phase === "after" && identity) {
                const rows = identity.rowIds.map((id) => axes.rowIds.indexOf(id));
                const cols = identity.colIds.map((id) => axes.colIds.indexOf(id));
                if ([...rows, ...cols].some((index) => index < 0)) identity.lost = true;
                else if (identity.lost) {
                  identity.lost = false;
                  return {
                    ...chart,
                    range: `${indexToColumn(Math.min(...cols) + 1)}${Math.min(...rows) + 1}:${indexToColumn(Math.max(...cols) + 1)}${Math.max(...rows) + 1}`,
                  };
                }
              }
              return chart;
            }),
          ).charts;
  };
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
    beforeAxes: Axes | undefined;
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
  const stableRange = (sheetId: string, range: string | null): Axes | undefined => {
    const state = options.collaboration && sheetStates(options.collaboration.doc).get(sheetId);
    if (!state || range === null) return undefined;
    const position = axes(state);
    const ref = parseA1(range);
    return {
      rowIds: position.rowIds.slice(
        (ref.rows as AxisRange).start.index - 1,
        (ref.rows as AxisRange).end.index,
      ),
      colIds: position.colIds.slice(
        (ref.columns as AxisRange).start.index - 1,
        (ref.columns as AxisRange).end.index,
      ),
    };
  };
  const resolveRange = (sheetId: string, identity: Axes): string | null => {
    const state = options.collaboration && sheetStates(options.collaboration.doc).get(sheetId);
    if (!state) return null;
    const position = axes(state);
    const rows = identity.rowIds
      .map((id) => position.rowIds.indexOf(id))
      .filter((index) => index >= 0);
    const cols = identity.colIds
      .map((id) => position.colIds.indexOf(id))
      .filter((index) => index >= 0);
    if (!rows.length || !cols.length) return null;
    return `${indexToColumn(Math.min(...cols) + 1)}${Math.min(...rows) + 1}:${indexToColumn(Math.max(...cols) + 1)}${Math.max(...rows) + 1}`;
  };
  const anchorCheckpoints = new WeakMap<AnchorDeletions, Map<string, Axes>>();
  const captureAnchors = (deleted: AnchorDeletions, fromCollab = false) => {
    if (!options.collaboration) return;
    const stable = new Map<string, Axes>();
    for (const kind of ["anchors", "drafts"] as const) {
      for (const [id, anchor] of Object.entries(deleted[kind])) {
        const known = fromCollab && identities[kind].get(id);
        const identity = known
          ? { rowIds: [known.rowId, known.rowId], colIds: [known.colId, known.colId] }
          : stableRange(anchor.sheetId, anchor.cell);
        if (identity) stable.set(`${kind}:${id}`, identity);
      }
    }
    anchorCheckpoints.set(deleted, stable);
  };
  const restoreAnchors = (deleted: AnchorDeletions) => {
    const stable = anchorCheckpoints.get(deleted);
    if (!stable) return deleted;
    const restored: AnchorDeletions = { revision: deleted.revision, anchors: {}, drafts: {} };
    for (const kind of ["anchors", "drafts"] as const) {
      for (const [id, anchor] of Object.entries(deleted[kind])) {
        const identity = stable.get(`${kind}:${id}`);
        const range = identity && resolveRange(anchor.sheetId, identity);
        if (range) restored[kind][id] = { ...anchor, cell: range.split(":")[0] as string };
      }
    }
    return restored;
  };
  let collaboration: CollaborationBridge | undefined;
  // setEditable does not guard native history replay. Cancel user commands before
  // they can mutate the workbook or consume undo/redo history while anchors load.
  // Navigation operations/commands and background calculation mutations can still run.
  const loadingGuard = commands.beforeCommandExecuted((command) => {
    if (command.type !== CommandType.COMMAND) return;
    if (commentsLoading && !isFilterCommand(command.id) && !NAVIGATION_COMMANDS.has(command.id))
      throw new CanceledError();
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
              identity: stableRange(chart.sheetId, chart.range),
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
                ? {
                    ...chart,
                    range: source.identity
                      ? resolveRange(source.sheetId, source.identity)
                      : source.range,
                  }
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
      (readOnly && !event.options?.fromCollab) ||
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
      const state = options.collaboration && sheetStates(options.collaboration.doc).get(edit.sheet);
      const beforeAxes = event.options?.fromCollab
        ? beforePositions?.get(edit.sheet)
        : state
          ? axes(state)
          : undefined;
      const deleted = anchors.shift(edit);
      captureAnchors(deleted, event.options?.fromCollab);
      let inverse: AnchorDeletions | undefined;
      if (activeOperation) {
        const { operation, direction } = activeOperation;
        operation[direction].push(deleted);
        inverse = operation[direction === "undo" ? "redo" : "undo"].pop();
        if (inverse) anchors.revive(restoreAnchors(inverse));
      }
      structuralLog.push({ revision: savedRevision, edit, deleted, inverse, beforeAxes });
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
    if (options.collaboration)
      data.collaboration =
        options.collaboration.checkpoint?.() ?? checkpoint(options.collaboration.doc);
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
    if (newerSnapshot) collaboration?.reset(data);
  };
  if (options.collaboration) {
    collaboration = new CollaborationBridge(
      options.collaboration.doc,
      commands,
      injector.get(IUndoRedoService),
      snapshot,
      () => !readOnly && !commentsLoading,
      options.snapshot,
      (styles) => {
        for (const [id, style] of styles)
          workbook.getWorkbook().getStyles().addCustomStyle(id, style);
      },
      metadata,
    );
  }
  return {
    sortRange(config) {
      if (readOnly) return { status: "blocked", reason: "This spreadsheet is view only." };
      if (commentsLoading)
        return { status: "blocked", reason: "Wait for comments to finish loading before sorting." };
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
        return {
          status: "blocked",
          reason: "Select a range with data and enter a column within it.",
        };
      // Validate and dispatch only the data rows. Passing the merged header to
      // SortRangeCommand makes its merge handling skip the unmerged data rows.
      const location = {
        unitId: workbook.getId(),
        subUnitId: sheet.getSheetId(),
        range: { ...range, startRow: range.startRow + Number(config.header) },
      };
      // Match the four checks performed by Univer's native sort UI.
      const sort = injector.get(SheetsSortService);
      if (!sort.singleCheck(location))
        return { status: "blocked", reason: "Select at least two data rows to sort." };
      // Native mergeCheck ignores partially overlapping merges, including merges
      // that cross from the excluded header into the data rows.
      const crossesMergeBoundary = sheet.getMergedRanges().some((merged) => {
        const merge = merged.getRange();
        return (
          Rectangle.intersects(location.range, merge) && !Rectangle.contains(location.range, merge)
        );
      });
      if (crossesMergeBoundary || !sort.mergeCheck(location))
        return {
          status: "blocked",
          reason: "Merged cells must be the same size to sort this range.",
        };
      if (!sort.formulaCheck(location))
        return { status: "blocked", reason: "Ranges containing array formulas cannot be sorted." };
      if (!sort.emptyCheck(location))
        return { status: "blocked", reason: "Select a range with data to sort." };
      const sorted = commands.syncExecuteCommand(SortRangeCommand.id, {
        ...location,
        hasTitle: false,
        orderRules: [
          { colIndex: config.column, type: config.ascending ? SortType.ASC : SortType.DESC },
        ],
      });
      return sorted
        ? { status: "sorted" }
        : { status: "blocked", reason: "Couldn't sort this range." };
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
          for (const { edit, deleted, inverse, beforeAxes } of structuralLog.slice(start)) {
            const next = shiftCellAnchor(anchor, edit);
            if (!anchor.deleted && next.deleted) {
              deleted.anchors[id] = { sheetId: anchor.sheetId, cell: anchor.cell };
              // Discovery may follow a failed initial list. Fill the native history
              // record with the identities at deletion time, including removed IDs.
              const ref = parseA1(anchor.cell);
              const rowId = beforeAxes?.rowIds[(ref.rows as AxisRange).start.index - 1];
              const colId = beforeAxes?.colIds[(ref.columns as AxisRange).start.index - 1];
              if (rowId && colId) {
                anchorCheckpoints.get(deleted)?.set(`anchors:${id}`, {
                  rowIds: [rowId],
                  colIds: [colId],
                });
                // Remote undo restores by identity, including roots discovered
                // only after their row/column was removed on another replica.
                identities.anchors.set(id, { sheetId: anchor.sheetId, rowId, colId });
              }
            }
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
      collaboration?.importSheet(data as unknown as Snapshot, id);
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
      if (options.collaboration) options.collaboration.readOnly = value;
      if (!previous && value) filterBaseline = data.resources;
      if (previous && !value) load(data, false);
      ++generation;
      queued = false;
      setEditable();
    },
    dispose() {
      disposed = true;
      collaboration?.dispose();
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
