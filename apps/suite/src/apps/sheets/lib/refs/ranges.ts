// AUTHORED-BY Codex GPT-6.1-Sol
import { type AxisRange, type Reference, sameSheet, validateReference } from "./model";

type Bounds = readonly [number, number];
const bounds = (range: AxisRange | null): Bounds =>
  range === null ? [1, Infinity] : [range.start.index, range.end.index];
const absoluteRange = ([start, end]: Bounds): AxisRange | null =>
  end === Infinity
    ? null
    : {
        start: { index: start, absolute: true },
        end: { index: end, absolute: true },
      };
function rectangle(sheet: string | undefined, rows: Bounds, columns: Bounds): Reference {
  return {
    ...(sheet === undefined ? {} : { sheet }),
    rows: absoluteRange(rows),
    columns: absoluteRange(columns),
  };
}

/** Exact geometric intersection; absolute markers in the inputs do not affect membership. */
export function intersectRanges(a: Reference, b: Reference): Reference | null {
  validateReference(a);
  validateReference(b);
  if (!sameSheet(a.sheet, b.sheet)) return null;
  const intersect = (x: Bounds, y: Bounds): Bounds => [Math.max(x[0], y[0]), Math.min(x[1], y[1])];
  const rows = intersect(bounds(a.rows), bounds(b.rows));
  const columns = intersect(bounds(a.columns), bounds(b.columns));
  return rows[0] > rows[1] || columns[0] > columns[1] ? null : rectangle(a.sheet, rows, columns);
}

/** Exact union, represented by one or two rectangles. The two may overlap. */
export function unionRanges(a: Reference, b: Reference): readonly Reference[] {
  validateReference(a);
  validateReference(b);
  const ar = bounds(a.rows),
    br = bounds(b.rows),
    ac = bounds(a.columns),
    bc = bounds(b.columns);
  const first = rectangle(a.sheet, ar, ac),
    second = rectangle(b.sheet, br, bc);
  if (!sameSheet(a.sheet, b.sheet)) return [first, second];
  const contains = (x: Bounds, y: Bounds) => x[0] <= y[0] && x[1] >= y[1];
  if (contains(ar, br) && contains(ac, bc)) return [first];
  if (contains(br, ar) && contains(bc, ac)) return [second];
  const equal = (x: Bounds, y: Bounds) => x[0] === y[0] && x[1] === y[1];
  const touching = (x: Bounds, y: Bounds) => x[0] <= y[1] + 1 && y[0] <= x[1] + 1;
  if ((equal(ar, br) && touching(ac, bc)) || (equal(ac, bc) && touching(ar, br))) {
    const envelope = (x: Bounds, y: Bounds): Bounds => [Math.min(x[0], y[0]), Math.max(x[1], y[1])];
    return [rectangle(a.sheet, envelope(ar, br), envelope(ac, bc))];
  }
  return [first, second];
}
