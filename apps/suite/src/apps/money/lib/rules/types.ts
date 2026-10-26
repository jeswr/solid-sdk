// AUTHORED-BY Codex GPT-6.1-Sol

/** Amounts and balances are signed safe integers in currency minor units. */
export interface MoneyTransaction {
  readonly id: string;
  readonly accountId: string;
  readonly date: string;
  readonly currency: string;
  readonly amount: number;
  readonly payee: string;
  readonly memo: string;
  readonly categoryId?: string;
  readonly status: "uncleared" | "cleared" | "reconciled";
}

export type TextCondition =
  | { readonly operator: "contains"; readonly value: string }
  | { readonly operator: "glob"; readonly value: string };

export interface CategorisationRule {
  readonly id: string;
  /** Lower numeric priority wins; ties preserve rule input order. */
  readonly priority: number;
  /** Conditions are ANDed. Empty conditions explicitly match every transaction. */
  readonly conditions: {
    readonly payee?: TextCondition;
    readonly memo?: TextCondition;
    readonly amount?: { readonly min?: number; readonly max?: number };
    readonly accountId?: string;
  };
  readonly actions: { readonly categoryId?: string; readonly payee?: string };
}

export interface RuleResult {
  readonly transaction: MoneyTransaction;
  readonly matchedRuleId: string | null;
}

export interface TransferOptions {
  readonly accountIds: readonly [string, string];
  readonly maxDays: number;
}

export interface TransferMatch {
  readonly outflowId: string;
  readonly inflowId: string;
}

export interface ReconciliationInput {
  readonly accountId: string;
  readonly currency: string;
  /** Balance immediately before ALL supplied transactions, including reconciled ones. */
  readonly openingBalance: number;
  readonly statementBalance: number;
  readonly statementDate: string;
  readonly transactions: readonly MoneyTransaction[];
}

export interface ReconciliationResult {
  readonly clearedBalance: number;
  /** Statement balance minus cleared balance. */
  readonly difference: number;
  readonly balanced: boolean;
  /** Empty on mismatch; otherwise cleared IDs through the inclusive statement date. */
  readonly transactionIdsToReconcile: readonly string[];
}
