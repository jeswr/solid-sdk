// AUTHORED-BY Codex GPT-6.1-Sol

export type CellValue =
  | { readonly type: "number" | "percent"; readonly value: number }
  | { readonly type: "date"; readonly value: string }
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "text"; readonly value: string };

export type SheetFormatErrorCode =
  | "unsupported-format"
  | "unsupported-locale"
  | "invalid-input"
  | "invalid-value";

export class SheetFormatError extends Error {
  constructor(
    readonly code: SheetFormatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SheetFormatError";
  }
}

export type Format =
  | { readonly kind: "number"; readonly options: Intl.NumberFormatOptions }
  | { readonly kind: "date"; readonly date: boolean; readonly time: boolean }
  | { readonly kind: "general" };

export function parseFormatCode(code: string): Format {
  switch (code) {
    case "General":
      return { kind: "general" };
    case "0":
      return { kind: "number", options: { useGrouping: false, maximumFractionDigits: 0 } };
    case "0.00":
      return {
        kind: "number",
        options: { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 },
      };
    case "#,##0":
      return { kind: "number", options: { useGrouping: true, maximumFractionDigits: 0 } };
    case "%":
    case "0%":
      return {
        kind: "number",
        options: { style: "percent", useGrouping: false, maximumFractionDigits: 0 },
      };
    case "0.00%":
      return {
        kind: "number",
        options: {
          style: "percent",
          useGrouping: false,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        },
      };
    case "yyyy-mm-dd":
    case "hh:mm":
    case "yyyy-mm-dd hh:mm":
      return { kind: "date", date: code.includes("yyyy"), time: code.includes("hh") };
  }
  if (/^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf("currency").includes(code)) {
    return {
      kind: "number",
      options: { style: "currency", currency: code, currencyDisplay: "code" },
    };
  }
  throw new SheetFormatError("unsupported-format", "Unsupported cell format code");
}

export function validateLocale(locale: string): string {
  try {
    if (!locale || Intl.NumberFormat.supportedLocalesOf([locale]).length !== 1) throw new Error();
    const language = new Intl.Locale(locale);
    if (
      language.numberingSystem &&
      new Intl.NumberFormat(locale).resolvedOptions().numberingSystem !== language.numberingSystem
    ) {
      throw new Error();
    }
    return language.toString();
  } catch {
    throw new SheetFormatError("unsupported-locale", "Unsupported or invalid locale");
  }
}
