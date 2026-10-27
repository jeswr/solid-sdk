// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  type AxisRange,
  type CellPosition,
  type Reference,
  SheetReferenceError,
  shiftReference,
} from "../refs";
import { validateEdit } from "../refs/edits";
import { positiveIndex, sameSheet, validatePosition, validateSheet } from "../refs/model";
import { checkFormulaLength, rewriteFormula } from "./formula";
import {
  type CellChange,
  type CellData,
  MAX_CELL_VALUE_LENGTH,
  MAX_CELLS,
  MAX_SHEET_NAME_LENGTH,
  MAX_SHEETS,
  type MoveRange,
  type StructureCell,
  type StructureEdit,
  type StructurePlan,
  type StructureSheet,
} from "./model";

function invalidInput(): never {
  throw new SheetReferenceError(
    "invalid-edit",
    "Malformed or oversized workbook or structural edit",
  );
}

function checkSheetName(name: unknown): void {
  if (typeof name !== "string" || name.length > MAX_SHEET_NAME_LENGTH) invalidInput();
}

/** Counts precede traversal; all lengths precede validation, indexing and formula scans. */
function preflight(sheets: readonly StructureSheet[], edit: StructureEdit): void {
  if (!Array.isArray(sheets) || sheets.length > MAX_SHEETS) invalidInput();
  let cells = 0;
  for (const sheet of sheets) {
    if (!sheet || !Array.isArray(sheet.cells)) invalidInput();
    checkSheetName(sheet.name);
    cells += sheet.cells.length;
    if (cells > MAX_CELLS) invalidInput();
  }
  if (edit.kind === "move") {
    checkSheetName(edit.source.sheet);
    checkSheetName(edit.destination.sheet);
  } else checkSheetName(edit.sheet);
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (!cell) invalidInput();
      if (typeof cell.value === "string" && cell.value.length > MAX_CELL_VALUE_LENGTH)
        invalidInput();
      if (typeof cell.formula === "string") checkFormulaLength(cell.formula);
    }
  }
}

function reject(message: string): never {
  throw new SheetReferenceError("unsupported", message);
}

function keys(value: unknown, allowed: readonly string[]): void {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    reject("Expected a record");
  if (Object.keys(value).some((key) => !allowed.includes(key))) reject("Unsupported fields");
}

