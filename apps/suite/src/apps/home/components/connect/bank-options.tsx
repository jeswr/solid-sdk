// AUTHORED-BY Claude Opus 5.5
"use client";
import type { FileImportAdapter } from "@jeswr/pod-connectors";
import {
  BANK_CSV_FORMATS,
  type BankCsvFormat,
  type BankStatementOptions,
  createBankStatementsFileAdapter,
  MAX_BANK_ACCOUNT_LABEL_CHARS,
  validateBankOptions,
} from "@jeswr/pod-connectors/adapters/bank-statements";

/** The catalogue id whose file import takes a bank format and an account label. */
export const BANK_STATEMENTS_ID = "bank-statements";
/** Id of the always-mounted problem text, for the controls it explains. */
export const BANK_PROBLEM_ID = "bank-options-problem";

export type BankFormatChoice = "auto" | BankCsvFormat;
export interface BankImportChoice {
  readonly format: BankFormatChoice;
  /** What the user typed; trimmed before it reaches the adapter. */
  readonly accountLabel: string;
}
export const DEFAULT_BANK_CHOICE: BankImportChoice = { format: "auto", accountLabel: "" };

const FORMATS: readonly BankFormatChoice[] = ["auto", ...BANK_CSV_FORMATS];
const FORMAT_LABELS: Record<BankFormatChoice, string> = {
  auto: "Auto-detect",
  revolut: "Revolut",
  "hsbc-uk": "HSBC UK",
  monzo: "Monzo",
  starling: "Starling",
};

/** The adapter options for a choice: Auto-detect omits csvFormat, an empty label is omitted. */
export function bankOptions(choice: BankImportChoice): BankStatementOptions {
  const accountLabel = choice.accountLabel.trim();
  return {
    ...(choice.format !== "auto" && { csvFormat: choice.format }),
    ...(accountLabel && { accountLabel }),
  };
}

/** Why the choice cannot be imported yet, or undefined when it can. */
export function bankChoiceProblem(choice: BankImportChoice): string | undefined {
  const options = bankOptions(choice);
  if (options.csvFormat === "hsbc-uk" && !options.accountLabel)
    return "Enter an account label to import an HSBC UK statement.";
  try {
    // The adapter's own rules, so the connect flow accepts exactly what the import accepts.
    validateBankOptions(options);
    return undefined;
  } catch {
    return `Use an account label with visible text, at most ${MAX_BANK_ACCOUNT_LABEL_CHARS} characters.`;
  }
}

/** The bank statements adapter for a valid choice (check bankChoiceProblem first). */
export function bankStatementsAdapter(choice: BankImportChoice): FileImportAdapter {
  return createBankStatementsFileAdapter(bankOptions(choice));
}

export function BankImportOptions({
  value,
  onChange,
}: {
  value: BankImportChoice;
  onChange: (next: BankImportChoice) => void;
}) {
  const hsbc = value.format === "hsbc-uk";
  const problem = bankChoiceProblem(value);
  return (
    <fieldset className="hm-connect-bank">
      <legend>Statement details</legend>
      <label htmlFor="bank-format">Bank format</label>
      <select
        id="bank-format"
        value={value.format}
        onChange={(event) => {
          const format = FORMATS.find((candidate) => candidate === event.target.value);
          if (format) onChange({ ...value, format });
        }}
      >
        {FORMATS.map((format) => (
          <option key={format} value={format}>
            {FORMAT_LABELS[format]}
          </option>
        ))}
      </select>
      <label htmlFor="bank-account-label">Account label {hsbc ? "(required)" : "(optional)"}</label>
      <input
        id="bank-account-label"
        type="text"
        autoComplete="off"
        value={value.accountLabel}
        maxLength={MAX_BANK_ACCOUNT_LABEL_CHARS}
        required={hsbc}
        aria-invalid={problem ? true : undefined}
        aria-describedby={`bank-account-label-hint ${BANK_PROBLEM_ID}`}
        onChange={(event) => onChange({ ...value, accountLabel: event.target.value })}
      />
      <p id="bank-account-label-hint" className="hm-connect-bank-hint">
        {hsbc
          ? "HSBC UK statements don't say which account they're from, so the label keeps this account's transactions together."
          : "Name the account if you import more than one from the same bank, such as a joint and a personal account."}{" "}
        Use the same label every time you import this account.
      </p>
      {/* Always mounted, so a new problem is announced as it appears. */}
      <p id={BANK_PROBLEM_ID} className="hm-connect-bank-problem" aria-live="polite">
        {problem ?? ""}
      </p>
    </fieldset>
  );
}
