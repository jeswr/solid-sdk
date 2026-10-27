// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { CellIsRule, CellRange, CellStyle, CellValue, ConditionalFormatRule } from "./model";
import { colourScale } from "./scale";
import { checkLimits, compare, validateCell, validateRule } from "./validation";

type Key = number | string | boolean;
type Matcher = (value: CellValue) => CellStyle | undefined;

function duplicateKey(value: CellValue): Key | undefined {
  if (value === null || value === "" || typeof value === "object") return undefined;
  return typeof value === "string" ? value.toLowerCase() : value;
}

function comparison(rule: CellIsRule, value: CellValue): boolean {
  if ("min" in rule) {
    const low = compare(value, rule.min);
    if (low === undefined) return false;
    // Validation guarantees that the two operands have the same type.
    const high = compare(value, rule.max) as number;
    const between = low >= 0 && high <= 0;
    return rule.operator === "between" ? between : !between;
  }
  const order = compare(value, rule.value);
  if (order === undefined) return false;
  switch (rule.operator) {
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
    case "=":
      return order === 0;
    case "<>":
      return order !== 0;
  }
}

function matcher(
  rule: ConditionalFormatRule,
  numbers: readonly number[],
  counts: ReadonlyMap<Key, number>,
  average: number,
): Matcher {
  let matches: (value: CellValue) => boolean;
  switch (rule.kind) {
    case "cellIs":
      matches = (value) => comparison(rule, value);
      break;
    case "textContains":
    case "beginsWith":
    case "endsWith": {
      const text = rule.text.toLowerCase();
      const method = {
        textContains: "includes",
        beginsWith: "startsWith",
        endsWith: "endsWith",
      } as const;
      matches = (value) =>
        typeof value === "string" && value.toLowerCase()[method[rule.kind]](text);
      break;
    }
    case "blank":
    case "notBlank":
      matches = (value) => (value === null || value === "") === (rule.kind === "blank");
      break;
    case "error":
    case "noError":
      matches = (value) =>
        (value !== null && typeof value === "object") === (rule.kind === "error");
      break;
    case "duplicate":
    case "unique":
      matches = (value) => {
        const key = duplicateKey(value);
        if (key === undefined) return false;
        return rule.kind === "duplicate" ? (counts.get(key) as number) > 1 : counts.get(key) === 1;
      };
      break;
    case "top":
    case "bottom": {
      if (numbers.length === 0) return () => undefined;
      const count = rule.percent
        ? Math.max(1, Math.ceil((numbers.length * rule.count) / 100))
        : rule.count;
      const index =
        rule.kind === "top"
          ? Math.max(0, numbers.length - count)
          : Math.min(count, numbers.length) - 1;
      const threshold = numbers[index] as number;
      matches = (value) =>
        typeof value === "number" &&
        (rule.kind === "top" ? value >= threshold : value <= threshold);
      break;
    }
    case "aboveAverage":
    case "belowAverage":
      matches = (value) =>
        typeof value === "number" &&
        (rule.kind === "aboveAverage" ? value > average : value < average);
      break;
    case "colorScale": {
      if (numbers.length === 0) return () => undefined;
      const fill = colourScale(rule.anchors, numbers);
      return (value) => (typeof value === "number" ? { fill: fill(value) } : undefined);
    }
  }
  return (value) => (matches(value) ? rule.style : undefined);
}

function compensatedSum(numbers: readonly number[], divisor: number): number {
  let sum = 0;
  let correction = 0;
  for (const value of numbers) {
    const scaled = value / divisor;
    const next = sum + scaled;
    correction += Math.abs(sum) >= Math.abs(scaled) ? sum - next + scaled : scaled - next + sum;
    sum = next;
  }
  return sum + correction;
}

/** Apply every rule to this entire rectangular range, without mutating either input. */
export function evaluateConditionalFormats(
  values: CellRange,
  rules: readonly ConditionalFormatRule[],
): CellStyle[][] {
  checkLimits(values, rules);
  const validated = Array.from(rules, validateRule);
  const needsNumbers = validated.some((rule) =>
    ["top", "bottom", "aboveAverage", "belowAverage", "colorScale"].includes(rule.kind),
  );
  const needsCounts = validated.some((rule) => rule.kind === "duplicate" || rule.kind === "unique");
  const numbers: number[] = [];
  const counts = new Map<Key, number>();
  let scale = 0;
  for (const row of values) {
    for (const value of row) {
      validateCell(value);
      if (needsNumbers && typeof value === "number") {
        numbers.push(value);
        scale = Math.max(scale, Math.abs(value));
      }
      if (needsCounts) {
        const key = duplicateKey(value);
        if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  numbers.sort((a, b) => a - b);
  // Keep ordinary sums exact where possible; normalize only after overflow.
  const sum = compensatedSum(numbers, 1);
  const average =
    numbers.length === 0
      ? 0
      : Number.isFinite(sum)
        ? sum / numbers.length
        : (compensatedSum(numbers, scale) / numbers.length) * scale;
  const matchers = validated.map((rule) => matcher(rule, numbers, counts, average));
  return values.map((row) =>
    row.map((value) => {
      const result: Record<string, string | boolean> = {};
      for (let index = 0; index < matchers.length; index++) {
        const style = (matchers[index] as Matcher)(value);
        if (style === undefined) continue;
        for (const [key, property] of Object.entries(style)) {
          if (!Object.hasOwn(result, key)) result[key] = property;
        }
        if ((validated[index] as ConditionalFormatRule).stopIfTrue) break;
      }
      return result;
    }),
  );
}
