// AUTHORED-BY Codex GPT-6.1-Sol
import { CSV_LIMITS, type CsvDelimiter, CsvError, validateDelimiter, validateTable } from "./model";

export interface CsvSerializeOptions {
  readonly delimiter?: CsvDelimiter;
  readonly lineEnding?: "\r\n" | "\n";
  readonly bom?: boolean;
}

/** Canonical CRLF records, including the final terminator. Raw cell contents are preserved. */
export function serializeCsv(
  rows: readonly (readonly string[])[],
  options: CsvSerializeOptions = {},
): string {
  const { delimiter = ",", lineEnding = "\r\n", bom = false } = options;
  validateDelimiter(delimiter);
  if (lineEnding !== "\r\n" && lineEnding !== "\n") {
    throw new CsvError("invalid-input", "Expected CRLF or LF line ending");
  }
  if (typeof bom !== "boolean") throw new CsvError("invalid-input", "Expected boolean BOM flag");
  validateTable(rows);
  const parts: string[] = [];
  let size = bom ? 1 : 0;
  if (bom) parts.push("\uFEFF");
  const append = (text: string) => {
    size += text.length;
    if (size > CSV_LIMITS.maxCodeUnits) throw new CsvError("limit", "CSV output is too large");
    parts.push(text);
  };
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      if (c > 0) append(delimiter);
      const value = row[c] as string;
      // Quoting a content BOM prevents the parser mistaking it for the file BOM.
      // Quote every sniffable separator so our output also round-trips with auto-detection.
      const quote = /[",;\t\r\n]/u.test(value) || value.startsWith("\uFEFF");
      append(quote ? `"${value.replaceAll('"', '""')}"` : value);
    }
    append(lineEnding);
  }
  return parts.join("");
}
