// AUTHORED-BY Codex GPT-6.1-Sol
import type { DateFormat } from "./types";

/** Accept ISO or four-digit-year slash/dash/dot dates; never use host Date.parse. */
export function parseDate(value: string, format: DateFormat): string {
  const parts = value.trim().match(/^(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4})$/);
  if (!parts) throw new Error("Invalid statement date");
  const first = Number(parts[1]);
  const middle = Number(parts[3]);
  const last = Number(parts[4]);
  const year = format === "YYYY-MM-DD" ? first : last;
  const month = format === "MM/DD/YYYY" ? first : middle;
  const day = format === "YYYY-MM-DD" ? last : format === "DD/MM/YYYY" ? first : middle;
  const yearText = (format === "YYYY-MM-DD" ? parts[1] : parts[4]) as string;
  const dayOrMonthText = (format === "YYYY-MM-DD" ? parts[4] : parts[1]) as string;
  if (
    yearText.length !== 4 ||
    dayOrMonthText.length > 2 ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error("Invalid statement date");
  }
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) {
    throw new Error("Invalid statement date");
  }
  return iso;
}

/** Return null for ambiguous, mixed, empty or invalid dates. */
export function sniffDateFormat(values: readonly string[]): DateFormat | null {
  if (values.length === 0) return null;
  const formats: DateFormat[] = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];
  const matches = formats.filter((format) =>
    values.every((value) => {
      try {
        parseDate(value, format);
        return true;
      } catch {
        return false;
      }
    }),
  );
  return matches.length === 1 ? (matches[0] as DateFormat) : null;
}

/** Strict decimal parser, with validated thousands grouping and accounting negatives. */
export function parseAmount(value: string, decimalSeparator: "." | "," = "."): string {
  let text = value.trim();
  const accounting = text.startsWith("(") && text.endsWith(")");
  if (accounting) text = `-${text.slice(1, -1)}`;
  if (decimalSeparator === ",")
    text = text.replace(/[.,]/g, (separator) => (separator === "." ? "," : "."));
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) {
    throw new Error("Invalid statement amount");
  }
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^[+-]/, "").replaceAll(",", "").split(".");
  const integer = (whole as string).replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  const result = decimals ? `${integer}.${decimals}` : integer;
  return negative && result !== "0" ? `-${result}` : result;
}

/** Compare canonical decimals without conversion to binary floating point. */
export function compareAmounts(left: string, right: string): number {
  const a = parseAmount(left);
  const b = parseAmount(right);
  if (a === b) return 0;
  const negative = a.startsWith("-");
  if (negative !== b.startsWith("-")) return negative ? -1 : 1;
  const [ai, af = ""] = a.replace("-", "").split(".") as [string, string?];
  const [bi, bf = ""] = b.replace("-", "").split(".") as [string, string?];
  const width = Math.max(af.length, bf.length);
  const av = ai + af.padEnd(width, "0");
  const bv = bi + bf.padEnd(width, "0");
  const order = ai.length === bi.length ? (av < bv ? -1 : 1) : ai.length < bi.length ? -1 : 1;
  return negative ? -order : order;
}
