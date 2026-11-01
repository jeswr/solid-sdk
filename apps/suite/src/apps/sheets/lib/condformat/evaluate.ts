// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { CellIsRule, CellRange, CellStyle, CellValue, ConditionalFormatRule } from "./model";
import { colourScale } from "./scale";
import { arrayItem, checkLimits, compare, validateCell, validateRule } from "./validation";

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

function percentageCount(population: number, percent: number): number {
  // Preserve the decimal percentage through the ceiling, including scientific notation.
  const [coefficient, exponent = "0"] = percent.toString().split("e");
  const [whole, fraction = ""] = (coefficient as string).split(".");
  const numerator = BigInt(`${whole}${fraction}`) * BigInt(population);
  // Validated percentages are in (0, 100], so this exponent is nonnegative.
  const denominator = BigInt(100) * BigInt(10) ** BigInt(fraction.length - Number(exponent));
  return Number((numerator + denominator - BigInt(1)) / denominator);
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
      const count = rule.percent ? percentageCount(numbers.length, rule.count) : rule.count;
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

function exactAverage(numbers: readonly number[]): number {
  const view = new DataView(new ArrayBuffer(8));
  const zero = BigInt(0);
  const one = BigInt(1);
  let sum = zero;
  // Every finite double is an integer multiple of 2^-1074. Accumulate those units
  // exactly so overflow and cancellation cannot erase a small residual.
  for (const value of numbers) {
    view.setFloat64(0, value);
    const bits = view.getBigUint64(0);
    const exponent = Number((bits >> BigInt(52)) & BigInt(0x7ff));
    const fraction = bits & BigInt("0xfffffffffffff");
    const significand = exponent === 0 ? fraction : fraction + BigInt("0x10000000000000");
    const units = significand << BigInt(Math.max(0, exponent - 1));
    sum += value < 0 ? -units : units;
  }
  const magnitude = sum < zero ? -sum : sum;
  const population = BigInt(numbers.length);
  // Keep 53 significant bits, or single subnormal units, and round ties to even.
  const shift = Math.max(0, (magnitude / population).toString(2).length - 53);
  const denominator = population << BigInt(shift);
  let rounded = magnitude / denominator;
  const remainder = (magnitude % denominator) * BigInt(2);
  if (remainder > denominator || (remainder === denominator && rounded % BigInt(2) !== zero)) {
    rounded += one;
  }
  return (sum < zero ? -1 : 1) * Number(rounded) * 2 ** (shift - 1074);
}

/** Apply every rule to this entire rectangular range, without mutating either input. */
export function evaluateConditionalFormats(
  values: CellRange,
  rules: readonly ConditionalFormatRule[],
): CellStyle[][] {
  checkLimits(values, rules);
  const validated = Array.from({ length: rules.length }, (_, index) =>
    validateRule(arrayItem(rules, index)),
  );
  const needsNumbers = validated.some((rule) =>
    ["top", "bottom", "aboveAverage", "belowAverage", "colorScale"].includes(rule.kind),
  );
  const needsCounts = validated.some((rule) => rule.kind === "duplicate" || rule.kind === "unique");
  const numbers: number[] = [];
  const counts = new Map<Key, number>();
  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    const row = arrayItem(values, rowIndex, "INVALID_RANGE");
    for (let column = 0; column < row.length; column++) {
      const value = arrayItem(row, column, "INVALID_RANGE");
      validateCell(value);
      if (needsNumbers && typeof value === "number") {
        numbers.push(value);
      }
      if (needsCounts) {
        const key = duplicateKey(value);
        if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  numbers.sort((a, b) => a - b);
  const average = numbers.length === 0 ? 0 : exactAverage(numbers);
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
