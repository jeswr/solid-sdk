// AUTHORED-BY Codex GPT-6
import type { Account, ControlStatement } from "./records.js";

/**
 * Fold an append-only log of VERIFIED owner controls, starting with the account record.
 * The caller must verify signatures, owner attribution and acceptance before supplying
 * statements; this data-only fold does not establish authority or check a clock.
 * Account targets isolate logs; omitted fields never overwrite another statement.
 */
export function foldBindingControls(
  account: Account,
  statements: readonly ControlStatement[],
): Account {
  const result = { ...account, restrictions: { ...account.restrictions } };
  const ordered = statements
    .filter((statement) => statement.kind === "SetBindingState" && statement.target === account.id)
    .toSorted(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        submillisecond(a.createdAt) - submillisecond(b.createdAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  for (const statement of ordered) {
    if (statement.bindingState !== undefined) result.bindingState = statement.bindingState;
    for (const field of ["read", "triage", "draft", "send"] as const) {
      const value = statement.restrictions?.[field];
      if (value !== undefined) result.restrictions[field] = value;
    }
  }
  return result;
}

// The record schema preserves up to nanoseconds, beyond Date.parse's millisecond precision.
function submillisecond(instant: string): number {
  const fraction = /\.(\d+)/.exec(instant)?.[1] ?? "";
  return Number(fraction.padEnd(9, "0").slice(3));
}
