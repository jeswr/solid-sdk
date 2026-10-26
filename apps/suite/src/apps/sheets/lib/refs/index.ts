// AUTHORED-BY Codex GPT-6.1-Sol
export { shiftReference } from "./edits";
export { type FormulaContext, shiftFormula } from "./formula";
export {
  type Axis,
  type AxisRange,
  type CellPosition,
  type Reference,
  SheetReferenceError,
  type SheetReferenceErrorCode,
  type StructuralEdit,
} from "./model";
export { columnToIndex, formatA1, formatR1C1, indexToColumn, parseA1, parseR1C1 } from "./notation";
export { intersectRanges, unionRanges } from "./ranges";
