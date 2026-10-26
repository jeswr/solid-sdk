// AUTHORED-BY Codex GPT-6.1-Sol
import { FileError, validString } from "./errors";

const UNITS = ["B", "kB", "MB", "GB", "TB", "PB"] as const;

/** Decimal SI bytes, one decimal at most. Pass the account locale explicitly. */
export function formatFileSize(bytes: number, locale = "en"): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new FileError("invalid-size");
  validString(locale, "invalid-locale");
  let formatter: Intl.NumberFormat;
  try {
    if (Intl.NumberFormat.supportedLocalesOf([locale]).length !== 1) {
      throw new FileError("invalid-locale");
    }
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  } catch {
    throw new FileError("invalid-locale");
  }
  let value = Math.abs(bytes); // Normalize negative zero for display.
  let unit = 0;
  // Promote after rounding too, so 999950 bytes renders as 1 MB, not 1,000 kB.
  while (Math.round(value * 10) / 10 >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${formatter.format(value)} ${UNITS[unit]}`;
}
