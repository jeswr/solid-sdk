// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { ExactArithmetic, formatScaled, TEN, ZERO } from "./exact";
import {
  type ExactValue,
  type HoldingsOptions,
  type HoldingsResult,
  type InvestmentTransaction,
  MAX_QUANTITY_DECIMALS,
  type RealisedGain,
} from "./types";
import { options, requireValue, transactionCount, transactions } from "./validation";

const QUANTITY_SCALE = TEN ** BigInt(MAX_QUANTITY_DECIMALS);

interface Lot {
  id: string;
  date: string;
  quantity: bigint;
  basis: ExactValue;
}

function quantityText(value: bigint): string {
  return formatScaled(value, MAX_QUANTITY_DECIMALS).replace(/\.?0+$/, "");
}

/** One security per call. All input is validated before replay; no inputs are mutated. */
export function computeHoldings(
  input: readonly InvestmentTransaction[],
  settings: HoldingsOptions,
): HoldingsResult {
  transactionCount(input);
  const { decimals, price } = options(settings);
  const ordered = transactions(input, settings.currency, decimals);
  const arithmetic = new ExactArithmetic();
  const lots: Lot[] = [];
  const realisedGains: RealisedGain[] = [];
  let head = 0;
  let quantity = ZERO;
  let basis = arithmetic.fraction(ZERO);
  let dividends = arithmetic.fraction(ZERO);
  let standaloneFees = ZERO;

  for (const transaction of ordered) {
    const { id, date, kind, price, fee } = transaction;
    if (kind === "buy") {
      const cost = arithmetic.add(
        arithmetic.fraction(arithmetic.product(transaction.quantity, price), QUANTITY_SCALE),
        arithmetic.fraction(fee),
      );
      const pool = lots[head];
      if (settings.method === "average" && pool) {
        pool.quantity = arithmetic.sum(pool.quantity, transaction.quantity);
        pool.basis = arithmetic.add(pool.basis, cost);
      } else {
        lots.push({ id, date, quantity: transaction.quantity, basis: cost });
      }
      quantity = arithmetic.sum(quantity, transaction.quantity);
      basis = arithmetic.add(basis, cost);
    } else if (kind === "sell") {
      requireValue(transaction.quantity <= quantity, "OVERSOLD");
      let remaining = transaction.quantity;
      let soldBasis = arithmetic.fraction(ZERO);
      while (remaining > ZERO) {
        const lot = lots[head]!;
        const used = remaining < lot.quantity ? remaining : lot.quantity;
        const cost = arithmetic.multiply(lot.basis, used, lot.quantity);
        soldBasis = arithmetic.add(soldBasis, cost);
        lot.basis = arithmetic.subtract(lot.basis, cost);
        lot.quantity -= used;
        remaining -= used;
        if (lot.quantity === ZERO) head++;
      }
      quantity -= transaction.quantity;
      basis = arithmetic.subtract(basis, soldBasis);
      const proceeds = arithmetic.subtract(
        arithmetic.fraction(arithmetic.product(transaction.quantity, price), QUANTITY_SCALE),
        arithmetic.fraction(fee),
      );
      realisedGains.push({
        id,
        date,
        quantity: quantityText(transaction.quantity),
        proceeds: arithmetic.formatMoney(proceeds, decimals),
        costBasis: arithmetic.formatMoney(soldBasis, decimals),
        gain: arithmetic.formatMoney(arithmetic.subtract(proceeds, soldBasis), decimals),
      });
    } else if (kind === "split") {
      const [n, m] = transaction.ratio!;
      // No per-unit money rounding: each lot keeps its complete exact basis.
      for (let index = head; index < lots.length; index++) {
        const lot = lots[index]!;
        const scaled = arithmetic.product(lot.quantity, n);
        requireValue(scaled % m === ZERO, "INVALID_SPLIT");
        lot.quantity = scaled / m;
      }
      quantity = arithmetic.product(quantity, n) / m;
    } else if (kind === "dividend") {
      dividends = arithmetic.add(dividends, arithmetic.fraction(price - fee));
    } else {
      standaloneFees = arithmetic.sum(standaloneFees, fee);
    }
  }

  const open = lots.slice(head);
  const roundedBasis = arithmetic.halfEven(basis);
  const flooredBasis = open.map((lot) => lot.basis.numerator / lot.basis.denominator);
  const remainder =
    roundedBasis - flooredBasis.reduce((sum, value) => arithmetic.sum(sum, value), ZERO);
  const marketValue = arithmetic.fraction(arithmetic.product(quantity, price), QUANTITY_SCALE);
  return {
    currency: settings.currency,
    method: settings.method,
    quantity: quantityText(quantity),
    openLots: open.map((lot, index) => ({
      id: lot.id,
      date: lot.date,
      quantity: quantityText(lot.quantity),
      costBasis: formatScaled(flooredBasis[index]! + (index === 0 ? remainder : ZERO), decimals),
      exactCostBasis: lot.basis,
      unitCost: arithmetic.multiply(lot.basis, QUANTITY_SCALE, lot.quantity),
    })),
    realisedGains,
    costBasis: formatScaled(roundedBasis, decimals),
    marketValue: arithmetic.formatMoney(marketValue, decimals),
    unrealisedGain: arithmetic.formatMoney(arithmetic.subtract(marketValue, basis), decimals),
    dividendIncome: arithmetic.formatMoney(dividends, decimals),
    standaloneFees: formatScaled(standaloneFees, decimals),
  };
}
