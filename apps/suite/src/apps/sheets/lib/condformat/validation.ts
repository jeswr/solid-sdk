// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type CellRange,
  type CellStyle,
  type CellValue,
  type ColourAnchor,
  ConditionalFormatError,
  type ConditionalFormatErrorCode,
  type ConditionalFormatRule,
  MAX_RANGE_CELLS,
  MAX_RULES,
} from "./model";

export function invalidRule(): never {
  throw new ConditionalFormatError("INVALID_RULE", "Invalid conditional formatting rule");
}

function invalidRange(): never {
  throw new ConditionalFormatError(
    "INVALID_RANGE",
    "Expected a rectangular range of computed values",
  );
}

export function arrayItem<T>(
  values: readonly T[],
  index: number,
  code: ConditionalFormatErrorCode = "INVALID_RULE",
): T {
  const descriptor = Object.getOwnPropertyDescriptor(values, index);
  if (!descriptor || !("value" in descriptor)) {
    throw new ConditionalFormatError(code, "Expected an array data element");
  }
  return descriptor.value as T;
}

/** Check both limits before traversing rules, rows, values, or allocating result storage. */
export function checkLimits(values: CellRange, rules: readonly ConditionalFormatRule[]): void {
  if (!Array.isArray(rules) || rules.length > MAX_RULES) invalidRule();
  if (!Array.isArray(values)) invalidRange();
  if (values.length > MAX_RANGE_CELLS) tooLarge();
  if (values.length === 0) return;
  const first = arrayItem(values, 0, "INVALID_RANGE");
  if (!Array.isArray(first)) invalidRange();
  if (values.length * first.length > MAX_RANGE_CELLS) tooLarge();
  if (first.length === 0) invalidRange();
  // Only row metadata is visited before the cell count and rectangular shape are known.
  for (let index = 0; index < values.length; index++) {
    const row = arrayItem(values, index, "INVALID_RANGE");
    if (!Array.isArray(row)) invalidRange();
    if (row.length > MAX_RANGE_CELLS) tooLarge();
    if (row.length !== first.length) invalidRange();
  }
}

function tooLarge(): never {
  throw new ConditionalFormatError(
    "RANGE_TOO_LARGE",
    "Conditional formatting range exceeds the limit",
  );
}

function shape(
  value: unknown,
  allowed: readonly string[],
  code: ConditionalFormatErrorCode = "INVALID_RULE",
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConditionalFormatError(code, "Expected a plain data object");
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ConditionalFormatError(code, "Expected a plain data object");
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !allowed.includes(key) ||
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new ConditionalFormatError(code, "Unsupported data property");
    }
  }
  return value as Record<string, unknown>;
}

export function validateCell(value: CellValue): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidRange();
    return;
  }
  const error = shape(value, ["error"], "INVALID_RANGE");
  if (typeof error.error !== "string") invalidRange();
}

export function colour(value: unknown): string {
  if (typeof value !== "string" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) invalidRule();
  const digits = value.slice(1).toUpperCase();
  return `#${digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits}`;
}

function style(value: unknown): CellStyle {
  const record = shape(value, [
    "fill",
    "fontColor",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "numberFormat",
  ]);
  const result: Record<string, string | boolean> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === "fill" || key === "fontColor") result[key] = colour(item);
    else if (key === "numberFormat") {
      if (typeof item !== "string") invalidRule();
      result[key] = item;
    } else {
      if (typeof item !== "boolean") invalidRule();
      result[key] = item;
    }
  }
  return result;
}

/** Undefined means incomparable; neither inequality nor notBetween may invert that into a match. */
export function compare(left: CellValue, right: number | string): number | undefined {
  if (typeof left !== typeof right || (typeof left !== "number" && typeof left !== "string")) {
    return undefined;
  }
  const a = typeof left === "string" ? left.toLowerCase() : left;
  const b = typeof right === "string" ? right.toLowerCase() : right;
  return a === b ? 0 : a < b ? -1 : 1;
}

function operand(value: unknown): value is number | string {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function anchor(value: unknown): ColourAnchor {
  const record = shape(value, ["kind", "value", "color"]);
  const color = colour(record.color);
  if (record.kind === "min" || record.kind === "max") {
    if ("value" in record) invalidRule();
    return { kind: record.kind, color };
  }
  if (record.kind !== "number" && record.kind !== "percent" && record.kind !== "percentile") {
    invalidRule();
  }
  if (typeof record.value !== "number" || !Number.isFinite(record.value)) invalidRule();
  if (record.kind !== "number" && (record.value < 0 || record.value > 100)) invalidRule();
  return { kind: record.kind, value: record.value, color };
}

export function validateRule(value: ConditionalFormatRule): ConditionalFormatRule {
  // Whitelist fields per variant, so misspellings or ignored options cannot change semantics silently.
  const initial = shape(value, [
    "kind",
    "operator",
    "value",
    "min",
    "max",
    "text",
    "style",
    "count",
    "percent",
    "anchors",
    "stopIfTrue",
  ]);
  if ("stopIfTrue" in initial && typeof initial.stopIfTrue !== "boolean") invalidRule();
  const common = ["kind", "style", "stopIfTrue"];
  let allowed: string[];
  switch (initial.kind) {
    case "cellIs": {
      if (initial.operator === "between" || initial.operator === "notBetween") {
        allowed = [...common, "operator", "min", "max"];
        if (!operand(initial.min) || !operand(initial.max)) invalidRule();
        const order = compare(initial.min, initial.max);
        if (order === undefined || order > 0) invalidRule();
      } else {
        allowed = [...common, "operator", "value"];
        if (
          ![">", ">=", "<", "<=", "=", "<>"].includes(initial.operator as string) ||
          !operand(initial.value)
        )
          invalidRule();
      }
      break;
    }
    case "textContains":
    case "beginsWith":
    case "endsWith":
      allowed = [...common, "text"];
      if (typeof initial.text !== "string") invalidRule();
      break;
    case "top":
    case "bottom":
      allowed = [...common, "count", "percent"];
      if ("percent" in initial && typeof initial.percent !== "boolean") invalidRule();
      if (
        typeof initial.count !== "number" ||
        !Number.isFinite(initial.count) ||
        initial.count <= 0
      )
        invalidRule();
      if (initial.percent === true ? initial.count > 100 : !Number.isSafeInteger(initial.count))
        invalidRule();
      break;
    case "colorScale": {
      shape(value, ["kind", "anchors", "stopIfTrue"]);
      if (
        !Array.isArray(initial.anchors) ||
        (initial.anchors.length !== 2 && initial.anchors.length !== 3)
      )
        invalidRule();
      const source = initial.anchors;
      const anchors = Array.from({ length: source.length }, (_, index) =>
        anchor(arrayItem(source, index)),
      ) as [ColourAnchor, ColourAnchor] | [ColourAnchor, ColourAnchor, ColourAnchor];
      // Numeric anchor order is invalid independently of whether the range contains numbers.
      for (let index = 1; index < anchors.length; index++) {
        const before = anchors[index - 1] as ColourAnchor;
        const after = anchors[index] as ColourAnchor;
        if (before.kind === "number" && after.kind === "number" && before.value > after.value)
          invalidRule();
      }
      return { ...value, anchors } as ConditionalFormatRule;
    }
    case "blank":
    case "notBlank":
    case "error":
    case "noError":
    case "duplicate":
    case "unique":
    case "aboveAverage":
    case "belowAverage":
      allowed = common;
      break;
    default:
      return invalidRule();
  }
  shape(value, allowed);
  return { ...value, style: style(initial.style) } as ConditionalFormatRule;
}
