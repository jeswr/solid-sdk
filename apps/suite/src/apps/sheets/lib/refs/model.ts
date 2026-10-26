// AUTHORED-BY Codex GPT-6.1-Sol

export type SheetReferenceErrorCode = "syntax" | "bounds" | "unsupported" | "invalid-edit";

export class SheetReferenceError extends Error {
  constructor(
    readonly code: SheetReferenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SheetReferenceError";
  }
}

/** One-based resolved coordinate. Absolute affects copying, never structural edits. */
export interface Axis {
  readonly index: number;
  readonly absolute: boolean;
}
export interface AxisRange {
  readonly start: Axis;
  readonly end: Axis;
}
/** null means the entire axis, e.g. rows=null represents A:C. */
export interface Reference {
  readonly sheet?: string;
  readonly rows: AxisRange | null;
  readonly columns: AxisRange | null;
}
export interface CellPosition {
  readonly row: number;
  readonly column: number;
}
export interface StructuralEdit {
  readonly sheet: string;
  readonly axis: "row" | "column";
  readonly kind: "insert" | "delete";
  readonly index: number;
  readonly count: number;
}

export function positiveIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SheetReferenceError("bounds", "Coordinates must be positive safe integers");
  }
  return value;
}

export function validateSheet(sheet: string): void {
  if (!sheet || /[\p{Cc}[\]:*?/\\]/u.test(sheet)) {
    throw new SheetReferenceError("unsupported", "Invalid or unsupported sheet name");
  }
}

export function validateReference(ref: Reference): void {
  if (ref.sheet !== undefined) validateSheet(ref.sheet);
  if (ref.rows === null && ref.columns === null) {
    throw new SheetReferenceError("unsupported", "A reference must constrain at least one axis");
  }
  for (const axis of [ref.rows, ref.columns]) {
    if (axis === null) continue;
    for (const endpoint of [axis.start, axis.end]) {
      positiveIndex(endpoint.index);
      if (typeof endpoint.absolute !== "boolean") {
        throw new SheetReferenceError("syntax", "Absolute flags must be boolean");
      }
    }
    if (axis.start.index > axis.end.index) {
      throw new SheetReferenceError("unsupported", "Reversed ranges are unsupported");
    }
  }
}

export function validatePosition(origin: CellPosition): void {
  positiveIndex(origin.row);
  positiveIndex(origin.column);
}

export function sameSheet(a: string | undefined, b: string | undefined): boolean {
  return a?.toLowerCase() === b?.toLowerCase();
}
