// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  comparePeriods,
  incomeExpenseTotals,
  money,
  parseMoney,
  ReportsError,
  type ReportsErrorCode,
  spendingByCategory,
  spendingByMonth,
  type Transaction,
} from "../src/apps/money/lib/reports";

const january = { start: "2024-01-01", end: "2024-01-31" };
const february = { start: "2024-02-01", end: "2024-02-29" };
const range = { start: january.start, end: february.end };
const options = { currency: "USD" };
const fx = { currency: "USD", rates: [{ from: "EUR", to: "USD", rate: "1.25" }] };

function tx(
  id: string,
  date: string,
  amount: string,
  kind: Transaction["kind"],
  categoryId: string | null = null,
  currency = "USD",
): Transaction {
  return {
    id: `https://example.org/transactions/${id}`,
    date,
    amount: parseMoney(currency, amount),
    kind,
    categoryId,
  };
}

// Fictional ledger only. Refunds and reversals keep the original transaction kind.
const ledger: readonly Transaction[] = Object.freeze([
  tx("pay", "2024-01-01", "100.00", "income"),
  tx("food", "2024-01-15", "-20.00", "expense", "food"),
  tx("refund", "2024-01-31", "5.00", "expense", "food"),
  tx("transfer", "2024-01-15", "-5000.00", "transfer"),
  tx("pay2", "2024-02-01", "90.00", "income"),
  tx("reversal", "2024-02-02", "-10.00", "income"),
  tx("rent", "2024-02-10", "-30.00", "expense", "rent"),
  tx("other", "2024-02-29", "-2.00", "expense"),
  tx("outside", "2024-03-01", "-1000.00", "expense", "food"),
]);

function fails(run: () => unknown, code: ReportsErrorCode) {
  expect(run).toThrow(ReportsError);
  expect(run).toThrow(expect.objectContaining({ code }));
}

describe("exact spending reports", () => {
  it("totals income and expenses by kind, excluding transfers and out-of-period rows", () => {
    const before = JSON.stringify(ledger);
    expect(incomeExpenseTotals(ledger, range, options)).toEqual({
      income: money("USD", 18000),
      expense: money("USD", 4700),
      net: money("USD", 13300),
    });
    expect(JSON.stringify(ledger)).toBe(before);
    expect(incomeExpenseTotals(ledger, january, options).net).toEqual(money("USD", 8500));
  });

  it("groups categories and occupied months deterministically; null is last", () => {
    expect(spendingByCategory([...ledger].reverse(), range, options)).toEqual([
      { categoryId: "food", total: money("USD", 1500) },
      { categoryId: "rent", total: money("USD", 3000) },
      { categoryId: null, total: money("USD", 200) },
    ]);
    expect(spendingByMonth([...ledger].reverse(), range, options)).toEqual([
      { month: "2024-01", total: money("USD", 1500) },
      { month: "2024-02", total: money("USD", 3200) },
    ]);
    expect(spendingByCategory(ledger, january, options)).toEqual([
      { categoryId: "food", total: money("USD", 1500) },
    ]);
  });

  it("handles empty inputs, zero entries, refunds exceeding spending and income reversals", () => {
    expect(incomeExpenseTotals([], range, options)).toEqual({
      income: money("USD", 0),
      expense: money("USD", 0),
      net: money("USD", 0),
    });
    expect(spendingByMonth([], range, options)).toEqual([]);
    expect(spendingByCategory([], range, options)).toEqual([]);
    const rows = [
      tx("zero", "2024-01-01", "0", "expense"),
      tx("credit", "2024-01-02", "10", "expense"),
      tx("debit", "2024-01-03", "-2", "income"),
    ];
    expect(incomeExpenseTotals(rows, range, options)).toEqual({
      income: money("USD", -200),
      expense: money("USD", -1000),
      net: money("USD", 800),
    });
    expect(spendingByMonth([rows[0]!], range, options)).toEqual([
      { month: "2024-01", total: money("USD", 0) },
    ]);
    expect(spendingByCategory(rows, range, options)).toEqual([
      { categoryId: null, total: money("USD", -1000) },
    ]);
  });

  it("converts using only supplied rates and refuses missing, inverse or inexact rates", () => {
    const rows = [
      tx("usd", "2024-01-01", "-10", "expense", "food"),
      tx("eur", "2024-01-02", "-4", "expense", "food", "EUR"),
    ];
    expect(incomeExpenseTotals(rows, range, fx).expense).toEqual(money("USD", 1500));
    expect(spendingByCategory(rows, range, fx)[0]!.total).toEqual(money("USD", 1500));
    expect(spendingByMonth(rows, range, fx)[0]!.total).toEqual(money("USD", 1500));
    for (const report of [incomeExpenseTotals, spendingByCategory, spendingByMonth]) {
      fails(() => report(rows, range, options), "missing-rate");
      fails(
        () =>
          report(rows, range, {
            currency: "USD",
            rates: [{ from: "USD", to: "EUR", rate: "0.8" }],
          }),
        "missing-rate",
      );
      fails(
        () => report([tx("cent", "2024-01-01", "0.01", "expense", null, "EUR")], range, fx),
        "inexact-conversion",
      );
    }
    // Ignored transfers and dates require valid inputs, but need no conversion.
    expect(
      incomeExpenseTotals(
        [
          tx("excluded", "2024-03-01", "1", "income", null, "EUR"),
          tx("transfer", "2024-01-01", "1", "transfer", null, "EUR"),
        ],
        range,
        options,
      ).net,
    ).toEqual(money("USD", 0));
  });

  it("rejects overflow rather than approximating report totals", () => {
    const huge = { ...ledger[0]!, amount: money("USD", Number.MAX_SAFE_INTEGER) };
    fails(
      () =>
        incomeExpenseTotals([huge, tx("extra", "2024-01-01", "0.01", "income")], range, options),
      "overflow",
    );
    fails(
      () =>
        spendingByCategory(
          [{ ...huge, kind: "expense" }, tx("extra", "2024-01-01", "0.01", "expense")],
          range,
          options,
        ),
      "overflow",
    );
  });
});

