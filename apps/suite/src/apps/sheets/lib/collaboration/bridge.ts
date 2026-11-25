// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  CommandType,
  type ICellData,
  type ICommandService,
  type IStyleData,
  type IUndoRedoItem,
  type IUndoRedoService,
  type IWorkbookData,
  type IWorksheetData,
  Tools,
} from "@univerjs/core";
import * as Y from "yjs";
import type { Snapshot } from "../contract";
import { decodeCell, encodeCell, type StoredCell } from "./formulas";
import {
  type Axes,
  axes,
  cells,
  jsonCopy,
  LOCAL_ORIGIN,
  reconcileAxis,
  SEED_ORIGIN,
  type SheetState,
  seedSheets,
  sheetStates,
  snapshotAxes,
  spliceAxis,
  styleValue,
} from "./model";

const historyMutation = "sheets.mutation.collaborative-history";
const structure =
  /^sheet\.mutation\.(insert-row|insert-col|remove-rows|remove-col|move-rows|move-columns)$/;
// Univer 1.2 sort writes reorder-range; single/bulk replace writes set-range-values.
// Filter range/criteria/recalculation mutations only affect snapshot metadata and
// local visibility. Keep them out of Yjs and, especially, the stable-axis splice path.
const collaborative = (id: string) =>
  structure.test(id) ||
  id === "sheet.mutation.set-range-values" ||
  id === "sheet.mutation.reorder-range";
type StackItem = Y.UndoManager["undoStack"][number];
type HistoryToken = { undo: StackItem | undefined; redo: StackItem | undefined };

interface MutationParams {
  trigger?: string;
  unitId: string;
  subUnitId: string;
  range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
  sourceRange: MutationParams["range"];
  targetRange: MutationParams["range"];
  cellValue: Record<string, Record<string, ICellData | null>>;
}

/** Translate native mutations at stable row/column identities, once per user command. */
export class CollaborationBridge {
  private readonly undo: Y.UndoManager;
  private applying = false;
  private readonly previousHistory = new WeakMap<object, IUndoRedoItem | null | undefined>();
  private pending: (() => void)[] = [];
  private positions = new Map<string, Axes>();
  private readonly cleanup: (() => void)[] = [];

