// AUTHORED-BY Codex GPT-6.1-Sol

export const MAX_RULES = 100;
export const MAX_RANGE_CELLS = 1_000_000;

export type ConditionalFormatErrorCode = "INVALID_RULE" | "INVALID_RANGE" | "RANGE_TOO_LARGE";

export class ConditionalFormatError extends Error {
  constructor(
    readonly code: ConditionalFormatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConditionalFormatError";
  }
}

export type CellValue = number | string | boolean | null | { readonly error: string };
export type CellRange = readonly (readonly CellValue[])[];

/** Each property is independent: even false and an empty numberFormat claim precedence. */
export interface CellStyle {
  readonly fill?: string;
  readonly fontColor?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  readonly numberFormat?: string;
}

interface StyledRule {
  readonly style: CellStyle;
  readonly stopIfTrue?: boolean;
}

export type CellIsRule = StyledRule &
  (
    | {
        readonly kind: "cellIs";
        readonly operator: ">" | ">=" | "<" | "<=" | "=" | "<>";
        readonly value: number | string;
      }
    | {
        readonly kind: "cellIs";
        readonly operator: "between" | "notBetween";
        readonly min: number | string;
        readonly max: number | string;
      }
  );

export type ColourAnchor =
  | { readonly kind: "min" | "max"; readonly color: string }
  | {
      readonly kind: "number" | "percent" | "percentile";
      readonly value: number;
      readonly color: string;
    };

export type ConditionalFormatRule =
  | CellIsRule
  | (StyledRule & {
      readonly kind: "textContains" | "beginsWith" | "endsWith";
      readonly text: string;
    })
  | (StyledRule & {
      readonly kind:
        | "blank"
        | "notBlank"
        | "error"
        | "noError"
        | "duplicate"
        | "unique"
        | "aboveAverage"
        | "belowAverage";
    })
  | (StyledRule & {
      readonly kind: "top" | "bottom";
      readonly count: number;
      readonly percent?: boolean;
    })
  | {
      readonly kind: "colorScale";
      readonly anchors:
        | readonly [ColourAnchor, ColourAnchor]
        | readonly [ColourAnchor, ColourAnchor, ColourAnchor];
      readonly stopIfTrue?: boolean;
    };