describe("period comparisons", () => {
  it("compares income, spending and net with exact reduced percentage fractions", () => {
    const result = comparePeriods(ledger, january, february, options);
    expect(result.income).toEqual({
      previous: money("USD", 10000),
      current: money("USD", 8000),
      change: money("USD", -2000),
      percentage: { numerator: "-20", denominator: "1" },
    });
    expect(result.expense).toEqual({
      previous: money("USD", 1500),
      current: money("USD", 3200),
      change: money("USD", 1700),
      percentage: { numerator: "340", denominator: "3" },
    });
    expect(result.net).toEqual({
      previous: money("USD", 8500),
      current: money("USD", 4800),
      change: money("USD", -3700),
      percentage: { numerator: "-740", denominator: "17" },
    });
  });

  it("keeps zero-baseline percentages undefined, and uses absolute negative baselines", () => {
    expect(comparePeriods([], january, february, options).net.percentage).toBeNull();
    const rows = [
      tx("refund", "2024-01-01", "2", "expense"),
      tx("refund2", "2024-02-01", "1", "expense"),
    ];
    expect(comparePeriods(rows, january, february, options).expense.percentage).toEqual({
      numerator: "50",
      denominator: "1",
    });
    expect(
      comparePeriods(
        [ledger[0]!, tx("same", "2024-02-01", "100", "income")],
        january,
        february,
        options,
      ).income.percentage,
    ).toEqual({ numerator: "0", denominator: "1" });
    expect(
      comparePeriods([tx("new", "2024-02-01", "1", "income")], january, february, options).income
        .percentage,
    ).toBeNull();
  });

  it("compares both periods in the requested currency and rejects ambiguous periods", () => {
    const rows = [
      tx("eur", "2024-01-01", "4", "income", null, "EUR"),
      tx("usd", "2024-02-01", "10", "income"),
    ];
    expect(comparePeriods(rows, january, february, fx).income.change).toEqual(money("USD", 500));
    fails(() => comparePeriods(rows, january, february, options), "missing-rate");
    fails(() => comparePeriods([], january, january, options), "invalid-period");
    fails(() => comparePeriods([], february, january, options), "invalid-period");
    fails(
      () => comparePeriods([], january, { start: "2024-01-31", end: february.end }, options),
      "invalid-period",
    );
  });
});

describe("report validation", () => {
  it("validates civil dates, leap years and inclusive bounds", () => {
    for (const date of [
      null,
      42,
      "",
      "2024-02-30",
      "2023-02-29",
      "1900-02-29",
      "2024-13-01",
      "2024-01-32",
      "0000-01-01",
      "2024-01-01T00:00:00Z",
      "2024-1-1",
    ]) {
      fails(
        () => incomeExpenseTotals([{ ...ledger[0]!, date } as Transaction], range, options),
        "invalid-date",
      );
    }
    for (const date of ["0001-01-01", "2000-02-29", "9999-12-31"]) {
      expect(
        incomeExpenseTotals([{ ...ledger[0]!, date }], { start: date, end: date }, options).income
          .minor,
      ).toBe(10000);
    }
    fails(
      () => incomeExpenseTotals([], { start: range.end, end: range.start }, options),
      "invalid-period",
    );
    fails(() => incomeExpenseTotals([], { start: "bad", end: range.end }, options), "invalid-date");
    fails(() => incomeExpenseTotals([], null as never, options), "invalid-input");
  });

  it("rejects malformed rows including excluded rows, duplicate IDs, and sparse lists", () => {
    for (const row of [
      null,
      [],
      false,
      { ...ledger[0], kind: "unknown" },
      { ...ledger[0], id: "" },
      { ...ledger[0], id: " x " },
      { ...ledger[0], id: 4 },
      { ...ledger[0], categoryId: undefined },
      { ...ledger[0], categoryId: "food" },
    ]) {
      fails(() => incomeExpenseTotals([row] as Transaction[], range, options), "invalid-input");
    }
    fails(() => incomeExpenseTotals([ledger[0]!, ledger[0]!], range, options), "duplicate");
    fails(() => incomeExpenseTotals(null as never, range, options), "invalid-input");
    fails(() => incomeExpenseTotals(Array(1), range, options), "invalid-input");
    fails(
      () =>
        incomeExpenseTotals(
          [{ ...ledger[0]!, date: "2025-01-01", amount: { currency: "USD", minor: 0.1 } }],
          range,
          options,
        ),
      "invalid-amount",
    );
  });

  it("validates options and the entire supplied rate table even on empty reports", () => {
    fails(() => incomeExpenseTotals([], range, null as never), "invalid-input");
    fails(() => incomeExpenseTotals([], range, { currency: "XXX" }), "unsupported-currency");
    fails(
      () => spendingByMonth([], range, { currency: "USD", rates: null as never }),
      "invalid-input",
    );
    fails(
      () =>
        spendingByCategory([], range, {
          currency: "USD",
          rates: [{ from: "EUR", to: "USD", rate: "0" }],
        }),
      "invalid-rate",
    );
    fails(
      () =>
        comparePeriods([], january, february, {
          currency: "USD",
          rates: [{ from: "EUR", to: "USD", rate: "bad" }],
        }),
      "invalid-rate",
    );
  });
});
