// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type Balance,
  type BudgetErrorCode,
  type Category,
  type Currency,
  cashFlowByMonth,
  money,
  netWorthSeries,
  type Period,
  spendByCategory,
  type Transaction,
} from "../src/apps/money/lib/budget";

const invalid = <T>(value: unknown): T => value as T;
const range: Period = Object.freeze({ start: "2024-01-01", end: "2024-03-31" });
const categories: readonly Category[] = Object.freeze([
  Object.freeze({ id: "food", parentId: "living" }),
  Object.freeze({ id: "living", parentId: null }),
  Object.freeze({ id: "fruit", parentId: "food" }),
  Object.freeze({ id: "travel", parentId: null }),
]);
function transaction(
  id: string,
  date: string,
  minor: number,
  kind: Transaction["kind"] = "expense",
  categoryId: string | null = "food",
  currency: Currency = "GBP",
): Transaction {
  return Object.freeze({
    id,
    date,
    amount: Object.freeze(money(currency, minor)),
    kind,
    categoryId,
  });
}
function balance(
  accountId: string,
  date: string,
  minor: number,
  currency: Currency = "GBP",
): Balance {
  return Object.freeze({ accountId, date, balance: Object.freeze(money(currency, minor)) });
}
function rejects(fn: () => unknown, code: BudgetErrorCode) {
  expect(fn).toThrowError(expect.objectContaining({ name: "BudgetError", code }));
}

describe("category spending", () => {
  it("rolls up a hierarchy once, including parent spend, refunds and uncategorised spend", () => {
    const values = Object.freeze([
      transaction("1", "2024-01-01", -100, "expense", "fruit"),
      transaction("2", "2024-03-31", -50),
      transaction("3", "2024-02-29", 20),
      transaction("4", "2024-02-01", -10, "expense", "living"),
      transaction("5", "2024-02-01", -8, "expense", null),
      transaction("6", "2024-02-01", 15, "expense", "travel"),
      transaction("7", "2024-01-01", 5000, "income", null),
      transaction("8", "2024-02-01", -1000, "transfer", null),
      transaction("9", "2023-12-31", -500),
      transaction("10", "2024-04-01", -600),
      transaction("11", "2024-02-01", -200, "expense", "fruit", "USD"),
    ]);
    expect(spendByCategory(values, categories, range)).toEqual([
      {
        currency: "GBP",
        categories: [
          { categoryId: "food", direct: 30, total: 130 },
          { categoryId: "fruit", direct: 100, total: 100 },
          { categoryId: "living", direct: 10, total: 140 },
          { categoryId: "travel", direct: -15, total: -15 },
          { categoryId: null, direct: 8, total: 8 },
        ],
      },
      {
        currency: "USD",
        categories: [
          { categoryId: "food", direct: 0, total: 200 },
          { categoryId: "fruit", direct: 200, total: 200 },
          { categoryId: "living", direct: 0, total: 200 },
        ],
      },
    ]);
    expect(spendByCategory([...values].reverse(), categories, range)).toEqual(
      spendByCategory(values, categories, range),
    );
    expect(values[0]?.amount.minor).toBe(-100);
  });

  it("handles empty/zero reports, a one-day period and prototype-like category IDs", () => {
    expect(spendByCategory([], [], range)).toEqual([]);
    expect(
      spendByCategory(
        [transaction("1", "2024-01-01", 0, "expense", "constructor")],
        [
          { id: "constructor", parentId: "__proto__" },
          { id: "__proto__", parentId: null },
        ],
        { start: "2024-01-01", end: "2024-01-01" },
      ),
    ).toEqual([
      {
        currency: "GBP",
        categories: [
          { categoryId: "__proto__", direct: 0, total: 0 },
          { categoryId: "constructor", direct: 0, total: 0 },
        ],
      },
    ]);
  });

  it("rejects duplicate nodes, missing parents, cycles and unknown categories", () => {
    for (const tree of [
      [
        { id: "a", parentId: null },
        { id: "a", parentId: null },
      ],
      [{ id: "a", parentId: "missing" }],
      [{ id: "a", parentId: "a" }],
      [
        { id: "a", parentId: "b" },
        { id: "b", parentId: "c" },
        { id: "c", parentId: "a" },
      ],
    ]) {
      rejects(() => spendByCategory([], tree, range), "invalid-category-tree");
    }
    rejects(
      () => spendByCategory([transaction("1", "2023-01-01", -5)], [], range),
      "invalid-category-tree",
    );
    for (const tree of [null, [null], [{ id: "", parentId: null }], [{ id: "a" }]]) {
      rejects(() => spendByCategory([], invalid(tree), range), "invalid-input");
    }
  });

  it("rejects totals that exceed safe integers", () => {
    const max = Number.MAX_SAFE_INTEGER;
    rejects(
      () =>
        spendByCategory(
          [transaction("1", "2024-01-01", -max), transaction("2", "2024-01-01", -1)],
          categories,
          range,
        ),
      "overflow",
    );
    rejects(
      () =>
        spendByCategory(
          [
            transaction("1", "2024-01-01", -max, "expense", "fruit"),
            transaction("2", "2024-01-01", -1, "expense", "living"),
          ],
          categories,
          range,
        ),
      "overflow",
    );
  });
});

