// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Preserve the original generic CSV value and date policies, including legacy IDs. */
import type { Transaction } from "./csv.js";

const DATE_HEADERS = ["date", "transaction date", "posting date", "posted date", "value date"];
const DESC_HEADERS = [
  "description",
  "name",
  "payee",
  "memo",
  "details",
  "narrative",
  "transaction",
];
const AMOUNT_HEADERS = ["amount", "value"];
const DEBIT_HEADERS = ["debit", "withdrawal", "paid out", "money out"];
const CREDIT_HEADERS = ["credit", "deposit", "paid in", "money in"];

/** Detect and normalise column aliases once per file, for both parsing paths. */
export function genericBankRowParser(headers: readonly string[]) {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (cands: string[]) => {
    const i = lower.findIndex((h) => cands.includes(h));
    return i === -1 ? undefined : headers[i];
  };
  const dateCol = find(DATE_HEADERS);
  const descCol = find(DESC_HEADERS);
  const amountCol = find(AMOUNT_HEADERS);
  const debitCol = find(DEBIT_HEADERS);
  const creditCol = find(CREDIT_HEADERS);

  return (row: Record<string, string>): Transaction | undefined => {
    const amount = resolveAmount(row, amountCol, debitCol, creditCol);
    if (amount === undefined) return undefined;
    return {
      date: dateCol ? parseGenericDate(row[dateCol]) : undefined,
      description: (descCol ? row[descCol] : "") || "Transaction",
      amount,
    };
  };
}

function resolveAmount(
  row: Record<string, string>,
  amountCol: string | undefined,
  debitCol: string | undefined,
  creditCol: string | undefined,
): string | undefined {
  if (amountCol && row[amountCol]?.trim()) {
    return genericAmount(row[amountCol]);
  }
  const debit = debitCol ? cleanNumber(row[debitCol]) : undefined;
  const credit = creditCol ? cleanNumber(row[creditCol]) : undefined;
  if (debit !== undefined && debit !== 0) return `-${Math.abs(debit)}`;
  if (credit !== undefined && credit !== 0) return `${Math.abs(credit)}`;
  return undefined;
}

/** Strip currency symbols/commas; keep the sign and decimals as text. */
export function genericAmount(raw: string): string | undefined {
  const cleaned = raw.replace(/[^0-9.\-()]/g, "").trim();
  if (!cleaned) return undefined;
  // Parenthesised negatives: (12.50) → -12.50.
  const paren = cleaned.match(/^\((.+)\)$/);
  const body = paren ? `-${paren[1]}` : cleaned;
  return Number.isFinite(Number(body)) ? body : undefined;
}

function cleanNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** Parse ISO, `D/M/Y` or `M/D/Y` dates leniently. */
export function parseGenericDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const parts = trimmed.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (parts) {
    let year = Number(parts[3]);
    if (year < 100) year += 2000;
    // Default D/M (most non-US banks); swap when only the second can be a month.
    let day = Number(parts[1]);
    let month = Number(parts[2]);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const d = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}