function data(cell: StructureCell): CellData {
  if (cell.formula !== undefined) {
    if (
      typeof cell.formula !== "string" ||
      cell.value !== undefined ||
      (cell.notation !== undefined && cell.notation !== "A1" && cell.notation !== "R1C1")
    )
      reject("Invalid formula cell");
    return {
      formula: cell.formula,
      ...(cell.notation === undefined ? {} : { notation: cell.notation }),
    };
  }
  const value = cell.value;
  if (
    cell.notation !== undefined ||
    !(
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
  )
    reject("Invalid value cell");
  return { value };
}

const address = (cell: CellPosition): string => `${cell.row},${cell.column}`;
const order = (a: CellPosition, b: CellPosition): number => a.row - b.row || a.column - b.column;

function findSheet(sheets: ReadonlyMap<string, number>, name: string): number {
  checkSheetName(name);
  validateSheet(name);
  const sheet = sheets.get(name.toLowerCase());
  if (sheet === undefined) reject("Unknown sheet");
  return sheet;
}

function validateWorkbook(sheets: readonly StructureSheet[]): Map<string, number> {
  const names = new Map<string, number>();
  for (const [index, sheet] of sheets.entries()) {
    keys(sheet, ["name", "cells"]);
    validateSheet(sheet.name);
    const name = sheet.name.toLowerCase();
    if (names.has(name)) reject("Duplicate sheet name");
    names.set(name, index);
  }
  for (const sheet of sheets) {
    const positions = new Set<string>();
    for (const cell of sheet.cells) {
      keys(cell, ["row", "column", "value", "formula", "notation"]);
      validatePosition(cell);
      if (positions.has(address(cell))) reject("Duplicate cell address");
      positions.add(address(cell));
      data(cell);
      if (cell.formula !== undefined) {
        rewriteFormula(cell.formula, cell.notation ?? "A1", cell, cell, (ref) => {
          findSheet(names, ref.sheet ?? sheet.name);
          return ref;
        });
      }
    }
  }
  return names;
}

interface Rectangle {
  sheet: string;
  start: CellPosition;
  end: CellPosition;
}
function destination(edit: MoveRange): Rectangle {
  return {
    sheet: edit.destination.sheet,
    start: edit.destination,
    end: {
      row: positiveIndex(edit.destination.row + (edit.source.end.row - edit.source.start.row)),
      column: positiveIndex(
        edit.destination.column + (edit.source.end.column - edit.source.start.column),
      ),
    },
  };
}

function contains(rect: Rectangle, sheet: string, cell: CellPosition): boolean {
  return (
    sameSheet(rect.sheet, sheet) &&
    cell.row >= rect.start.row &&
    cell.row <= rect.end.row &&
    cell.column >= rect.start.column &&
    cell.column <= rect.end.column
  );
}

function validateOperation(sheets: ReadonlyMap<string, number>, edit: StructureEdit): void {
  if (edit.kind !== "move") {
    keys(edit, ["sheet", "axis", "kind", "index", "count"]);
    validateEdit(edit);
    findSheet(sheets, edit.sheet);
    return;
  }
  keys(edit, ["kind", "source", "destination"]);
  keys(edit.source, ["sheet", "start", "end"]);
  keys(edit.source.start, ["row", "column"]);
  keys(edit.source.end, ["row", "column"]);
  keys(edit.destination, ["sheet", "row", "column"]);
  findSheet(sheets, edit.source.sheet);
  findSheet(sheets, edit.destination.sheet);
  validatePosition(edit.source.start);
  validatePosition(edit.source.end);
  validatePosition(edit.destination);
  if (
    edit.source.start.row > edit.source.end.row ||
    edit.source.start.column > edit.source.end.column
  )
    reject("Reversed move range");
  destination(edit);
}

function translate(cell: CellPosition, edit: MoveRange): CellPosition {
  return {
    row: positiveIndex(edit.destination.row + (cell.row - edit.source.start.row)),
    column: positiveIndex(edit.destination.column + (cell.column - edit.source.start.column)),
  };
}

function relocate(
  cell: CellPosition,
  sheet: string,
  edit: StructureEdit,
): { sheet: string; position: CellPosition } | null {
  if (edit.kind === "move") {
    if (contains(edit.source, sheet, cell))
      return { sheet: edit.destination.sheet, position: translate(cell, edit) };
    if (contains(destination(edit), sheet, cell)) return null;
    return { sheet, position: cell };
  }
  if (!sameSheet(sheet, edit.sheet)) return { sheet, position: cell };
  const key = edit.axis === "row" ? "row" : "column";
  const index = cell[key];
  if (index < edit.index) return { sheet, position: cell };
  if (edit.kind === "delete" && index <= edit.index + (edit.count - 1)) return null;
  return {
    sheet,
    position: {
      ...cell,
      [key]: positiveIndex(index + (edit.kind === "insert" ? edit.count : -edit.count)),
    },
  };
}

function moveReference(
  ref: Reference,
  edit: MoveRange,
  oldSheet: string,
  newSheet: string,
): Reference {
  let targetSheet = ref.sheet ?? oldSheet;
  let rows = ref.rows,
    columns = ref.columns;
  if (sameSheet(targetSheet, edit.source.sheet)) {
    const r1 = rows?.start.index ?? 1,
      r2 = rows?.end.index ?? Infinity;
    const c1 = columns?.start.index ?? 1,
      c2 = columns?.end.index ?? Infinity;
    const source = edit.source;
    const overlaps =
      r1 <= source.end.row &&
      r2 >= source.start.row &&
      c1 <= source.end.column &&
      c2 >= source.start.column;
    const noop =
      sameSheet(source.sheet, edit.destination.sheet) &&
      source.start.row === edit.destination.row &&
      source.start.column === edit.destination.column;
    if (overlaps && !noop) {
      if (
        r1 < source.start.row ||
        r2 > source.end.row ||
        c1 < source.start.column ||
        c2 > source.end.column
      )
        reject("Move splits a referenced range");
      const shift = (axis: AxisRange, delta: number): AxisRange => ({
        start: { ...axis.start, index: positiveIndex(axis.start.index + delta) },
        end: { ...axis.end, index: positiveIndex(axis.end.index + delta) },
      });
      rows = shift(rows as AxisRange, edit.destination.row - source.start.row);
      columns = shift(columns as AxisRange, edit.destination.column - source.start.column);
      targetSheet = edit.destination.sheet;
    }
  }
  // Unqualified references in cross-sheet cuts must retain their original targets.
  const sheet =
    ref.sheet === undefined && sameSheet(targetSheet, newSheet) ? undefined : targetSheet;
  return { ...(sheet === undefined ? {} : { sheet }), rows, columns };
}

function plan(sheets: readonly StructureSheet[], edit: StructureEdit): StructurePlan {
  preflight(sheets, edit);
  const names = validateWorkbook(sheets);
  validateOperation(names, edit);
  const next = sheets.map((sheet) => ({ name: sheet.name, cells: [] as StructureCell[] }));
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      const target = relocate(cell, sheet.name, edit);
      if (target === null) continue;
      let content = data(cell);
      if (cell.formula !== undefined) {
        const formula = rewriteFormula(
          cell.formula,
          cell.notation ?? "A1",
          cell,
          target.position,
          (ref) =>
            edit.kind === "move"
              ? moveReference(ref, edit, sheet.name, target.sheet)
              : shiftReference(ref, edit, sheet.name),
        );
        content = { ...content, formula } as CellData;
      }
      const output = next[findSheet(names, target.sheet)] as {
        name: string;
        cells: StructureCell[];
      };
      output.cells.push({ row: target.position.row, column: target.position.column, ...content });
    }
  }
  const changes: CellChange[] = [];
  for (const [index, sheet] of sheets.entries()) {
    const output = next[index] as { name: string; cells: StructureCell[] };
    output.cells.sort(order);
    const before = new Map(sheet.cells.map((cell) => [address(cell), cell]));
    const after = new Map(output.cells.map((cell) => [address(cell), cell]));
    const positions = new Map([...before, ...after]);
    for (const cell of [...positions.values()].sort(order)) {
      const oldCell = before.get(address(cell)),
        newCell = after.get(address(cell));
      const oldData = oldCell === undefined ? null : data(oldCell),
        newData = newCell === undefined ? null : data(newCell);
      if (JSON.stringify(oldData) !== JSON.stringify(newData))
        changes.push({
          sheet: sheet.name,
          row: cell.row,
          column: cell.column,
          before: oldData,
          after: newData,
        });
    }
  }
  return { sheets: next, changes };
}

/** Atomic cut/insert/delete planning. Inputs are never mutated and no partial plan escapes. */
export function planStructureEdit(
  sheets: readonly StructureSheet[],
  edit: StructureEdit,
): StructurePlan {
  try {
    return plan(sheets, edit);
  } catch (error) {
    if (error instanceof SheetReferenceError) throw error;
    throw new SheetReferenceError("invalid-edit", "Malformed workbook or structural edit");
  }
}