describe("monthly cash flow", () => {
  it("groups in/out by civil month and currency, excluding internal transfers", () => {
    const values = Object.freeze([
      transaction("1", "2024-03-31", 0),
      transaction("2", "2024-01-01", 1000, "income", null),
      transaction("3", "2024-01-02", -100),
      transaction("4", "2024-01-03", 25), // Refund is cash in.
      transaction("5", "2024-01-04", -5, "income", null), // Income reversal is cash out.
      transaction("6", "2024-01-05", -2000, "transfer", null),
      transaction("7", "2024-01-05", 2000, "transfer", null),
      transaction("8", "2024-01-01", -50, "expense", "food", "JPY"),
      transaction("9", "2023-12-31", 500),
      transaction("10", "2024-04-01", 600),
    ]);
    expect(cashFlowByMonth(values, range)).toEqual([
      { month: "2024-01", currency: "GBP", inflow: 1025, outflow: 105, net: 920 },
      { month: "2024-01", currency: "JPY", inflow: 0, outflow: 50, net: -50 },
      { month: "2024-03", currency: "GBP", inflow: 0, outflow: 0, net: 0 },
    ]);
    expect(cashFlowByMonth([], range)).toEqual([]);
    expect(cashFlowByMonth([transaction("1", "2024-01-01", 10, "transfer", null)], range)).toEqual(
      [],
    );
  });

  it("rejects unsafe gross totals even if net cash flow fits", () => {
    const max = Number.MAX_SAFE_INTEGER;
    for (const amounts of [
      [max, -max, 1],
      [-max, max, -1],
    ]) {
      rejects(
        () =>
          cashFlowByMonth(
            amounts.map((minor, i) => transaction(`${i}`, "2024-01-01", minor)),
            range,
          ),
        "overflow",
      );
    }
  });
});

describe("report input validation", () => {
  const reports = [
    (values: readonly Transaction[], range: Period) => spendByCategory(values, categories, range),
    cashFlowByMonth,
  ];

  it("validates periods and exact Gregorian dates even with no data", () => {
    for (const report of reports) {
      for (const value of [
        "0000-01-01",
        "2023-02-29",
        "2024-02-30",
        "2024-13-01",
        "2024-00-01",
        "2024-01-00",
        "2024-1-01",
        "bad",
        "2024-01-01T00:00:00Z",
        "+010000-01-01",
        null,
      ]) {
        rejects(() => report([], { ...range, start: invalid(value) }), "invalid-date");
        rejects(() => report([], { ...range, end: invalid(value) }), "invalid-date");
      }
      rejects(() => report([], { start: "2024-03-02", end: "2024-03-01" }), "invalid-period");
      rejects(() => report([], invalid(null)), "invalid-input");
      expect(report([], { start: "0001-01-01", end: "9999-12-31" })).toEqual([]);
    }
  });

  it("rejects malformed and duplicate transactions before filtering, including transfers", () => {
    const tx = transaction("1", "2023-12-31", 1);
    for (const report of reports) {
      for (const values of [
        null,
        {},
        [null],
        new Array<Transaction>(1),
        [{ ...tx, id: "" }],
        [{ ...tx, kind: "other" }],
        [{ ...tx, categoryId: "" }],
        [{ ...tx, kind: "income" }],
        [{ ...tx, categoryId: undefined }],
      ]) {
        rejects(() => report(invalid(values), range), "invalid-input");
      }
      rejects(() => report([tx, tx], range), "duplicate");
      rejects(() => report([{ ...tx, date: "2023-02-29" }], range), "invalid-date");
      rejects(
        () => report([{ ...tx, amount: invalid({ currency: "GBP", minor: 1.5 }) }], range),
        "invalid-amount",
      );
      rejects(
        () =>
          report(
            [
              {
                ...tx,
                kind: "transfer",
                categoryId: null,
                amount: invalid({ currency: "ZZZ", minor: 0 }),
              },
            ],
            range,
          ),
        "unsupported-currency",
      );
    }
  });
});

