// AUTHORED-BY Codex GPT-6.1-Sol
export const MAX_TRANSACTIONS = 50_000;
export const MAX_SIGNIFICANT_DIGITS = 30;
export const MAX_QUANTITY_DECIMALS = 8;
export const MAX_CURRENCY_MINOR_UNITS = MAX_SIGNIFICANT_DIGITS;
/** Longest transaction ID in UTF-16 units, checked before trimming, hashing or sorting. */
export const MAX_TRANSACTION_ID_LENGTH = 1024;

export type CostBasisMethod = "fifo" | "average";

interface TransactionFields {
  readonly id: string;
  /** Gregorian calendar date, YYYY-MM-DD. */
  readonly date: string;
  readonly quantity: string;
  readonly price: string;
  readonly fee: string;
  readonly currency: string;
}

export type InvestmentTransaction = TransactionFields &
  (
    | { readonly kind: "buy" | "sell" | "dividend" | "fee" }
    | { readonly kind: "split"; readonly ratio: string }
  );

export interface HoldingsOptions {
  readonly method: CostBasisMethod;
  readonly currency: string;
  /** Explicit exponents; no built-in currency table or fallback. */
  readonly minorUnits: Readonly<Record<string, number>>;
  readonly currentPrice: string;
}

/** Exact reduced fraction, denominator positive. Money fractions use minor units. */
export interface ExactValue {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface OpenLot {
  readonly id: string;
  readonly date: string;
  readonly quantity: string;
  /** Final money value; aggregate rounding remainder belongs to the oldest lot. */
  readonly costBasis: string;
  readonly exactCostBasis: ExactValue;
  /** Exact minor units per one whole share, including purchase fees. */
  readonly unitCost: ExactValue;
}

export interface RealisedGain {
  readonly id: string;
  readonly date: string;
  readonly quantity: string;
  readonly proceeds: string;
  readonly costBasis: string;
  /** Rounded directly from exact proceeds minus exact basis. */
  readonly gain: string;
}

export interface HoldingsResult {
  readonly currency: string;
  readonly method: CostBasisMethod;
  readonly quantity: string;
  readonly openLots: readonly OpenLot[];
  readonly realisedGains: readonly RealisedGain[];
  readonly costBasis: string;
  readonly marketValue: string;
  readonly unrealisedGain: string;
  readonly dividendIncome: string;
  readonly standaloneFees: string;
}
