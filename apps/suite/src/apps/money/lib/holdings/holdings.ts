// AUTHORED-BY Codex GPT-6.1-Sol
import {
  add,
  formatMoney,
  formatScaled,
  fraction,
  halfEven,
  multiply,
  subtract,
  TEN,
  ZERO,
} from "./exact";
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
  const lots: Lot[] = [];
  const realisedGains: RealisedGain[] = [];
  let head = 0;
  let quantity = ZERO;
  let basis = fraction(ZERO);
  let dividends = fraction(ZERO);
  let standaloneFees = ZERO;

  for (const transaction of ordered) {
    const { id, date, kind, price, fee } = transaction;
    if (kind === "buy") {
      const cost = add(fraction(transaction.quantity * price, QUANTITY_SCALE), fraction(fee));
      const pool = lots[head];
      if (settings.method === "average" && pool) {
        pool.quantity += transaction.quantity;
        pool.basis = add(pool.basis, cost);
      } else {
        lots.push({ id, date, quantity: transaction.quantity, basis: cost });
      }
      quantity += transaction.quantity;
      basis = add(basis, cost);
    } else if (kind === "sell") {
      requireValue(transaction.quantity <= quantity, "OVERSOLD");
      let remaining = transaction.quantity;
      let soldBasis = fraction(ZERO);
      while (remaining > ZERO) {
        const lot = lots[head]!;
        const used = remaining < lot.quantity ? remaining : lot.quantity;
        const cost = multiply(lot.basis, used, lot.quantity);
        soldBasis = add(soldBasis, cost);
        lot.basis = subtract(lot.basis, cost);
        lot.quantity -= used;
        remaining -= used;
        if (lot.quantity === ZERO) head++;
      }
      quantity -= transaction.quantity;
      basis = subtract(basis, soldBasis);
      const proceeds = subtract(
        fraction(transaction.quantity * price, QUANTITY_SCALE),
        fraction(fee),
      );
      realisedGains.push({
        id,
        date,
        quantity: quantityText(transaction.quantity),
        proceeds: formatMoney(proceeds, decimals),
        costBasis: formatMoney(soldBasis, decimals),
        gain: formatMoney(subtract(proceeds, soldBasis), decimals),
      });
    } else if (kind === "split") {
      const [n, m] = transaction.ratio!;
      // No per-unit money rounding: each lot keeps its complete exact basis.
      for (let index = head; index < lots.length; index++) {
        const lot = lots[index]!;
        requireValue((lot.quantity * n) % m === ZERO, "INVALID_SPLIT");
        lot.quantity = (lot.quantity * n) / m;
      }
      quantity = (quantity * n) / m;
    } else if (kind === "dividend") {
      dividends = add(dividends, fraction(price - fee));
    } else {
      standaloneFees += fee;
    }
  }

  const open = lots.slice(head);
  const roundedBasis = halfEven(basis);
  const flooredBasis = open.map((lot) => lot.basis.numerator / lot.basis.denominator);
  const remainder = roundedBasis - flooredBasis.reduce((sum, value) => sum + value, ZERO);
  const marketValue = fraction(quantity * price, QUANTITY_SCALE);
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
      unitCost: multiply(lot.basis, QUANTITY_SCALE, lot.quantity),
    })),
    realisedGains,
    costBasis: formatScaled(roundedBasis, decimals),
    marketValue: formatMoney(marketValue, decimals),
    unrealisedGain: formatMoney(subtract(marketValue, basis), decimals),
    dividendIncome: formatMoney(dividends, decimals),
    standaloneFees: formatScaled(standaloneFees, decimals),
  };
}
