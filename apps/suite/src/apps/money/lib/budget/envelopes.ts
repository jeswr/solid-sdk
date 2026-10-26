// AUTHORED-BY Codex GPT-6.1-Sol
import { type Currency, groupMoney, type Money, validateMoney } from "./money";
import { BudgetError, checked, identity, list, month, record } from "./validation";

export interface Allocation {
  readonly categoryId: string;
  readonly amount: Money;
}

export interface BudgetOpening {
  readonly availableToBudget: readonly Money[];
  readonly envelopes: readonly Allocation[];
}

export interface BudgetMonthInput {
  readonly month: string;
  /** Uncategorised net income; refunds to envelopes belong in activity instead. */
  readonly income: readonly Money[];
  readonly assignments: readonly Allocation[];
  /** Signed cash activity: spending negative, category refunds positive. */
  readonly activity: readonly Allocation[];
}

export interface Envelope {
  readonly categoryId: string;
  readonly assigned: number;
  readonly activity: number;
  readonly rollover: number;
  readonly available: number;
}

export interface CurrencyBudget {
  readonly currency: Currency;
  readonly availableToBudget: number;
  readonly envelopes: readonly Envelope[];
}

export interface BudgetMonth {
  readonly month: string;
  readonly currencies: readonly CurrencyBudget[];
}

function allocations(values: readonly Allocation[], unique: boolean): void {
  list(values);
  const seen = new Set<string>();
  for (const value of values) {
    record(value);
    identity(value.categoryId);
    validateMoney(value.amount);
    const key = JSON.stringify([value.categoryId, value.amount.currency]);
    if (unique && seen.has(key)) throw new BudgetError("duplicate");
    seen.add(key);
  }
}

function validateMonths(inputs: readonly BudgetMonthInput[], opening: BudgetOpening): void {
  record(opening);
  groupMoney(opening.availableToBudget);
  allocations(opening.envelopes, true);
  list(inputs);
  let previous: string | undefined;
  for (const input of inputs) {
    record(input);
    month(input.month);
    if (previous !== undefined) {
      const next = new Date(`${previous}-01T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (next.toISOString().slice(0, 7) !== input.month) {
        throw new BudgetError("nonconsecutive-months");
      }
    }
    previous = input.month;
    groupMoney(input.income);
    allocations(input.assignments, true);
    allocations(input.activity, false);
  }
}

/** Cash envelopes: both saved funds and overspend roll forward, in full. */
export function calculateBudget(
  inputs: readonly BudgetMonthInput[],
  opening: BudgetOpening,
): BudgetMonth[] {
  validateMonths(inputs, opening);
  const pool = new Map<Currency, number>();
  const balances = new Map<Currency, Map<string, number>>();
  function ensure(currency: Currency): Map<string, number> {
    let categories = balances.get(currency);
    if (!categories) {
      categories = new Map();
      balances.set(currency, categories);
      pool.set(currency, 0);
    }
    return categories;
  }
  for (const amount of groupMoney(opening.availableToBudget)) {
    ensure(amount.currency);
    pool.set(amount.currency, amount.minor);
  }
  for (const { categoryId, amount } of opening.envelopes) {
    ensure(amount.currency).set(categoryId, amount.minor);
  }

  return inputs.map((input) => {
    for (const amount of groupMoney(input.income)) {
      ensure(amount.currency);
      pool.set(amount.currency, checked(pool.get(amount.currency)! + amount.minor));
    }
    const rows = new Map<Currency, Map<string, Envelope>>();
    for (const [currency, categories] of balances) {
      rows.set(
        currency,
        new Map(
          [...categories].map(([categoryId, rollover]) => [
            categoryId,
            { categoryId, rollover, assigned: 0, activity: 0, available: rollover },
          ]),
        ),
      );
    }
    for (const field of ["assignments", "activity"] as const) {
      for (const { categoryId, amount } of input[field]) {
        ensure(amount.currency);
        let categories = rows.get(amount.currency);
        if (!categories) {
          categories = new Map();
          rows.set(amount.currency, categories);
        }
        const row = categories.get(categoryId) ?? {
          categoryId,
          rollover: 0,
          assigned: 0,
          activity: 0,
          available: 0,
        };
        const key = field === "assignments" ? "assigned" : "activity";
        categories.set(categoryId, {
          ...row,
          [key]: checked(row[key] + amount.minor),
          available: checked(row.available + amount.minor),
        });
        if (field === "assignments") {
          pool.set(amount.currency, checked(pool.get(amount.currency)! - amount.minor));
        }
      }
    }
    const currencies = [...rows.keys()].sort().map((currency): CurrencyBudget => {
      const categories = rows.get(currency)!;
      const envelopes = [...categories.keys()].sort().map((id) => categories.get(id)!);
      for (const envelope of envelopes) {
        balances.get(currency)!.set(envelope.categoryId, envelope.available);
      }
      return { currency, availableToBudget: pool.get(currency)!, envelopes };
    });
    return { month: input.month, currencies };
  });
}
