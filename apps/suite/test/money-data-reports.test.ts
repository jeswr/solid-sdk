// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  buildReport,
  presetPeriods,
  REPORT_PRESETS,
  reportCurrencies,
  reportRows,
  storedMoney,
  supportedCurrency,
} from "../src/apps/money/lib/data/reports";
import type { Category, Transaction } from "../src/apps/money/lib/model";

const B = "https://alice.example/money/";
const categories: Category[] = [
  { id: `${B}food`, label: "Food" },
  { id: `${B}groceries`, label: "Groceries", parent: `${B}food` },
  { id: `${B}veg`, label: "Veg box", parent: `${B}groceries` },
  { id: `${B}fun`, label: "Fun" },
  { id: `${B}loop-a`, label: "Loop A", parent: `${B}loop-b` },
  { id: `${B}loop-b`, label: "Loop B", parent: `${B}loop-a` },
  { id: `${B}orphan`, label: "Orphan", parent: `${B}missing` },
];
let n = 0;
function tx(date: string, amount: string, extra: Partial<Transaction> = {}): Transaction {
  n += 1;
  return {
    id: `${B}t${n}`,
    account: `${B}current`,
    postingTime: `${date}T12:00:00Z`,
    description: `row ${n}`,
    amount,
    currency: "GBP",
    ...extra,
  };
}

describe("presetPeriods", () => {
  it("compares month-to-date with the same days last month, clamped to its length", () => {
    expect(presetPeriods("month", "2026-11-14")).toEqual({
      current: { start: "2026-11-01", end: "2026-11-14" },
      previous: { start: "2026-10-01", end: "2026-10-14" },
    });
    expect(presetPeriods("month", "2026-03-31")).toEqual({
      current: { start: "2026-03-01", end: "2026-03-31" },
      previous: { start: "2026-02-01", end: "2026-02-28" },
    });
    expect(presetPeriods("month", "2026-01-31").previous).toEqual({
      start: "2025-12-01",
      end: "2025-12-31",
    });
  });
  it("covers last month, rolling 90 days and year to date", () => {
    expect(presetPeriods("last-month", "2026-03-05")).toEqual({
      current: { start: "2026-02-01", end: "2026-02-28" },
      previous: { start: "2026-01-01", end: "2026-01-31" },
    });
    expect(presetPeriods("90-days", "2026-11-01")).toEqual({
      current: { start: "2026-08-04", end: "2026-11-01" },
      previous: { start: "2026-05-06", end: "2026-08-03" },
    });
    expect(presetPeriods("year", "2028-02-29")).toEqual({
      current: { start: "2028-01-01", end: "2028-02-29" },
      previous: { start: "2027-01-01", end: "2027-02-28" },
    });
  });
  it("lists every preset with a comparison label", () => {
    expect(REPORT_PRESETS.map((preset) => preset.id)).toEqual([
      "month",
      "last-month",
      "90-days",
      "year",
    ]);
    for (const preset of REPORT_PRESETS) {
      const { current, previous } = presetPeriods(preset.id, "2026-11-01");
      expect(previous.end < current.start).toBe(true);
    }
  });
});

describe("reportRows", () => {
  const rows = [
    tx("2026-11-02", "-10.00", { category: `${B}veg` }),
    tx("2026-11-02", "2000", { category: `${B}food` }),
    tx("2026-11-03", "-350", { debitAccount: `${B}savings` }),
    tx("2026-11-03", "350", { creditAccount: `${B}current` }),
    tx("2026-11-04", "-5", { category: `${B}deleted` }),
    tx("2026-11-04", "-5", { currency: "EUR" }),
    tx("2026-11-05", "-1", { category: `${B}loop-a` }),
    tx("2026-11-05", "-1", { category: `${B}orphan` }),
  ];
  it("classifies transfers, income and expenses and drops other currencies", () => {
    expect(reportRows(rows, categories, "GBP").map((row) => [row.kind, row.categoryId])).toEqual([
      ["expense", `${B}veg`],
      ["income", null],
      ["transfer", null],
      ["transfer", null],
      ["expense", null],
      ["expense", `${B}loop-a`],
      ["expense", `${B}orphan`],
    ]);
  });
  it("rolls categories up to their top-level ancestor, tolerating cycles and orphans", () => {
    expect(reportRows(rows, categories, "GBP", true).map((row) => row.categoryId)).toEqual([
      `${B}food`,
      null,
      null,
      null,
      null,
      `${B}loop-a`,
      `${B}orphan`,
    ]);
  });
});

