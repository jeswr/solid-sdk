// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import {
  CommandType,
  createUniver,
  type IWorkbookData,
  LocaleType,
  mergeLocales,
} from "@univerjs/presets";
import type { MountEngine, Snapshot } from "../contract";
import { serializeSnapshot } from "../model/snapshot";
import { parseCsv } from "../univer-spike/csv";
import { workbookToCsv } from "../univer-spike/workbook";

export const mountUniver: MountEngine = async (container, options) => {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
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
    ],
  });
  let workbook = univerAPI.createWorkbook(options.snapshot as Partial<IWorkbookData>);
  const listeners = new Set<() => void>();
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
  const subscription = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
    if (
      event.type !== CommandType.MUTATION ||
      loading ||
      event.options?.fromChangeset ||
      event.id.startsWith("formula.") ||
      event.params?.unitId !== workbook.getId()
    )
      return;
    // Initial formula calculation belongs to loading, including its asynchronous results.
    if (event.options?.fromFormula && !editedSinceLoad) return;
    editedSinceLoad = true;
    notify();
  });
  const snapshot = (): Snapshot => {
    const data: Snapshot = JSON.parse(JSON.stringify(workbook.save()));
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
    } finally {
      loading = false;
    }
  };
  return {
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
    dispose() {
      disposed = true;
      ++generation;
      subscription.dispose();
      listeners.clear();
      univer.dispose();
    },
  };
};
