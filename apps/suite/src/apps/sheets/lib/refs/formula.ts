// AUTHORED-BY Codex GPT-6.1-Sol
import { shiftReference, validateEdit } from "./edits";
import {
  type CellPosition,
  type Reference,
  SheetReferenceError,
  type StructuralEdit,
  sameSheet,
  validatePosition,
  validateSheet,
} from "./model";
import { formatA1, formatR1C1, parseA1, parseR1C1 } from "./notation";

export type FormulaContext = {
  readonly sheet: string;
} & ({ readonly notation?: "A1" } | { readonly notation: "R1C1"; readonly origin: CellPosition });

interface Token {
  kind: "value" | "function" | "operator" | "punctuation";
  text: string;
  start: number;
  ref?: Reference;
}
const sheetPattern = "(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?";
const a1Cell = "\\$?[A-Za-z]+\\$?[0-9]+";
const a1 = `${a1Cell}(?::${a1Cell})?|\\$?[A-Za-z]+:\\$?[A-Za-z]+|\\$?[0-9]+:\\$?[0-9]+`;
const rAxis = "R(?:\\[[+-]?[0-9]+\\]|[0-9]+)?";
const cAxis = "C(?:\\[[+-]?[0-9]+\\]|[0-9]+)?";
const rcCell = `${rAxis}${cAxis}`;
const rc = `${rcCell}(?::${rcCell})?|${rAxis}:${rAxis}|${cAxis}:${cAxis}`;
const referencePatterns = {
  A1: new RegExp(`^${sheetPattern}(?:${a1})(?![A-Za-z0-9_.])`, "i"),
  R1C1: new RegExp(`^${sheetPattern}(?:${rc})(?![A-Za-z0-9_.])`, "i"),
};

function fail(): never {
  throw new SheetReferenceError("unsupported", "Unsupported or malformed formula syntax");
}

function tokenize(formula: string, context: FormulaContext): Token[] {
  const tokens: Token[] = [];
  if (formula.length > 8192) fail();
  let start = 1;
  while (start < formula.length) {
    const rest = formula.slice(start);
    const space = /^\s+/.exec(rest);
    if (space) {
      start += space[0].length;
      continue;
    }
    const fn = /^[A-Za-z_][A-Za-z0-9_.]*(?=\s*\()/.exec(rest);
    const reference = referencePatterns[context.notation ?? "A1"].exec(rest);
    let token: Token;
    if (fn) {
      token = { kind: "function", text: fn[0], start };
    } else if (reference) {
      const text = reference[0];
      const ref = context.notation === "R1C1" ? parseR1C1(text, context.origin) : parseA1(text);
      token = { kind: "value", text, start, ref };
    } else {
      const value =
        /^(?:"(?:[^"]|"")*"|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?|TRUE\b|FALSE\b|#(?:REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|NULL!))/i.exec(
          rest,
        );
      const operator = /^(?:<>|<=|>=|[+\-*/^&=<>%])/.exec(rest);
      const punctuation = /^[(),]/.exec(rest);
      if (value) token = { kind: "value", text: value[0], start };
      else if (operator) token = { kind: "operator", text: operator[0], start };
      else if (punctuation) token = { kind: "punctuation", text: punctuation[0], start };
      else fail();
    }
    if (tokens.length >= 512) fail();
    tokens.push(token);
    start += token.text.length;
  }
  return tokens;
}

/** Checks expression structure, including adjacency (unsupported space-intersections). */
function validateFormula(tokens: readonly Token[]): void {
  let cursor = 0;
  const peek = () => tokens[cursor]?.text;
  const consume = (text: string) => {
    if (peek() !== text) fail();
    cursor++;
  };
  const expression = (): void => {
    while (peek() === "+" || peek() === "-") cursor++;
    const token = tokens[cursor++];
    if (!token) fail();
    if (token.kind === "function") {
      consume("(");
      if (peek() !== ")") {
        expression();
        while (peek() === ",") {
          cursor++;
          expression();
        }
      }
      consume(")");
    } else if (token.text === "(") {
      expression();
      consume(")");
    } else if (token.kind !== "value") fail();
    while (tokens[cursor]?.kind === "operator") {
      const operator = tokens[cursor++];
      if (operator?.text !== "%") {
        expression();
        return;
      }
    }
  };
  expression();
  if (cursor !== tokens.length) fail();
}

/** Rewrite only reference tokens; string literals and all other source text stay byte-for-byte. */
export function shiftFormula(
  formula: string,
  edit: StructuralEdit,
  context: FormulaContext,
): string {
  validateEdit(edit);
  validateSheet(context.sheet);
  if (!formula.startsWith("="))
    throw new SheetReferenceError("syntax", "A formula must start with =");
  if (context.notation !== undefined && context.notation !== "A1" && context.notation !== "R1C1")
    fail();
  let nextOrigin: CellPosition | undefined;
  if (context.notation === "R1C1") {
    validatePosition(context.origin);
    const origin = parseR1C1("RC", context.origin);
    const moved = shiftReference(origin, edit, context.sheet);
    if (moved === null)
      throw new SheetReferenceError("invalid-edit", "The formula's origin was deleted");
    // A cell reference always constrains both axes.
    nextOrigin = {
      row: (moved.rows as NonNullable<Reference["rows"]>).start.index,
      column: (moved.columns as NonNullable<Reference["columns"]>).start.index,
    };
  }
  const tokens = tokenize(formula, context);
  validateFormula(tokens);
  let output = "",
    end = 0;
  for (const token of tokens) {
    if (!token.ref) continue;
    const shifted = shiftReference(token.ref, edit, context.sheet);
    let replacement = token.text;
    const targetChanged = shifted === null || JSON.stringify(shifted) !== JSON.stringify(token.ref);
    const originChanged = context.notation === "R1C1" && sameSheet(context.sheet, edit.sheet);
    if (targetChanged || originChanged) {
      replacement =
        shifted === null
          ? "#REF!"
          : context.notation === "R1C1"
            ? formatR1C1(shifted, nextOrigin as CellPosition)
            : formatA1(shifted);
    }
    output += formula.slice(end, token.start) + replacement;
    end = token.start + token.text.length;
  }
  return output + formula.slice(end);
}
