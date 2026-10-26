// AUTHORED-BY Codex GPT-6.1-Sol
/** Inert import data. Amounts are signed, canonical decimals; dates are YYYY-MM-DD. */
export interface ImportedTransaction {
  readonly date: string;
  readonly amount: string;
  readonly description: string;
  readonly currency?: string;
  readonly accountId?: string;
  readonly externalId?: string;
  readonly memo?: string;
  readonly category?: string;
}

export type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
export type Delimiter = "," | ";" | "\t" | "|";
export type Column = string | number;
export interface CsvMapping {
  readonly date: Column;
  readonly description: Column;
  readonly amount?: Column;
  readonly debit?: Column;
  readonly credit?: Column;
  readonly currency?: Column;
}
export interface CsvOptions {
  readonly columns: CsvMapping;
  readonly delimiter?: Delimiter;
  readonly dateFormat?: DateFormat;
  readonly hasHeader?: boolean;
  readonly decimalSeparator?: "." | ",";
  readonly currency?: string;
}

export interface CategoryRule {
  readonly category: string;
  /** Literal matching, never a user-supplied regular expression. */
  readonly description?: {
    readonly match: "contains" | "equals" | "startsWith" | "endsWith";
    readonly value: string;
    readonly caseSensitive?: boolean;
  };
  /** Inclusive signed bounds, in the transaction's currency. */
  readonly amount?: { readonly min?: string; readonly max?: string };
}