describe("net worth from balances", () => {
  it("samples the latest balance on/before each date, including liabilities and separate currencies", () => {
    const history = Object.freeze([
      balance("https://example.org/accounts/savings", "2024-02-29", 1500),
      balance("https://example.org/accounts/savings", "2023-12-31", 1000),
      balance("loan", "2023-12-31", -300),
      balance("loan", "2024-03-01", -200),
      balance("yen", "2023-12-31", 10000, "JPY"),
      balance("yen", "2024-04-01", 9000, "JPY"),
      balance("constructor", "2023-12-31", 0),
    ]);
    const samples = Object.freeze(["2024-03-31", "2024-01-01", "2024-02-29"]);
    expect(netWorthSeries(history, samples)).toEqual([
      { date: "2024-01-01", totals: [money("GBP", 700), money("JPY", 10000)] },
      { date: "2024-02-29", totals: [money("GBP", 1200), money("JPY", 10000)] },
      { date: "2024-03-31", totals: [money("GBP", 1300), money("JPY", 10000)] },
    ]);
    expect(history[0]?.date).toBe("2024-02-29");
    expect(samples[0]).toBe("2024-03-31");
  });

  it("handles no accounts or samples, zero and negative worth, and boundary years", () => {
    expect(netWorthSeries([], [])).toEqual([]);
    expect(netWorthSeries([], ["2024-01-01"])).toEqual([{ date: "2024-01-01", totals: [] }]);
    expect(
      netWorthSeries([balance("loan", "0001-01-01", -10)], ["0001-01-01", "9999-12-31"]),
    ).toEqual([
      { date: "0001-01-01", totals: [money("GBP", -10)] },
      { date: "9999-12-31", totals: [money("GBP", -10)] },
    ]);
    expect(
      netWorthSeries(
        [balance("a", "2024-01-01", 10), balance("b", "2024-01-01", -10)],
        ["2024-01-01"],
      ),
    ).toEqual([{ date: "2024-01-01", totals: [money("GBP", 0)] }]);
  });

  it("rejects unknown baselines rather than assuming zero", () => {
    rejects(
      () => netWorthSeries([balance("a", "2024-01-02", 10)], ["2024-01-01"]),
      "missing-balance",
    );
    rejects(
      () =>
        netWorthSeries(
          [balance("a", "2024-01-01", 10), balance("new-account", "2024-01-02", 20)],
          ["2024-01-01"],
        ),
      "missing-balance",
    );
  });

  it("rejects ambiguous snapshots, currency changes, malformed input and overflow", () => {
    const b = balance("a", "2024-01-01", 10);
    rejects(() => netWorthSeries([b, b], []), "duplicate");
    rejects(() => netWorthSeries([], ["2024-01-01", "2024-01-01"]), "duplicate");
    rejects(
      () => netWorthSeries([b, balance("a", "2024-02-01", 10, "USD")], []),
      "currency-mismatch",
    );
    for (const values of [null, [null], [{ ...b, accountId: " " }]]) {
      rejects(() => netWorthSeries(invalid(values), []), "invalid-input");
    }
    rejects(() => netWorthSeries([], invalid(null)), "invalid-input");
    rejects(() => netWorthSeries([], ["2024-02-30"]), "invalid-date");
    rejects(() => netWorthSeries([{ ...b, date: "2024-02-30" }], []), "invalid-date");
    rejects(() => netWorthSeries([{ ...b, balance: invalid(null) }], []), "invalid-input");
    rejects(
      () =>
        netWorthSeries(
          [balance("a", "2024-01-01", Number.MAX_SAFE_INTEGER), balance("b", "2024-01-01", 1)],
          ["2024-01-01"],
        ),
      "overflow",
    );
  });
});
