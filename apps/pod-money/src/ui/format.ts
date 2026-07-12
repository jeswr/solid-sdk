// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pure presentation helpers for the accounts view. No React, no RDF — just the
// money / date / label formatting the view renders. Kept separate so they are
// trivially unit-testable and reusable by any future view.
//
// FINANCIAL DATA IS SENSITIVE: these helpers format defensively (a missing or
// NaN amount, an invalid Date) into a stable placeholder rather than throwing,
// and they NEVER log a value. The view renders only what these return.

import type { AccountKind, AccountStatus, TransactionKind } from "../model.js";

/** The placeholder rendered when a value is absent or unparseable. */
export const PLACEHOLDER = "—" as const;

/**
 * Format a monetary value + ISO 4217 currency for display. Defensive on every
 * axis so the view never crashes on incomplete pod data:
 *   - a missing or non-finite amount (`undefined` / `NaN` / `±Infinity`) →
 *     PLACEHOLDER (we never render a partial/garbage number);
 *   - a missing currency → the amount alone, fixed to 2 decimals;
 *   - a valid currency → `Intl.NumberFormat` currency style, falling back to a
 *     plain `<CODE> <amount>` if `Intl` rejects the code (it throws on an
 *     invalid currency code, which untrusted pod data could carry).
 *
 * Locale is fixed to "en" so the rendered string is stable and assertable.
 */
export function formatMoney(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined || !Number.isFinite(amount)) {
    return PLACEHOLDER;
  }
  if (currency === undefined || currency === "") {
    return amount.toFixed(2);
  }
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount);
  } catch {
    // Intl.NumberFormat throws a RangeError on an invalid currency code; fall
    // back to a plain, never-throwing rendering rather than crash the view.
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * ISO-date (`YYYY-MM-DD`) for a timestamp, or PLACEHOLDER when absent or
 * invalid. GUARDS an invalid Date (`new Date("nonsense")` →
 * `Number.isNaN(getTime())`) so a malformed `xsd:dateTime` in the pod can never
 * make `.toISOString()` throw. Deliberately locale-independent so the rendered
 * value is stable across environments and trivially assertable in a test.
 */
export function formatDate(date: Date | undefined): string {
  if (date === undefined || Number.isNaN(date.getTime())) {
    return PLACEHOLDER;
  }
  return date.toISOString().slice(0, 10);
}

/** Human-readable account kind, or "Account" when the sub-kind is unset. */
export function formatAccountKind(kind: AccountKind | undefined): string {
  return kind ?? "Account";
}

/** Human-readable account status, or PLACEHOLDER when unset. */
export function formatAccountStatus(status: AccountStatus | undefined): string {
  return status ?? PLACEHOLDER;
}

/** Human-readable transaction kind, or "Transaction" when unset. */
export function formatTransactionKind(kind: TransactionKind | undefined): string {
  return kind ?? "Transaction";
}

/**
 * The display label for an account: its `skos:prefLabel` when present, else a
 * decoded fragment / last path segment of its IRI, else the IRI itself. Never
 * empty, so the accounts list always shows something clickable.
 */
export function accountDisplayLabel(label: string | undefined, iri: string): string {
  if (label !== undefined && label.trim() !== "") {
    return label;
  }
  return iriLeaf(iri);
}

/**
 * A short, human-ish leaf for an IRI — the fragment after `#` when non-empty,
 * else the last non-empty path segment, decoded. Used for an account with no
 * label and for a transaction's counterparty/payee display.
 *
 * A NON-EMPTY fragment always wins. An empty/trailing `#` (e.g. `…/bob#`) is
 * stripped and the path leaf is used instead. The path leaf is the last
 * non-empty segment after stripping trailing slashes; a value with neither a
 * usable fragment nor a slash (e.g. `urn:uuid:abc`) returns unchanged.
 */
export function iriLeaf(iri: string): string {
  const hashIndex = iri.indexOf("#");
  if (hashIndex >= 0 && hashIndex < iri.length - 1) {
    return decodeSegment(iri.slice(hashIndex + 1));
  }
  // No usable fragment: drop an empty/trailing `#`, then any trailing slashes,
  // and take the last path segment.
  const withoutFragment = hashIndex >= 0 ? iri.slice(0, hashIndex) : iri;
  const trimmed = withoutFragment.replace(/\/+$/, "");
  const slashIndex = trimmed.lastIndexOf("/");
  const last = slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
  return last === "" ? iri : decodeSegment(last);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * A user-facing message for a thrown value. The ledger reader rejects with an
 * `Error`, but a catch binds `unknown`; this normalises both (an Error's
 * `.message`, else the stringified value) into one display string.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
