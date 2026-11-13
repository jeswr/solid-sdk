// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Transaction } from "./types.js";

export function optionalLinks(node: Partial<Transaction>) {
  const result: Partial<
    Record<"category" | "payee" | "derivedFrom" | "debitAccount" | "creditAccount", string>
  > = {};
  for (const key of [
    "category",
    "payee",
    "derivedFrom",
    "debitAccount",
    "creditAccount",
  ] as const) {
    const value = node[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}
export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("Incomplete money RDF record");
  return value;
}
