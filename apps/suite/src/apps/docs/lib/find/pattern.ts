// AUTHORED-BY Codex GPT-6.1-Sol
import { FindError } from "./types";

export const FIND_LIMITS = { query: 512, steps: 1_000_000, maxSteps: 10_000_000 } as const;

export interface Budget {
  remaining: number;
}
export function spend(budget: Budget): void {
  if (--budget.remaining < 0) {
    throw new FindError("step-budget-exceeded", "Find step budget exhausted");
  }
}

interface Atom {
  test: RegExp;
  min: number;
  max: number;
}
export interface Pattern {
  atoms: Atom[];
  start: boolean;
  end: boolean;
}

function unsupported(): never {
  throw new FindError("unsupported-regex", "Unsupported or invalid regular expression");
}

/** Only compile single-character atoms with native RegExp; repetition runs in our budgeted VM. */
export function compile(query: string, regex: boolean, caseSensitive: boolean): Pattern {
  const chars = Array.from(query);
  const atoms: Atom[] = [];
  let index = 0;
  let start = false;
  let end = false;
  function readEscape(): string {
    const char = chars[index++];
    if (char === undefined) unsupported();
    if ("dDwWsS".includes(char)) return `\\${char}`;
    if (!"\\^$.*+?()[]{}|/-".includes(char)) unsupported();
    return char === "-" ? "\\x2d" : char === "/" ? "/" : `\\${char}`;
  }
  while (index < chars.length) {
    const char = chars[index++] as string;
    if (regex && char === "^" && index === 1) {
      start = true;
      continue;
    }
    if (regex && char === "$" && index === chars.length) {
      end = true;
      continue;
    }
    let source: string;
    if (!regex) source = `\\u{${(char.codePointAt(0) as number).toString(16)}}`;
    else if (char === "\\") source = readEscape();
    else if (char === "[") {
      source = "[";
      if (chars[index] === "^") {
        source += "^";
        index++;
      }
      const first = index;
      while (index < chars.length && chars[index] !== "]") {
        const part = chars[index++] as string;
        if (part === "[") unsupported();
        source += part === "\\" ? readEscape() : part;
      }
      if (index === first || chars[index++] !== "]") unsupported();
      source += "]";
    } else {
      if ("^$*+?(){}|]".includes(char)) unsupported();
      source = char;
    }
    let test: RegExp;
    try {
      test = new RegExp(`^(?:${source})$`, caseSensitive ? "u" : "iu");
    } catch {
      unsupported();
    }
    let min = 1;
    let max = 1;
    if (regex) {
      const quantifier = chars[index];
      if (quantifier === "*" || quantifier === "+" || quantifier === "?") {
        index++;
        min = quantifier === "+" ? 1 : 0;
        max = quantifier === "?" ? 1 : Infinity;
      } else if (quantifier === "{") {
        const rest = chars.slice(index).join("");
        const match = /^\{(\d+)(?:,(\d*))?\}/u.exec(rest);
        if (!match) unsupported();
        min = Number(match[1]);
        max = match[2] === undefined ? min : match[2] === "" ? Infinity : Number(match[2]);
        if (min > 10_000 || (max !== Infinity && max > 10_000) || max < min) unsupported();
        index += match[0].length;
      }
    }
    atoms.push({ test, min, max });
  }
  if (regex && atoms.every((atom) => atom.min === 0)) unsupported();
  return { atoms, start, end };
}

/** Greedy DFS with explicit frames: no unbounded recursion or native backtracking. */
export function matchAt(
  pattern: Pattern,
  chars: string[],
  start: number,
  budget: Budget,
): number | null {
  const frames: { position: number; next: number; minimum: number }[] = [];
  let atomIndex = 0;
  let position = start;
  while (true) {
    spend(budget);
    if (atomIndex === pattern.atoms.length) {
      if (!pattern.end || position === chars.length) return position;
    } else {
      const atom = pattern.atoms[atomIndex] as Atom;
      let count = 0;
      while (count < atom.max && position + count < chars.length) {
        spend(budget);
        if (!atom.test.test(chars[position + count] as string)) break;
        count++;
      }
      if (count >= atom.min) {
        frames.push({ position, next: count - 1, minimum: atom.min });
        position += count;
        atomIndex++;
        continue;
      }
    }
    while (
      frames.length > 0 &&
      (frames.at(-1) as { next: number; minimum: number }).next <
        (frames.at(-1) as { minimum: number }).minimum
    ) {
      spend(budget);
      frames.pop();
      atomIndex--;
    }
    const frame = frames.at(-1);
    if (!frame) return null;
    position = frame.position + frame.next--;
  }
}
