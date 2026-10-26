// AUTHORED-BY Codex GPT-6.1-Sol
import { displayDate } from "./dates";
import { type CellValue, parseFormatCode, SheetFormatError, validateLocale } from "./model";

/** Format codes are validated even for text and boolean cells. */
export function formatCellValue(cell: CellValue, code: string, locale: string): string {
  const format = parseFormatCode(code);
  const language = validateLocale(locale);
  if (cell.type === "text") return cell.value;
  if (cell.type === "boolean") return cell.value ? "TRUE" : "FALSE";
  if (cell.type === "date") {
    if (format.kind === "number") {
      throw new SheetFormatError("invalid-value", "Numeric formats cannot display dates");
    }
    return displayDate(
      cell.value,
      language,
      format.kind === "general" || format.date,
      format.kind === "general" || format.time,
    );
  }
  if (!Number.isFinite(cell.value) || format.kind === "date") {
    throw new SheetFormatError("invalid-value", "Expected a finite number and a numeric format");
  }
  const options: Intl.NumberFormatOptions =
    format.kind === "general"
      ? cell.type === "percent"
        ? { style: "percent", useGrouping: false, maximumSignificantDigits: 21 }
        : { useGrouping: false, maximumSignificantDigits: 21 }
      : format.options;
  return new Intl.NumberFormat(language, options).format(cell.value);
}
