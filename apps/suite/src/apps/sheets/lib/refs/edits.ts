// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type AxisRange,
  positiveIndex,
  type Reference,
  SheetReferenceError,
  type StructuralEdit,
  sameSheet,
  validateReference,
  validateSheet,
} from "./model";

export function validateEdit(edit: StructuralEdit): void {
  validateSheet(edit.sheet);
  if (
    (edit.axis !== "row" && edit.axis !== "column") ||
    (edit.kind !== "insert" && edit.kind !== "delete")
  ) {
    throw new SheetReferenceError("invalid-edit", "Expected a row/column insertion/deletion");
  }
  positiveIndex(edit.index);
  positiveIndex(edit.count);
  positiveIndex(edit.index + (edit.count - 1));
}

function shiftAxis(range: AxisRange, edit: StructuralEdit): AxisRange | null {
  const start = range.start.index,
    end = range.end.index;
  let nextStart: number, nextEnd: number;
  if (edit.kind === "insert") {
    nextStart = start >= edit.index ? positiveIndex(start + edit.count) : start;
    nextEnd = end >= edit.index ? positiveIndex(end + edit.count) : end;
  } else {
    const last = edit.index + (edit.count - 1);
    if (start >= edit.index && end <= last) return null;
    nextStart = start < edit.index ? start : Math.max(edit.index, start - edit.count);
    nextEnd = end <= last ? Math.min(end, edit.index - 1) : end - edit.count;
  }
  return { start: { ...range.start, index: nextStart }, end: { ...range.end, index: nextEnd } };
}

/** null denotes #REF!. Local references resolve against formulaSheet. Never mutates inputs. */
export function shiftReference(
  ref: Reference,
  edit: StructuralEdit,
  formulaSheet: string,
): Reference | null {
  validateReference(ref);
  validateEdit(edit);
  validateSheet(formulaSheet);
  if (!sameSheet(ref.sheet ?? formulaSheet, edit.sheet)) return ref;
  const key = edit.axis === "row" ? "rows" : "columns";
  const range = ref[key];
  if (range === null) return ref;
  const shifted = shiftAxis(range, edit);
  return shifted === null ? null : { ...ref, [key]: shifted };
}