  constructor(
    readonly doc: Y.Doc,
    private readonly commands: ICommandService,
    private readonly history: IUndoRedoService,
    private readonly read: () => Snapshot,
    private readonly editable: () => boolean,
    initial: Snapshot,
    private readonly installStyles: (styles: Map<string, IStyleData>) => void,
    private readonly metadata: (phase: "before" | "after", positions: Map<string, Axes>) => void,
  ) {
    this.undo = new Y.UndoManager([sheetStates(doc)], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 0,
    });
    const unitId = () => this.read().id;
    const replay = commands.registerCommand({
      id: historyMutation,
      type: CommandType.MUTATION,
      handler: (_accessor, params: { direction: "undo" | "redo"; token: HistoryToken }) => {
        if (!this.editable()) return false;
        const { direction, token } = params;
        const key = direction === "undo" ? "undoStack" : "redoStack";
        const inverse = direction === "undo" ? "redo" : "undo";
        const target = token[direction];
        if (!target) return true;
        const stack = this.undo[key];
        const index = stack.indexOf(target);
        if (index < 0) return true;
        stack.splice(index, 1);
        // Yjs normally skips overwritten items and continues into older edits.
        // A native history entry must replay exactly its own command instead.
        this.undo[key] = [target];
        try {
          const applied = this.undo[direction]();
          token[inverse] = applied
            ? this.undo[inverse === "undo" ? "undoStack" : "redoStack"].at(-1)
            : undefined;
          token[direction] = undefined;
        } finally {
          this.undo[key] = stack;
        }
        return true;
      },
    });
    // Keep the native history's order and structural metadata checkpoints.
    // Replace only coordinate-based collaborative patches with stable-ID undo.
    this.cleanup.push(() => replay.dispose());
    const before = commands.beforeCommandExecuted((command, options) => {
      if (this.applying || options?.fromCollab || !this.editable()) return;
      if (command.type === CommandType.COMMAND)
        this.previousHistory.set(command, this.history.pitchTopUndoElement() || undefined);
    });
    const after = commands.onCommandExecuted((command, options) => {
      if (this.applying || options?.fromCollab || !this.editable()) return;
      if (command.type === CommandType.MUTATION && !options?.fromFormula) {
        const params = command.params as MutationParams;
        if (params?.unitId === unitId()) this.capture(command.id, params);
      }
      if (command.type === CommandType.COMMAND) {
        const item = this.history.pitchTopUndoElement() || undefined;
        this.commit(item !== this.previousHistory.get(command) ? item : undefined);
      } else if (
        command.type === CommandType.MUTATION &&
        !(command.params as MutationParams | undefined)?.trigger
      )
        this.commit();
    });
    this.cleanup.push(
      () => before.dispose(),
      () => after.dispose(),
    );
    const changed = (transaction: Y.Transaction) => {
      if (transaction.origin !== LOCAL_ORIGIN) this.reconcile();
    };
    doc.on("afterTransaction", changed);
    this.cleanup.push(() => doc.off("afterTransaction", changed));
    this.reset(initial);
  }

  reset(snapshot: Snapshot) {
    this.undo.clear();
    this.positions.clear();
    for (const [id, state] of sheetStates(this.doc)) {
      this.positions.set(id, snapshotAxes(snapshot, id, state));
    }
    this.reconcile();
  }

  /** CSV import replaces one sheet in the existing editor and has no native undo. */
  importSheet(snapshot: Snapshot, id: string) {
    const workbook = snapshot as unknown as IWorkbookData;
    const sheet = workbook.sheets[id] as IWorksheetData;
    this.doc.transact(() => {
      seedSheets(this.doc, snapshot);
      const state = sheetStates(this.doc).get(id) as SheetState;
      const position = axes(state);
      for (const [key, length] of [
        ["rowIds", sheet.rowCount],
        ["colIds", sheet.columnCount],
      ] as const) {
        const array = state.get(key) as Y.Array<string>;
        const size = length as number;
        if (size > position[key].length)
          spliceAxis(
            array,
            position[key].length,
            0,
            Array.from({ length: size - position[key].length }, () => crypto.randomUUID()),
          );
      }
      const next = axes(state);
      cells(state).clear();
      for (const [r, row] of Object.entries(
        sheet.cellData as NonNullable<IWorksheetData["cellData"]>,
      )) {
        for (const [c, cell] of Object.entries(row)) {
          cells(state).set(
            `${next.rowIds[Number(r)]}|${next.colIds[Number(c)]}`,
            encodeCell(
              jsonCopy(cell as ICellData),
              id,
              workbook,
              new Map([...sheetStates(this.doc)].map(([id, state]) => [id, axes(state)])),
            ),
          );
        }
      }
    }, LOCAL_ORIGIN);
    this.undo.clear();
    this.positions.set(id, axes(sheetStates(this.doc).get(id) as SheetState));
  }

  private capture(id: string, params: MutationParams) {
    if (!collaborative(id)) return;
    const state = sheetStates(this.doc).get(params.subUnitId);
    const position = this.positions.get(params.subUnitId) as Axes;
    // Added sheets are snapshot-managed; their initial cells are seeded at commit.
    if (!state) return;
    if (id === "sheet.mutation.set-range-values" || id === "sheet.mutation.reorder-range") {
      const snapshot = this.read() as unknown as IWorkbookData;
      const sheet = snapshot.sheets[params.subUnitId];
      const captureCell = (r: number, c: number) => {
        const rowId = position.rowIds[r];
        const colId = position.colIds[c];
        if (rowId === undefined || colId === undefined) return;
        const key = `${rowId}|${colId}`;
        const cell = sheet?.cellData?.[r]?.[c];
        const value = cell
          ? encodeCell(jsonCopy(cell), params.subUnitId, snapshot, this.positions)
          : undefined;
        const style = typeof value?.s === "string" ? snapshot.styles[value.s] : undefined;
        this.pending.push(() => {
          const comparable = (stored: StoredCell | undefined) => {
            if (!stored) return undefined;
            const cell = decodeCell(stored, snapshot, this.positions);
            if (cell.f) {
              delete cell.v;
              delete cell.t;
              delete cell.si;
            }
            cell.s = styleValue(snapshot.styles, cell.s);
            return cell;
          };
          // Structural formula interceptors can resend unchanged cells. Treat
          // shifted formula text, cached results and equivalent style IDs as the
          // same value, or a peer's insertion would overwrite the sort's undo.
          if (Tools.diffValue(comparable(cells(state).get(key)), comparable(value))) return;
          if (style && typeof value?.s === "string")
            this.doc.getMap<IStyleData>("styles").set(value.s, jsonCopy(style));
          if (value) cells(state).set(key, value);
          else cells(state).delete(key);
        });
      };
      if (id === "sheet.mutation.reorder-range") {
        // Sorting moves content between existing row IDs, not the IDs themselves.
        // Capture the complete rectangle after reordering, including emptied cells;
        // commit() groups this and formula adjustments into one stable-ID undo item.
        const { startRow, endRow, startColumn, endColumn } = params.range;
        for (let r = startRow; r <= endRow; r++)
          for (let c = startColumn; c <= endColumn; c++) captureCell(r, c);
        return;
      }
      for (const [r, row] of Object.entries(params.cellValue ?? {})) {
        for (const c of Object.keys(row)) captureCell(Number(r), Number(c));
      }
      return;
    }
    const row = id.endsWith("row") || id.endsWith("rows");
    const key = row ? "rowIds" : "colIds";
    const start = row ? "startRow" : "startColumn";
    const end = row ? "endRow" : "endColumn";
    const array = state.get(key) as Y.Array<string>;
    const ids = position[key];
    if (id.includes(".move-")) {
      const from = params.sourceRange[start];
      const count = params.sourceRange[end] - from + 1;
      const target = params.targetRange[start];
      const destination = target > from ? target - count : target;
      const moved = ids.splice(from, count);
      ids.splice(destination, 0, ...moved);
      this.pending.push(() => {
        spliceAxis(array, from, count, []);
        spliceAxis(array, destination, 0, moved);
      });
    } else {
      const index = params.range[start];
      const count = params.range[end] - index + 1;
      const insert = id.includes("insert")
        ? Array.from({ length: count }, () => crypto.randomUUID())
        : [];
      const remove = insert.length ? 0 : count;
      ids.splice(index, remove, ...insert);
      this.pending.push(() => spliceAxis(array, index, remove, insert));
    }
  }

  private commit(item?: IUndoRedoItem | null) {
    const pending = this.pending;
    this.pending = [];
    const snapshot = this.read();
    const sheets = (snapshot as unknown as IWorkbookData).sheetOrder;
    if (!pending.length && sheets.every((id) => sheetStates(this.doc).has(id))) {
      return;
    }
    if (sheets.some((id) => !sheetStates(this.doc).has(id)))
      this.doc.transact(() => seedSheets(this.doc, snapshot), SEED_ORIGIN);
    const previousUndo = this.undo.undoStack.at(-1);
    if (pending.length)
      this.doc.transact(() => {
        for (const operation of pending) operation();
      }, LOCAL_ORIGIN);
    if (pending.length) {
      if (item && item.unitID === snapshot.id) {
        const latestUndo = this.undo.undoStack.at(-1);
        const token: HistoryToken = {
          undo: latestUndo !== previousUndo ? latestUndo : undefined,
          redo: undefined,
        };
        for (const direction of ["undo", "redo"] as const) {
          const key = direction === "undo" ? "undoMutations" : "redoMutations";
          let replaced = false;
          item[key] = item[key].flatMap((mutation) => {
            if (!collaborative(mutation.id)) return [mutation];
            if (replaced) return [];
            replaced = true;
            return [{ id: historyMutation, params: { direction, token } }];
          });
        }
      }
    }
    for (const [id, state] of sheetStates(this.doc)) this.positions.set(id, axes(state));
  }

  private execute(id: string, params: object) {
    if (!this.commands.syncExecuteCommand(id, params, { fromCollab: true }))
      throw new Error(`Couldn't apply spreadsheet update: ${id}`);
  }

  private reconcile() {
    this.applying = true;
    try {
      this.metadata("before", this.positions);
      let workbook = this.read() as unknown as IWorkbookData;
      const mergedPositions = new Map(
        [...sheetStates(this.doc)].map(([id, state]) => [id, axes(state)]),
      );
      this.installStyles(new Map(this.doc.getMap<IStyleData>("styles")));
      for (const [id, state] of sheetStates(this.doc)) {
        if (!workbook.sheets[id]) continue; // Sheet list remains snapshot-managed.
        const previous = this.positions.get(id) ?? snapshotAxes(this.read(), id, state);
        const next = axes(state);
        for (const axis of ["rowIds", "colIds"] as const) {
          const row = axis === "rowIds";
          reconcileAxis(previous[axis], next[axis], (edit) => {
            const range = {
              startRow: row ? edit.index : 0,
              endRow: row ? edit.index + edit.count - 1 : previous.rowIds.length - 1,
              startColumn: row ? 0 : edit.index,
              endColumn: row ? previous.colIds.length - 1 : edit.index + edit.count - 1,
            };
            const kind = edit.kind === "delete" ? "remove" : edit.kind;
            const suffix = row ? (kind === "remove" ? "rows" : "row") : "col";
            const params = { unitId: workbook.id, subUnitId: id, range };
            if (edit.kind === "move") {
              const destination = edit.destination as number;
              this.execute(`sheet.mutation.move-${row ? "rows" : "columns"}`, {
                ...params,
                sourceRange: range,
                targetRange: {
                  ...range,
                  ...(row
                    ? { startRow: destination, endRow: destination + edit.count - 1 }
                    : { startColumn: destination, endColumn: destination + edit.count - 1 }),
                },
              });
            } else this.execute(`sheet.mutation.${kind}-${suffix}`, params);
          });
          previous[axis] = next[axis];
        }
        this.positions.set(id, next);
        workbook = this.read() as unknown as IWorkbookData;
        const before = (workbook.sheets[id] as IWorksheetData).cellData as NonNullable<
          IWorksheetData["cellData"]
        >;
        const values: MutationParams["cellValue"] = {};
        // Clear removed fields too: Univer's set-values mutation otherwise merges
        // old formulas/styles into the incoming complete cell JSON.
        const desired: MutationParams["cellValue"] = {};
        const rows = new Map(next.rowIds.map((value, index) => [value, index]));
        const cols = new Map(next.colIds.map((value, index) => [value, index]));
        for (const [key, cell] of cells(state)) {
          const [r, c] = key.split("|");
          const row = rows.get(r as string);
          const col = cols.get(c as string);
          if (row === undefined || col === undefined) continue;
          desired[row] ??= {};
          desired[row][col] = decodeCell(cell, workbook, mergedPositions);
        }
        for (const r of new Set([...Object.keys(before), ...Object.keys(desired)])) {
          for (const c of new Set([
            ...Object.keys(before[Number(r)] ?? {}),
            ...Object.keys(desired[r] ?? {}),
          ])) {
            const cell = desired[r]?.[c];
            if (JSON.stringify(before[Number(r)]?.[Number(c)]) === JSON.stringify(cell)) continue;
            const value = cell ? jsonCopy(cell) : null;
            values[r] ??= {};
            values[r][c] = value;
          }
        }
        if (Object.keys(values).length) {
          const params = { unitId: workbook.id, subUnitId: id };
          this.execute("sheet.mutation.set-range-values", {
            ...params,
            cellValue: Object.fromEntries(
              Object.entries(values).map(([r, row]) => [
                r,
                Object.fromEntries(Object.keys(row).map((c) => [c, null])),
              ]),
            ),
          });
          this.execute("sheet.mutation.set-range-values", {
            ...params,
            cellValue: values,
            isOverrideStyle: true,
          });
        }
      }
      this.metadata("after", this.positions);
    } finally {
      this.applying = false;
    }
  }

  dispose() {
    for (const cleanup of this.cleanup) cleanup();
    this.undo.destroy();
  }
}
