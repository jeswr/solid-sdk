// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type Axis,
  type AxisRange,
  type CellPosition,
  positiveIndex,
  type Reference,
  SheetReferenceError,
  validatePosition,
  validateReference,
  validateSheet,
} from "./model";

export function columnToIndex(label: string): number {
  if (!/^[A-Za-z]+$(?![\s\S])/.test(label)) {
    throw new SheetReferenceError("syntax", "Expected column letters");
  }
  let index = 0;
  for (const char of label.toUpperCase()) {
    index = positiveIndex(index * 26 + (char.charCodeAt(0) - 64));
  }
  return index;
}

export function indexToColumn(index: number): string {
  positiveIndex(index);
  let label = "";
  while (index > 0) {
    index--;
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26);
  }
  return label;
}

function splitSheet(text: string): { sheet?: string; body: string } {
  const match = /^(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!(.+)$/.exec(text);
  if (!match || match[0] !== text) return { body: text };
  const sheet = match[1] === undefined ? (match[2] as string) : match[1].replaceAll("''", "'");
  validateSheet(sheet);
  return { sheet, body: match[3] as string };
}

function prefix(ref: Reference): string {
  // Always quoting avoids ambiguity with A1-looking sheet names and escaped apostrophes.
  return ref.sheet === undefined ? "" : `'${ref.sheet.replaceAll("'", "''")}'!`;
}

interface Endpoint {
  row: Axis | null;
  column: Axis | null;
}

function parse(text: string, endpoint: (text: string) => Endpoint): Reference {
  const { sheet, body } = splitSheet(text);
  const parts = body.split(":");
  if (parts.length > 2)
    throw new SheetReferenceError("unsupported", "Only rectangular ranges are supported");
  const start = endpoint(parts[0] as string);
  const end = endpoint(parts[1] ?? (parts[0] as string));
  if (
    (start.row === null) !== (end.row === null) ||
    (start.column === null) !== (end.column === null) ||
    (parts.length === 1 && (start.row === null || start.column === null))
  ) {
    throw new SheetReferenceError(
      "syntax",
      "Whole rows and columns require matching range endpoints",
    );
  }
  const pair = (a: Axis | null, b: Axis | null): AxisRange | null =>
    a === null ? null : { start: a, end: b as Axis };
  const ref = {
    ...(sheet === undefined ? {} : { sheet }),
    rows: pair(start.row, end.row),
    columns: pair(start.column, end.column),
  };
  validateReference(ref);
  return ref;
}

export function parseA1(text: string): Reference {
  return parse(text, (part) => {
    const match = /^(?:(\$?)([A-Za-z]+))?(?:(\$?)([1-9][0-9]*))?$/.exec(part);
    if (!match || match[0] !== part || (!match[2] && !match[4]))
      throw new SheetReferenceError("syntax", "Invalid A1 reference");
    return {
      row: match[4] ? { index: positiveIndex(Number(match[4])), absolute: match[3] === "$" } : null,
      column: match[2] ? { index: columnToIndex(match[2]), absolute: match[1] === "$" } : null,
    };
  });
}

function format(ref: Reference, axis: (axis: Axis, dimension: "row" | "column") => string): string {
  validateReference(ref);
  const point = (end: "start" | "end") =>
    (ref.columns === null ? "" : axis(ref.columns[end], "column")) +
    (ref.rows === null ? "" : axis(ref.rows[end], "row"));
  const start = point("start");
  const end = point("end");
  return (
    prefix(ref) +
    start +
    (ref.rows !== null && ref.columns !== null && start === end ? "" : `:${end}`)
  );
}

export function formatA1(ref: Reference): string {
  return format(
    ref,
    (axis, dimension) =>
      `${axis.absolute ? "$" : ""}${dimension === "column" ? indexToColumn(axis.index) : axis.index}`,
  );
}

export function parseR1C1(text: string, origin: CellPosition): Reference {
  validatePosition(origin);
  return parse(text, (part) => {
    const match =
      /^(?:R(\[[+-]?[0-9]+\]|[1-9][0-9]*|))?(?:C(\[[+-]?[0-9]+\]|[1-9][0-9]*|))?$/i.exec(part);
    if (!match || match[0] !== part || (match[1] === undefined && match[2] === undefined)) {
      throw new SheetReferenceError("syntax", "Invalid R1C1 reference");
    }
    const axis = (token: string | undefined, base: number): Axis | null => {
      if (token === undefined) return null;
      const absolute = token !== "" && !token.startsWith("[");
      const value = absolute ? Number(token) : token === "" ? 0 : Number(token.slice(1, -1));
      if (!Number.isSafeInteger(value))
        throw new SheetReferenceError("bounds", "Unsafe R1C1 coordinate");
      return { index: positiveIndex(absolute ? value : base + value), absolute };
    };
    return { row: axis(match[1], origin.row), column: axis(match[2], origin.column) };
  });
}

export function formatR1C1(ref: Reference, origin: CellPosition): string {
  validatePosition(origin);
  // The shared formatter emits columns first; swap dimensions for R1C1's row-first order.
  return format({ ...ref, rows: ref.columns, columns: ref.rows }, (axis, dimension) => {
    const row = dimension === "column";
    const delta = axis.index - (row ? origin.row : origin.column);
    return `${row ? "R" : "C"}${axis.absolute ? axis.index : delta === 0 ? "" : `[${delta}]`}`;
  });
}
