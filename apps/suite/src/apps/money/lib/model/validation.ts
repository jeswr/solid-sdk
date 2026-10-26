// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { parseDate } from "../import/values";
import type { Money, Range, Transaction } from "./types";

export function iri(value: string): string {
  if (safeHttpIri(value) !== value) throw new TypeError("Invalid money resource IRI");
  return value;
}
export function identifier(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new TypeError("Invalid money ID");
  return value;
}
export function instant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value))
    throw new TypeError("Invalid money timestamp");
  parseDate(value.slice(0, 10), "YYYY-MM-DD");
  const result = Date.parse(value);
  if (!Number.isFinite(result) || Number(value.slice(11, 13)) >= 24)
    throw new TypeError("Invalid money timestamp");
  return result;
}
export function validateRange(range: Range): void {
  if (instant(range.start) > instant(range.end)) throw new TypeError("Reversed money range");
}
export function validateMoney(value: Money): void {
  if (!/^-?(0|[1-9]\d*)(?:\.\d+)?$/.test(value.amount)) throw new TypeError("Invalid money amount");
  if (!/^[A-Z]{3}$/.test(value.currency)) throw new TypeError("Explicit currency is required");
}
export function validateTransaction(value: Transaction): void {
  iri(value.id);
  iri(value.account);
  instant(value.postingTime);
  validateMoney(value);
  if (!value.description.trim()) throw new TypeError("Transaction description is required");
  for (const optional of [
    value.category,
    value.payee,
    value.derivedFrom,
    value.debitAccount,
    value.creditAccount,
  ])
    if (optional !== undefined) iri(optional);
}
