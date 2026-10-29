// AUTHORED-BY Codex GPT-6.1-Sol
import type { MoneyTransaction } from "../rules/types";

export type { MoneyTransaction } from "../rules/types";

export interface TransferOptions {
  /** Explicit scope: at least two distinct financial accounts owned by the user. */
  readonly accountIds: readonly string[];
  /** Inclusive nonnegative whole calendar-day tolerance; no implicit default. */
  readonly maxDays: number;
}

export interface TransferPair {
  readonly outflowId: string;
  readonly inflowId: string;
}

export interface TransferAmbiguity {
  readonly transactionId: string;
  /** Includes sole candidates whose counterpart has competing candidates. */
  readonly candidateIds: readonly string[];
}

export interface TransferDetection {
  readonly pairs: readonly TransferPair[];
  readonly ambiguous: readonly TransferAmbiguity[];
  /** Entries with no candidates, including zero amounts. */
  readonly unmatchedIds: readonly string[];
}

export interface SplitPart {
  readonly categoryId: string;
  /** Signed safe integer minor units in the original transaction's currency. */
  readonly amount: number;
}

export interface SplitTransaction {
  readonly transaction: MoneyTransaction;
  readonly parts: readonly SplitPart[];
}
