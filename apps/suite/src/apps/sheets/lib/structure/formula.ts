// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Uses the same deliberately restricted formula dialect as ../refs/formula.ts.
import {
  type CellPosition,
  formatA1,
  formatR1C1,
  parseA1,
  parseR1C1,
  type Reference,
  SheetReferenceError,
} from "../refs";

export const MAX_FORMULA_LENGTH = 8_192;
export const MAX_FORMULA_TOKENS = 512;

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

export function checkFormulaLength(formula: string): void {
  if (formula.length > MAX_FORMULA_LENGTH) fail();
}

function tokenize(formula: string, notation: "A1" | "R1C1", origin: CellPosition): Token[] {
  const tokens: Token[] = [];
  checkFormulaLength(formula);
  let start = 1;
  while (start < formula.length) {
    const rest = formula.slice(start);
    const space = /^\s+/.exec(rest);
    if (space) {
      start += space[0].length;
      continue;
    }
    const fn = /^[A-Za-z_][A-Za-z0-9_.]*(?=\s*\()/.exec(rest);
    const reference = referencePatterns[notation].exec(rest);
    let token: Token;
    if (fn) {
      // A1 (B1) is a reference intersection, not a function invocation.
      // These built-ins are the reference-shaped names in the supported dialect.
      if (reference?.[0] === fn[0] && !/^(?:LOG10|ATAN2|DAYS360)$/i.test(fn[0])) fail();
      token = { kind: "function", text: fn[0], start };
    } else if (reference) {
      const text = reference[0];
      const ref = notation === "R1C1" ? parseR1C1(text, origin) : parseA1(text);
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
    if (tokens.length >= MAX_FORMULA_TOKENS) fail();
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

/** Preserve source text outside changed references, including escaped string literals. */
export function rewriteFormula(
  formula: string,
  notation: "A1" | "R1C1",
  origin: CellPosition,
  nextOrigin: CellPosition,
  transform: (ref: Reference) => Reference | null,
): string {
  if (!formula.startsWith("="))
    throw new SheetReferenceError("syntax", "A formula must start with =");
  const tokens = tokenize(formula, notation, origin);
  validateFormula(tokens);
  let output = "",
    end = 0;
  for (const token of tokens) {
    if (!token.ref) continue;
    const next = transform(token.ref);
    const changed = JSON.stringify(next) !== JSON.stringify(token.ref);
    const rebased =
      notation === "R1C1" && (origin.row !== nextOrigin.row || origin.column !== nextOrigin.column);
    const replacement =
      !changed && !rebased
        ? token.text
        : next === null
          ? "#REF!"
          : notation === "A1"
            ? formatA1(next)
            : formatR1C1(next, nextOrigin);
    output += formula.slice(end, token.start) + replacement;
    end = token.start + token.text.length;
  }
  output += formula.slice(end);
  checkFormulaLength(output);
  return output;
}
