// AUTHORED-BY Codex GPT-6.1-Sol
import type { CellPosition, StructuralEdit } from "../refs";

export type CellData =
  | {
      readonly value: string | number | boolean | null;
      readonly formula?: never;
      readonly notation?: never;
    }
  | { readonly formula: string; readonly notation?: "A1" | "R1C1"; readonly value?: never };
export type StructureCell = CellPosition & CellData;
export interface StructureSheet {
  readonly name: string;
  /** Omitted addresses are blank. Explicit null values remain explicit cells. */
  readonly cells: readonly StructureCell[];
}
export interface MoveRange {
  readonly kind: "move";
  readonly source: {
    readonly sheet: string;
    readonly start: CellPosition;
    readonly end: CellPosition;
  };
  /** Top-left destination; the source rectangle determines its size. */
  readonly destination: CellPosition & { readonly sheet: string };
}
export type StructureEdit = StructuralEdit | MoveRange;
export interface CellChange extends CellPosition {
  readonly sheet: string;
  readonly before: CellData | null;
  readonly after: CellData | null;
}
export interface StructurePlan {
  readonly sheets: readonly StructureSheet[];
  /** Every changed address, in input sheet order then ascending row and column. */
  readonly changes: readonly CellChange[];
}
