// AUTHORED-BY Codex GPT-6.1-Sol
import type { ICellData, IWorkbookData } from "@univerjs/core";
import { formulaReferences } from "../refs/formula";
import type { AxisRange, Reference } from "../refs/model";
import { indexToColumn } from "../refs/notation";
import type { Axes } from "./model";

type StableReference = {
  text: string;
  sheetId: string;
  reference: Reference;
  rows: (string | null)[] | null;
  columns: (string | null)[] | null;
};
export type StoredCell = ICellData & { stableFormula?: (string | StableReference)[] };

export function encodeCell(
  cell: ICellData,
  sheetId: string,
  workbook: IWorkbookData,
  positions: Map<string, Axes>,
): StoredCell {
  if (!cell.f) return cell;
  const parts: (string | StableReference)[] = [];
  let end = 0;
  for (const token of formulaReferences(cell.f)) {
    const target =
      token.ref.sheet === undefined
        ? sheetId
        : Object.keys(workbook.sheets).find(
            (id) => workbook.sheets[id]?.name?.toLowerCase() === token.ref.sheet?.toLowerCase(),
          );
    const axes = target === undefined ? undefined : positions.get(target);
    if (!axes) continue;
    const ids = (range: AxisRange | null, axis: string[]) =>
      range === null
        ? null
        : [axis[range.start.index - 1] ?? null, axis[range.end.index - 1] ?? null];
    parts.push(cell.f.slice(end, token.start), {
      text: token.text,
      sheetId: target as string,
      reference: token.ref,
      rows: ids(token.ref.rows, axes.rowIds),
      columns: ids(token.ref.columns, axes.colIds),
    });
    end = token.start + token.text.length;
  }
  parts.push(cell.f.slice(end));
  return { ...cell, stableFormula: parts };
}

export function decodeCell(
  cell: StoredCell,
  workbook: IWorkbookData,
  positions: Map<string, Axes>,
): ICellData {
  const { stableFormula, ...value } = cell;
  if (!stableFormula) return value;
  value.f = stableFormula
    .map((part) => {
      if (typeof part === "string") return part;
      const axes = positions.get(part.sheetId);
      const sheet = workbook.sheets[part.sheetId];
      if (!axes || !sheet) return "#REF!";
      const indices = (ids: (string | null)[] | null, axis: string[]) =>
        ids?.map((id) => (id === null ? -1 : axis.indexOf(id)));
      const rows = indices(part.rows, axes.rowIds);
      const cols = indices(part.columns, axes.colIds);
      if ([...(rows ?? []), ...(cols ?? [])].some((index) => index < 0)) return "#REF!";
      const ref = part.reference;
      const unchanged = (indices: number[] | undefined, range: AxisRange | null) =>
        !range || (indices?.[0] === range.start.index - 1 && indices?.[1] === range.end.index - 1);
      if (
        unchanged(rows, ref.rows) &&
        unchanged(cols, ref.columns) &&
        (ref.sheet === undefined || ref.sheet === sheet.name)
      )
        return part.text;
      const point = (end: "start" | "end", index: number) =>
        (cols
          ? `${ref.columns?.[end].absolute ? "$" : ""}${indexToColumn((cols[index] as number) + 1)}`
          : "") +
        (rows ? `${ref.rows?.[end].absolute ? "$" : ""}${(rows[index] as number) + 1}` : "");
      const start = point("start", 0),
        end = point("end", 1);
      // Preserve the original sheet spelling/quoting; names are snapshot-managed.
      const prefix =
        ref.sheet === undefined ? "" : part.text.slice(0, part.text.lastIndexOf("!") + 1);
      return prefix + start + (ref.rows && ref.columns && start === end ? "" : `:${end}`);
    })
    .join("");
  return value;
}