describe("buildReport", () => {
  const rows = [
    // October 1-14 (comparison for November month-to-date)
    tx("2026-10-03", "1000"),
    tx("2026-10-05", "-40", { category: `${B}groceries` }),
    // October after the 14th is outside the comparison window
    tx("2026-10-20", "-999", { category: `${B}fun` }),
    // November
    tx("2026-11-01", "1500"),
    tx("2026-11-02", "-60", { category: `${B}groceries` }),
    tx("2026-11-03", "-25.50", { category: `${B}veg` }),
    tx("2026-11-04", "-20", { category: `${B}fun` }),
    tx("2026-11-05", "-20"),
    tx("2026-11-06", "-100", { debitAccount: `${B}savings` }),
  ];
  it("totals the period against the comparison period", () => {
    const report = buildReport(rows, categories, "GBP", "month", "2026-11-14");
    expect(report.income).toEqual({
      amount: "1500.00",
      previous: "1000.00",
      change: "500.00",
      percent: 50,
    });
    expect(report.expense).toEqual({
      amount: "125.50",
      previous: "40.00",
      change: "85.50",
      percent: 214,
    });
    expect(report.net.percent).toBe(43);
    expect(report.months).toEqual([{ month: "2026-11", amount: "125.50", minor: 12550, days: 14 }]);
  });
  it("orders categories by spend with shares of spending", () => {
    const report = buildReport(rows, categories, "GBP", "month", "2026-11-14");
    expect(report.categories.map((row) => [row.label, row.amount])).toEqual([
      ["Groceries", "60.00"],
      ["Veg box", "25.50"],
      ["Fun", "20.00"],
      ["Uncategorised", "20.00"],
    ]);
    expect(report.categories[0]?.share).toBeCloseTo(60 / 125.5);
    const rolled = buildReport(rows, categories, "GBP", "month", "2026-11-14", { rollUp: true });
    expect(rolled.categories.map((row) => [row.label, row.amount])).toEqual([
      ["Food", "85.50"],
      ["Fun", "20.00"],
      ["Uncategorised", "20.00"],
    ]);
  });
  it("fills empty months, rounds negative changes and handles a zero baseline", () => {
    const report = buildReport(
      [tx("2026-09-10", "-30", { category: `${B}fun` }), tx("2026-07-01", "-90")],
      categories,
      "GBP",
      "90-days",
      "2026-11-01",
    );
    expect(report.months.map((row) => [row.month, row.amount])).toEqual([
      ["2026-08", "0.00"],
      ["2026-09", "30.00"],
      ["2026-10", "0.00"],
      ["2026-11", "0.00"],
    ]);
    expect(report.expense.percent).toBe(-67);
    expect(report.income.percent).toBeNull();
  });
  it("gives categories no share when nothing was spent", () => {
    const zero = buildReport(
      [tx("2026-11-02", "-0.00", { category: `${B}fun` })],
      [{ id: `${B}fun`, label: "Fun" }],
      "GBP",
      "month",
      "2026-11-14",
    );
    expect(zero.categories).toEqual([
      { id: `${B}fun`, label: "Fun", amount: "0.00", minor: 0, share: 0 },
    ]);
  });
});

describe("exact amounts", () => {
  it("drops trailing zeros beyond the currency's minor units but rejects finer amounts", () => {
    expect(storedMoney("GBP", "10.500")).toEqual({ currency: "GBP", minor: 1050 });
    expect(storedMoney("GBP", "-4.5")).toEqual({ currency: "GBP", minor: -450 });
    expect(storedMoney("JPY", "1000.00")).toEqual({ currency: "JPY", minor: 1000 });
    expect(storedMoney("JPY", "-7")).toEqual({ currency: "JPY", minor: -7 });
    expect(storedMoney("BHD", "1.2340")).toEqual({ currency: "BHD", minor: 1234 });
    expect(() => storedMoney("GBP", "-4.999")).toThrow();
    expect(() => storedMoney("BTC", "1")).toThrow();
  });
  it("skips rows it can't represent and reports how many", () => {
    const rows = [
      tx("2026-11-02", "-4.999"),
      tx("2026-11-02", "-10.500"),
      tx("2026-11-03", "-2", { debitAccount: `${B}x`, amount: "-1.001" }),
    ];
    const skipped: string[] = [];
    expect(
      reportRows(rows, categories, "GBP", false, skipped).map((row) => row.amount.minor),
    ).toEqual([-1050]);
    expect(skipped).toEqual([rows[0]?.id, rows[2]?.id]);
    const report = buildReport(rows, categories, "GBP", "month", "2026-11-14");
    expect(report.skipped).toBe(2);
    expect(report.expense.amount).toBe("10.50");
  });
  it("reports zero-decimal currencies in whole units", () => {
    const report = buildReport(
      [tx("2026-11-02", "-1500", { currency: "JPY" })],
      categories,
      "JPY",
      "last-month",
      "2026-12-05",
    );
    expect(report.months).toEqual([{ month: "2026-11", amount: "1500", minor: 1500 }]);
  });
  it("knows which currencies the exact library supports", () => {
    expect(supportedCurrency("GBP")).toBe(true);
    expect(supportedCurrency("BTC")).toBe(false);
  });
});

describe("reportCurrencies", () => {
  it("orders currencies by use", () => {
    expect(
      reportCurrencies(
        [{ currency: "EUR" }, { currency: "GBP" }],
        [tx("2026-11-01", "1"), tx("2026-11-01", "1", { currency: "USD" })],
      ),
    ).toEqual(["GBP", "EUR", "USD"]);
    expect(
      reportCurrencies([{ currency: "BTC" }], [tx("2026-11-01", "1", { currency: "BTC" })]),
    ).toEqual([]);
    expect(reportCurrencies([], [])).toEqual([]);
  });
});
