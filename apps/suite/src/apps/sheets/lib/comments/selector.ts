// AUTHORED-BY Codex GPT-6.1-Sol
import { shiftReference } from "../refs/edits";
import type { StructuralEdit } from "../refs/model";
import { formatA1, parseA1 } from "../refs/notation";

export interface CellAnchor {
  sheetId: string;
  cell: string;
  deleted: boolean;
}

/** A FragmentSelector value; sheet IDs are opaque and case-sensitive. */
export function formatCellSelector(anchor: CellAnchor): string {
  if (!anchor.sheetId || anchor.sheetId.length > 256 || anchor.cell.length > 32)
    throw new Error("Invalid cell selector");
  const ref = parseA1(anchor.cell);
  if (
    ref.sheet !== undefined ||
    !ref.rows ||
    !ref.columns ||
    ref.rows.start.index !== ref.rows.end.index ||
    ref.columns.start.index !== ref.columns.end.index ||
    formatA1(ref) !== anchor.cell ||
    ref.rows.start.absolute ||
    ref.columns.start.absolute
  )
    throw new Error("Invalid cell selector");
  return `sheet=${encodeURIComponent(anchor.sheetId)}&cell=${anchor.cell}`;
}

export function parseCellSelector(value: string): CellAnchor {
  const match = /^sheet=([^&]+)&cell=([A-Z]+[1-9][0-9]*)$/.exec(value);
  if (!match || match[0] !== value) throw new Error("Invalid cell selector");
  const anchor = {
    sheetId: decodeURIComponent(match[1] as string),
    cell: match[2] as string,
    deleted: false,
  };
  if (formatCellSelector(anchor) !== value) throw new Error("Invalid cell selector");
  return anchor;
}

export function shiftCellAnchor(anchor: CellAnchor, edit: StructuralEdit): CellAnchor {
  if (anchor.deleted || anchor.sheetId !== edit.sheet) return anchor;
  // refs treats sheet names case-insensitively; compare opaque IDs above first.
  const shifted = shiftReference(parseA1(anchor.cell), { ...edit, sheet: "cell" }, "cell");
  return shifted ? { ...anchor, cell: formatA1(shifted) } : { ...anchor, deleted: true };
}

/** Decode Univer structural payloads, including undo/redo's inverse mutations. */
export function commentStructuralEdit(id: string, params: unknown): StructuralEdit | undefined {
  if (/^sheet\.mutation\.move-(rows|columns)$/.test(id) && params && typeof params === "object") {
    const p = params as {
      subUnitId: string;
      sourceRange: { startRow: number; endRow: number; startColumn: number; endColumn: number };
      targetRange: { startRow: number; startColumn: number };
    };
    if (!p.subUnitId || !p.sourceRange || !p.targetRange) return undefined;
    const row = id.endsWith("rows");
    const start = row ? p.sourceRange.startRow : p.sourceRange.startColumn;
    const end = row ? p.sourceRange.endRow : p.sourceRange.endColumn;
    const target = row ? p.targetRange.startRow : p.targetRange.startColumn;
    if (
      ![start, end, target].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      end < start
    )
      return undefined;
    return {
      sheet: p.subUnitId,
      axis: row ? "row" : "column",
      kind: "reorder",
      index: start + 1,
      count: end - start + 1,
      destination: target + 1,
    };
  }
  const match = /^sheet\.mutation\.(insert-row|insert-col|remove-rows|remove-col)$/.exec(id);
  if (!match || !params || typeof params !== "object") return undefined;
  const p = params as {
    subUnitId?: string;
    range?: { startRow: number; endRow: number; startColumn: number; endColumn: number };
  };
  if (!p.subUnitId || !p.range) return undefined;
  const row = match[1] === "insert-row" || match[1] === "remove-rows";
  const start = row ? p.range.startRow : p.range.startColumn;
  const end = row ? p.range.endRow : p.range.endColumn;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start)
    return undefined;
  return {
    sheet: p.subUnitId,
    axis: row ? "row" : "column",
    kind: id.includes("insert") ? "insert" : "delete",
    index: start + 1,
    count: end - start + 1,
  };
}
