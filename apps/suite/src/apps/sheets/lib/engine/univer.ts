// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import UniverPresetSheetsConditionalFormattingEnUS from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import UniverPresetSheetsDataValidationEnUS from "@univerjs/preset-sheets-data-validation/locales/en-US";
import {
  CommandType,
  createUniver,
  ICommandService,
  type IWorkbookData,
  LocaleType,
  mergeLocales,
} from "@univerjs/presets";
import {
  type IInsertRowMutationParams,
  InsertColMutation,
  InsertRowMutation,
  RemoveColMutation,
  RemoveRowMutation,
  SheetInterceptorService,
} from "@univerjs/sheets";
import { shiftChartRanges } from "../charts/range";
import { type ChartSpec, readCharts, withCharts } from "../charts/spec";
import type { MountEngine, Snapshot } from "../contract";
import { serializeSnapshot } from "../model/snapshot";
import type { StructuralEdit } from "../refs/model";
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

const CHART_REFERENCE_MUTATIONS = new Map<string, Pick<StructuralEdit, "axis" | "kind">>([
  [InsertRowMutation.id, { axis: "row", kind: "insert" }],
  [InsertColMutation.id, { axis: "column", kind: "insert" }],
  [RemoveRowMutation.id, { axis: "row", kind: "delete" }],
  [RemoveColMutation.id, { axis: "column", kind: "delete" }],
]);
const CHART_SOURCE_DELETE_COMMANDS = new Set([
  "sheet.command.remove-row",
  "sheet.command.remove-col",
]);
const RESTORE_CHART_SOURCES = "sheets.mutation.restore-chart-sources";
const CAPTURE_CHART_SOURCES = "sheets.mutation.capture-chart-sources";
interface ChartSources {
  unitId: string;
  sources: {
    id: string;
    sheetId: string;
    range: ChartSpec["range"];
    revision: number;
  }[];
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
  // Only manual source changes (including deletion/recreation) change revisions.
  const chartRevisions = new Map<string, number>();
  let readOnly = options.readOnly ?? false;
  workbook.setEditable(!readOnly);
  const listeners = new Set<() => void>();
  const valueListeners = new Set<() => void>();
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
  const injector = univer.__getInjector();
  const chartMutation = injector.get(ICommandService).registerCommand({
    id: RESTORE_CHART_SOURCES,
    type: CommandType.MUTATION,
    handler: (_accessor, params: ChartSources) => {
      if (readOnly || params.unitId !== workbook.getId() || charts === undefined) return false;
      const sources = new Map(params.sources.map((source) => [source.id, source]));
      // Inverse mutations already shifted every chart. Recover lost boundaries only
      // for charts whose sources have not been manually edited since the latest replay.
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
      return true;
    },
  });
  const chartCapture = injector.get(ICommandService).registerCommand({
    id: CAPTURE_CHART_SOURCES,
    type: CommandType.MUTATION,
    handler: (_accessor, params: ChartSources & { subUnitId: string }) => {
      if (readOnly || params.unitId !== workbook.getId() || charts === undefined) return false;
      // The history entry shares this record between capture and restore. Refresh it
      // before every deletion replay, including redo after a manual source edit.
      params.sources = readCharts({ charts })
        .charts.filter((chart) => chart.sheetId === params.subUnitId)
        .map((chart) => ({
          id: chart.id,
          sheetId: chart.sheetId,
          range: chart.range,
          revision: chartRevisions.get(chart.id) ?? 0,
        }));
      return true;
    },
  });
  // Capture before all deletions (including filtered rows), restore after cells.
  const chartUndo = injector.get(SheetInterceptorService).interceptCommand({
    getMutations: (command) => {
      const params = command.params as IInsertRowMutationParams | undefined;
      if (
        readOnly ||
        !CHART_SOURCE_DELETE_COMMANDS.has(command.id) ||
        params?.unitId !== workbook.getId() ||
        charts === undefined
      )
        return { undos: [], redos: [] };
      const record: ChartSources & { subUnitId: string } = {
        unitId: params.unitId,
        subUnitId: params.subUnitId,
        sources: [],
      };
      return {
        preRedos: [{ id: CAPTURE_CHART_SOURCES, params: record }],
        undos: [{ id: RESTORE_CHART_SOURCES, params: record }],
        redos: [],
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
    const edit = CHART_REFERENCE_MUTATIONS.get(event.id);
    if (edit && charts !== undefined) {
      const { subUnitId, range } = event.params as IInsertRowMutationParams;
      const start = edit.axis === "row" ? range.startRow : range.startColumn;
      const end = edit.axis === "row" ? range.endRow : range.endColumn;
      charts = withCharts(
        {},
        shiftChartRanges(readCharts({ charts }).charts, subUnitId, {
          ...edit,
          index: start + 1,
          count: end - start + 1,
        }),
      ).charts;
    }
    editedSinceLoad = true;
    notify();
  });
  const snapshot = (): Snapshot => {
    const data: Snapshot = JSON.parse(JSON.stringify(workbook.save()));
    // Univer drops unknown top-level properties when saving its canvas model.
    if (charts !== undefined) data.charts = JSON.parse(JSON.stringify(charts));
    serializeSnapshot(data);
    return data;
  };
  const load = (data: Snapshot) => {
    serializeSnapshot(data);
    loading = true;
    charts = data.charts;
    editedSinceLoad = false;
    ++generation;
    queued = false;
    try {
      univerAPI.disposeUnit(workbook.getId());
      workbook = univerAPI.createWorkbook(data as Partial<IWorkbookData>);
      workbook.setEditable(!readOnly);
    } finally {
      loading = false;
    }
  };
  return {
    setCharts(value) {
      if (readOnly) return;
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
    load,
    snapshot,
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
      if (readOnly) return;
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
      workbook.setEditable(!readOnly);
    },
    dispose() {
      disposed = true;
      ++generation;
      subscription.dispose();
      calculation.dispose();
      chartUndo.dispose();
      chartCapture.dispose();
      chartMutation.dispose();
      listeners.clear();
      valueListeners.clear();
      univer.dispose();
    },
  };
};
