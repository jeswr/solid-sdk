// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseDate } from "./dates";
import { type CellValue, parseFormatCode, SheetFormatError, validateLocale } from "./model";

function invalid(message: string): never {
  throw new SheetFormatError("invalid-input", message);
}

/** ASCII or locale digits are accepted, but mixing the two is ambiguous. */
function normalizeDigits(text: string, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, { useGrouping: false });
  const digits = Array.from({ length: 10 }, (_, i) => formatter.format(i));
  const native = digits[0] !== "0" && digits.some((digit) => text.includes(digit));
  if (native && /[0-9]/.test(text)) invalid("Mixed digit systems are unsupported");
  return Array.from(text, (char) => {
    const index = digits.indexOf(char);
    return index < 0 ? char : String(index);
  }).join("");
}

function unwrap(
  text: string,
  formatter: Intl.NumberFormat,
): { body: string; negative: boolean } | null {
  // Include explicit positive signs without guessing locale sign/bidi placement.
  const positive = new Intl.NumberFormat(formatter.resolvedOptions().locale, {
    ...formatter.resolvedOptions(),
    signDisplay: "always",
  });
  for (const [value, template] of [
    [-1, formatter],
    [1, positive],
    [1, formatter],
  ] as const) {
    const parts = template.formatToParts(value);
    const first = parts.findIndex((part) => part.type === "integer");
    const last = parts.findLastIndex((part) => part.type === "integer" || part.type === "fraction");
    const prefix = parts
      .slice(0, first)
      .map((part) => part.value)
      .join("");
    const suffix = parts
      .slice(last + 1)
      .map((part) => part.value)
      .join("");
    if (text.startsWith(prefix) && text.endsWith(suffix)) {
      return { body: text.slice(prefix.length, text.length - suffix.length), negative: value < 0 };
    }
  }
  return null;
}

function decimalString(integer: string, fraction: string): string {
  const tail = fraction.replace(/0+$/, "");
  return `${BigInt(integer)}${tail ? `.${tail}` : ""}`;
}

function parseNumber(text: string, locale: string, options: Intl.NumberFormatOptions): number {
  const formatter = new Intl.NumberFormat(locale, options);
  const unwrapped = unwrap(text, formatter);
  if (!unwrapped) invalid("Input does not match the locale's signs or format affixes");
  const decimalParts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(12345.6);
  const decimal = decimalParts
    .filter((part) => part.type === "decimal")
    .map((part) => part.value)
    .join("");
  const group = decimalParts
    .filter((part) => part.type === "group")
    .map((part) => part.value)
    .join("");
  const normalized = normalizeDigits(unwrapped.body, locale);
  const pieces = normalized.split(decimal);
  if (pieces.length > 2) invalid("Repeated decimal separator");
  const integer = String(pieces[0]);
  const fraction = pieces[1] ?? "";
  if (pieces.length === 2 && !/^\d+$/.test(fraction)) invalid("Invalid decimal fraction");
  const ungrouped = group ? integer.split(group).join("") : integer;
  if (!/^(0|[1-9]\d*)$/.test(ungrouped) && !(ungrouped === "" && fraction !== "")) {
    invalid("Unsupported numeric syntax");
  }
  const whole = ungrouped || "0";
  if (group && integer.includes(group)) {
    const grouped = new Intl.NumberFormat(locale, { useGrouping: true })
      .formatToParts(BigInt(whole))
      .filter((part) => part.type === "integer" || part.type === "group")
      .map((part) => part.value)
      .join("");
    if (normalizeDigits(grouped, locale) !== integer) invalid("Invalid digit grouping");
  }
  const scale = fraction.length + (options.style === "percent" ? 2 : 0);
  const digits = `${whole}${fraction}`.padStart(scale + 1, "0");
  const canonical = decimalString(
    digits.slice(0, digits.length - scale),
    digits.slice(digits.length - scale),
  );
  const value = Number(canonical);
  const actual = new Intl.NumberFormat("en-US", {
    useGrouping: false,
    maximumSignificantDigits: 21,
  }).format(value);
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER || actual !== canonical) {
    invalid("Number is outside the supported precision or range");
  }
  return unwrapped.negative ? -value : value;
}

/** Parse full inputs only. A leading apostrophe preserves literal text without inference. */
export function parseCellInput(input: string, locale: string, code = "General"): CellValue {
  const format = parseFormatCode(code);
  const language = validateLocale(locale);
  if (input.length > 1000) invalid("Cell input exceeds 1000 UTF-16 code units");
  if (input.startsWith("'")) return { type: "text", value: input.slice(1) };
  const text = input.trim();
  if (text === "") return { type: "text", value: input };
  if (/^(true|false)$/i.test(text))
    return { type: "boolean", value: text.toLowerCase() === "true" };
  const normalized = normalizeDigits(text, language);
  const date = parseDate(normalized, language, format.kind === "date");
  if (date !== null) return { type: "date", value: date };
  if (format.kind === "date") invalid("Input does not match a supported date or time");
  // Markers in labels do not imply numbers. Prefix affixes must lead into numeric syntax.
  const numericStart = /^[\p{N}+\-−.,\u061c\u200e\u200f]/u;
  const numericCandidate =
    numericStart.test(normalized) ||
    /^(?:[%٪\p{Sc}]\s*[\p{N}+\-−.,\u061c\u200e\u200f]|[A-Z]{3}\s*\d)/u.test(normalized) ||
    /^(?:NaN|[+-]?Infinity|∞)$/.test(text);
  if (!numericCandidate) return { type: "text", value: input };
  if (format.kind === "number" && format.options.style === "currency") {
    return { type: "number", value: parseNumber(text, language, format.options) };
  }
  // Percent syntax must match the locale, including its spacing and sign placement.
  if (/[%٪]/.test(text)) {
    return { type: "percent", value: parseNumber(text, language, { style: "percent" }) };
  }
  if (numericStart.test(normalized)) {
    return { type: "number", value: parseNumber(text, language, { style: "decimal" }) };
  }
  invalid("Unsupported numeric or currency input");
}
