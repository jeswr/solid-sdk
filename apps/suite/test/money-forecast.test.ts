// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import {
  type DateRange,
  detectRecurring,
  expandRecurring,
  type ForecastAccount,
  ForecastError,
  type ForecastErrorCode,
  type ForecastTransaction,
  forecastBalances,
  type Recurrence,
  type RecurringTemplate,
  upcomingBills,
} from "../src/apps/money/lib/forecast";
import * as recurrence from "../src/apps/money/lib/forecast/recurrence";

const checking = "https://example.org/money/checking";
const savings = "https://example.org/money/savings";
const period = { start: "2026-01-01", end: "2026-01-31" };
function template(overrides: Partial<RecurringTemplate> = {}): RecurringTemplate {
  return {
    id: "rent",
    accountId: checking,
    currency: "GBP",
    payee: "Fictional Willow Housing",
    amount: -10000,
    startDate: "2026-01-01",
    recurrence: { frequency: "monthly", day: 1 },
    ...overrides,
  };
}
function tx(overrides: Partial<ForecastTransaction> = {}): ForecastTransaction {
  return {
    id: "one-off",
    accountId: checking,
    currency: "GBP",
    payee: "Fictional Orchard Shop",
    amount: -100,
    date: "2026-01-01",
    ...overrides,
  };
}
function account(overrides: Partial<ForecastAccount> = {}): ForecastAccount {
  return { id: checking, currency: "GBP", openingBalance: 20000, ...overrides };
}
function dates(item: RecurringTemplate, window: DateRange = period): string[] {
  return expandRecurring([item], window).map((value) => value.date);
}
function fails(run: () => unknown, code: ForecastErrorCode): void {
  expect(run).toThrow(ForecastError);
  expect(run).toThrow(expect.objectContaining({ code, name: "ForecastError" }));
}
function rawTemplate(value: unknown, code: ForecastErrorCode = "invalid-input"): void {
  fails(() => expandRecurring([value as RecurringTemplate], period), code);
}
function history(
  dates: readonly string[],
  overrides: Partial<ForecastTransaction> = {},
): ForecastTransaction[] {
  return dates.map((date, i) => tx({ id: `history-${i}`, date, ...overrides }));
}
const exact = { amountTolerance: 0 };

describe("recurring templates", () => {
  it("expands weekly and biweekly from the anchor, including range endpoints", () => {
    const weekly = template({ startDate: "2025-12-25", recurrence: { frequency: "weekly" } });
    expect(dates(weekly)).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
      "2026-01-22",
      "2026-01-29",
    ]);
    expect(
      dates(template({ startDate: "2026-01-03", recurrence: { frequency: "biweekly" } })),
    ).toEqual(["2026-01-03", "2026-01-17", "2026-01-31"]);
    expect(dates(weekly, { start: "2026-01-08", end: "2026-01-08" })).toEqual(["2026-01-08"]);
    expect(dates(weekly, { start: "2026-01-09", end: "2026-01-09" })).toEqual([]);
  });

  it("handles monthly numeric days without clamping and explicit last days", () => {
    const window = { start: "2024-01-01", end: "2024-05-31" };
    expect(
      dates(
        template({ startDate: window.start, recurrence: { frequency: "monthly", day: 31 } }),
        window,
      ),
    ).toEqual(["2024-01-31", "2024-03-31", "2024-05-31"]);
    expect(
      dates(
        template({ startDate: window.start, recurrence: { frequency: "monthly", day: "last" } }),
        window,
      ),
    ).toEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31"]);
    expect(
      dates(template({ recurrence: { frequency: "monthly", day: "last" } }), {
        start: "2026-02-01",
        end: "2026-02-28",
      }),
    ).toEqual(["2026-02-28"]);
    expect(
      dates(template({ startDate: "2026-01-16", recurrence: { frequency: "monthly", day: 15 } })),
    ).toEqual([]);
  });

  it("expands yearly dates across leap years, centuries and year boundaries", () => {
    expect(
      dates(template({ startDate: "2024-02-29", recurrence: { frequency: "yearly" } }), {
        start: "2024-01-01",
        end: "2032-02-29",
      }),
    ).toEqual(["2024-02-29", "2028-02-29", "2032-02-29"]);
    expect(
      dates(template({ startDate: "0001-12-31", recurrence: { frequency: "yearly" } }), {
        start: "0001-01-01",
        end: "0003-01-01",
      }),
    ).toEqual(["0001-12-31", "0002-12-31"]);
    expect(
      dates(template({ startDate: "2096-02-29", recurrence: { frequency: "yearly" } }), {
        start: "2099-01-01",
        end: "2104-02-29",
      }),
    ).toEqual(["2104-02-29"]);
    expect(
      dates(
        template({ startDate: "9999-12-01", recurrence: { frequency: "monthly", day: "last" } }),
        { start: "9999-12-31", end: "9999-12-31" },
      ),
    ).toEqual(["9999-12-31"]);
  });

  it("applies start/end bounds and validates inactive templates", () => {
    expect(dates(template({ endDate: "2026-01-08", recurrence: { frequency: "weekly" } }))).toEqual(
      ["2026-01-01", "2026-01-08"],
    );
    expect(dates(template({ startDate: "2027-01-01" }))).toEqual([]);
    expect(
      dates(template({ endDate: "2026-01-01" }), { start: "2026-02-01", end: "2026-02-02" }),
    ).toEqual([]);
    rawTemplate(template({ endDate: "2025-12-31" }), "invalid-range");
    rawTemplate({ ...template(), endDate: undefined }, "invalid-date");
  });

  it("returns sorted fresh occurrences and only outflows as bills", () => {
    const input = Object.freeze([
      Object.freeze(template({ id: "z" })),
      Object.freeze(template({ id: "a" })),
      template({ id: "salary", amount: 50000 }),
      template({ id: "zero", amount: 0 }),
    ]);
    const result = expandRecurring(input, period);
    expect(result.map((item) => item.templateId)).toEqual(["a", "salary", "z", "zero"]);
    expect(result[0]).toEqual({
      templateId: "a",
      accountId: checking,
      currency: "GBP",
      payee: "Fictional Willow Housing",
      amount: -10000,
      date: "2026-01-01",
    });
    expect(upcomingBills(input, period).map((item) => item.templateId)).toEqual(["a", "z"]);
    expect(expandRecurring([], period)).toEqual([]);
    expect(upcomingBills([], period)).toEqual([]);
    expect(result[0]).not.toBe(expandRecurring(input, period)[0]);
    expect(input[0]!.id).toBe("z");
    const ordered = expandRecurring(
      [template({ id: "same", recurrence: { frequency: "weekly" } })],
      period,
    );
    expect(ordered.map((item) => item.date)).toEqual([...ordered.map((item) => item.date)].sort());
  });

  it("keeps civil dates stable through DST boundaries", () => {
    expect(
      dates(template({ startDate: "2026-03-22", recurrence: { frequency: "weekly" } }), {
        start: "2026-03-22",
        end: "2026-04-05",
      }),
    ).toEqual(["2026-03-22", "2026-03-29", "2026-04-05"]);
  });
});

describe("daily account forecasts", () => {
  it("combines templates and one-offs with inclusive daily closing balances", () => {
    const window = { start: "2026-01-01", end: "2026-01-03" };
    const accounts = Object.freeze([
      Object.freeze(account({ id: savings, currency: "JPY", openingBalance: -50 })),
      Object.freeze(account()),
    ]);
    const transactions = Object.freeze([
      Object.freeze(tx()),
      tx({ id: "income", amount: 1000 }),
      tx({ id: "end", amount: -50, date: window.end }),
      tx({ id: "before", amount: 999999, date: "2025-12-31" }),
      tx({ id: "after", amount: 999999, date: "2026-01-04" }),
    ]);
    const result = forecastBalances(accounts, [template()], transactions, window);
    expect(result).toEqual([
      { accountId: checking, currency: "GBP", date: "2026-01-01", change: -9100, balance: 10900 },
      { accountId: checking, currency: "GBP", date: "2026-01-02", change: 0, balance: 10900 },
      { accountId: checking, currency: "GBP", date: "2026-01-03", change: -50, balance: 10850 },
      ...["2026-01-01", "2026-01-02", "2026-01-03"].map((date) => ({
        accountId: savings,
        currency: "JPY",
        date,
        change: 0,
        balance: -50,
      })),
    ]);
    expect(accounts[0]!.id).toBe(savings);
    expect(transactions[0]!.amount).toBe(-100);
    expect(forecastBalances([], [], [], window)).toEqual([]);
    expect(
      forecastBalances([account()], [], [], { start: window.start, end: window.start })[0]!.balance,
    ).toBe(20000);
    const savingTx = tx({ accountId: savings, currency: "JPY", amount: -5 });
    expect(forecastBalances(accounts, [], [savingTx], window)[3]!.balance).toBe(-55);
  });

  it("accumulates exactly before conversion and rejects unsafe results", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const window = { start: period.start, end: period.start };
    const net = [
      tx({ amount: max }),
      tx({ id: "extra", amount: max }),
      tx({ id: "cancel", amount: -max }),
    ];
    expect(forecastBalances([account({ openingBalance: 0 })], [], net, window)[0]!.balance).toBe(
      max,
    );
    fails(() => forecastBalances([account()], [], [tx({ amount: max })], window), "overflow");
    fails(
      () => forecastBalances([account({ openingBalance: 0 })], [], net.slice(0, 2), window),
      "overflow",
    );
    fails(
      () => forecastBalances([account({ openingBalance: -max })], [], [tx({ amount: -1 })], window),
      "overflow",
    );
  });

  it("validates account scope and currency even outside the window", () => {
    fails(
      () => forecastBalances([], [template({ startDate: "2027-01-01" })], [], period),
      "unknown-account",
    );
    fails(() => forecastBalances([], [], [tx({ date: "2027-01-01" })], period), "unknown-account");
    fails(
      () =>
        forecastBalances(
          [account()],
          [template({ currency: "EUR", startDate: "2027-01-01" })],
          [],
          period,
        ),
      "currency-mismatch",
    );
    fails(
      () => forecastBalances([account()], [], [tx({ currency: "EUR" })], period),
      "currency-mismatch",
    );
    fails(() => forecastBalances([account(), account()], [], [], period), "duplicate-id");
    fails(() => forecastBalances([account()], [], [tx(), tx()], period), "duplicate-id");
  });
});

describe("likely recurring history", () => {
  it.each([
    ["0001-01-01", "0001-01-08", "9999-12-31"],
    ["0001-01-01", "0001-01-02", "9999-12-31"],
    ["0001-01-01", "0001-01-01", "9999-12-31"],
  ])("stops failed candidates early across a long span: %j, %j, %j", (...dates) => {
    const matches = recurrence.matches;
    let checks = 0;
    const spy = vi.spyOn(recurrence, "matches").mockImplementation((date, start, rule) => {
      // Bound work deterministically; a regression must fail before scanning millennia.
      expect(++checks).toBeLessThanOrEqual(2000);
      expect(date <= "0002-01-01").toBe(true);
      return matches(date, start, rule);
    });
    try {
      expect(detectRecurring(history(dates), exact)).toEqual([]);
      expect(checks).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it.each<[Recurrence, string[]]>([
    [{ frequency: "weekly" }, ["2026-01-01", "2026-01-08", "2026-01-15"]],
    [{ frequency: "biweekly" }, ["2025-12-25", "2026-01-08", "2026-01-22"]],
    [{ frequency: "monthly", day: 15 }, ["2026-01-15", "2026-02-15", "2026-03-15"]],
    [{ frequency: "monthly", day: "last" }, ["2024-01-31", "2024-02-29", "2024-03-31"]],
    [{ frequency: "monthly", day: 31 }, ["2026-01-31", "2026-03-31", "2026-05-31"]],
    [{ frequency: "yearly" }, ["2024-06-10", "2025-06-10", "2026-06-10"]],
    [{ frequency: "yearly" }, ["2024-02-29", "2028-02-29", "2032-02-29"]],
  ])("detects %j from unsorted history", (recurrence, dates) => {
    const input = Object.freeze(
      history(dates)
        .reverse()
        .map((item) => Object.freeze(item)),
    );
    const result = detectRecurring(input, exact);
    expect(result).toEqual([
      {
        accountId: checking,
        currency: "GBP",
        payee: "Fictional Orchard Shop",
        amount: -100,
        startDate: dates[0],
        lastDate: dates[2],
        recurrence,
        transactionIds: ["history-0", "history-1", "history-2"],
      },
    ]);
    expect(input[0]!.date).toBe(dates[2]);
  });

  it("uses explicit absolute tolerance, latest amount, and whole-group spread", () => {
    const input = history(["2026-01-01", "2026-01-08", "2026-01-15"]);
    input[1] = tx({ ...input[1]!, amount: -110 });
    input[2] = tx({ ...input[2]!, amount: -90 });
    expect(detectRecurring(input, { amountTolerance: 20 })[0]!.amount).toBe(-90);
    expect(detectRecurring(input, { amountTolerance: 19 })).toEqual([]);
    expect(detectRecurring(input, exact)).toEqual([]);
  });

  it("requires three observations and exact uninterrupted calendar intervals", () => {
    expect(detectRecurring([], exact)).toEqual([]);
    expect(detectRecurring([tx(), tx({ id: "two" })], exact)).toEqual([]);
    for (const dates of [
      ["2026-01-01", "2026-01-08", "2026-01-16"],
      ["2026-01-01", "2026-01-08", "2026-01-22"],
      ["2026-01-01", "2026-01-01", "2026-01-08"],
      ["2024-01-01", "2025-01-01", "2027-01-01"],
    ])
      expect(detectRecurring(history(dates), exact)).toEqual([]);
    const extreme = history(["2026-01-01", "2026-01-08", "2026-01-15"], {
      amount: -Number.MAX_SAFE_INTEGER,
    });
    extreme[1] = tx({ ...extreme[1]!, amount: -1 });
    expect(detectRecurring(extreme, { amountTolerance: Number.MAX_SAFE_INTEGER - 2 })).toEqual([]);
  });

  it("separates exact payees, accounts, signs and currencies, ignoring zero amounts", () => {
    const dates = ["2026-01-01", "2026-01-08", "2026-01-15"];
    const a = history(dates);
    const b = history(dates, { accountId: savings, currency: "USD" }).map((item) => ({
      ...item,
      id: `b-${item.id}`,
    }));
    const c = history(dates, { payee: "Fictional Aster Books", amount: 100 }).map((item) => ({
      ...item,
      id: `c-${item.id}`,
    }));
    const d = history(dates, { amount: 100 }).map((item) => ({ ...item, id: `d-${item.id}` }));
    const zero = tx({ id: "zero", amount: 0 });
    const result = detectRecurring([...b, ...d, ...a, ...c, zero], exact);
    expect(result.map((item) => [item.accountId, item.payee, item.amount])).toEqual([
      [checking, "Fictional Aster Books", 100],
      [checking, "Fictional Orchard Shop", -100],
      [checking, "Fictional Orchard Shop", 100],
      [savings, "Fictional Orchard Shop", -100],
    ]);
    expect(detectRecurring(history(dates, { amount: 0 }), exact)).toEqual([]);
    expect(
      detectRecurring([a[0]!, { ...a[1]!, payee: "fictional orchard shop" }, a[2]!], exact),
    ).toEqual([]);
    fails(
      () => detectRecurring([tx(), tx({ id: "foreign", currency: "EUR" })], exact),
      "currency-mismatch",
    );
    fails(() => detectRecurring([tx(), tx()], exact), "duplicate-id");
    const snapshot = detectRecurring(a, exact);
    (snapshot[0]!.recurrence as { frequency: string }).frequency = "yearly";
    expect(detectRecurring(a, exact)[0]!.recurrence.frequency).toBe("weekly");
  });
});

describe("fail-closed validation", () => {
  it("rejects malformed records, prototypes, accessors, hidden and unknown fields", () => {
    for (const value of [
      null,
      [],
      1,
      new Date(),
      Object.create({}),
      { ...template(), extra: true },
      { ...template(), [Symbol("hidden")]: true },
      Object.defineProperty(template(), "payee", {
        get() {
          throw new Error("must not run");
        },
        enumerable: true,
      }),
      Object.defineProperty(template(), "amount", { value: 1, enumerable: false }),
    ])
      rawTemplate(value);
    const plain = Object.assign(Object.create(null), template());
    expect(expandRecurring([plain], period)).toHaveLength(1);
    for (const value of ["", " ", " padded", "padded ", 1, null]) {
      rawTemplate({ ...template(), id: value });
      rawTemplate({ ...template(), accountId: value });
      rawTemplate({ ...template(), payee: value });
    }
    for (const value of ["gbp", "GB", "GBP ", null, 1])
      rawTemplate({ ...template(), currency: value });
  });

  it("rejects non-integer/unsafe monetary values and invalid detection options", () => {
    for (const value of [0.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "100", null]) {
      rawTemplate({ ...template(), amount: value }, "invalid-amount");
      fails(
        () => forecastBalances([account({ openingBalance: value as number })], [], [], period),
        "invalid-amount",
      );
      fails(() => detectRecurring([], { amountTolerance: value as number }), "invalid-amount");
    }
    fails(() => detectRecurring([], { amountTolerance: -1 }), "invalid-amount");
    fails(() => detectRecurring([], null as never), "invalid-input");
    fails(() => detectRecurring([], { amountTolerance: 0, extra: true } as never), "invalid-input");
    expect(dates(template({ amount: -0 }))).toHaveLength(1);
  });

  it("rejects malformed/nonexistent dates and reversed ranges even without activity", () => {
    for (const value of [
      "0000-01-01",
      "2026-2-01",
      "2026-02-30",
      "2026-13-01",
      "2026-00-01",
      "2026-01-00",
      "2100-02-29",
      "2026-01-01T00:00:00Z",
      "10000-01-01",
      null,
      1,
    ]) {
      rawTemplate({ ...template(), startDate: value }, "invalid-date");
      fails(() => expandRecurring([], { start: value as string, end: period.end }), "invalid-date");
      fails(
        () => forecastBalances([], [], [tx({ date: value as string })], period),
        "invalid-date",
      );
    }
    fails(() => expandRecurring([], { start: period.end, end: period.start }), "invalid-range");
    fails(() => expandRecurring([], { start: period.start, end: "bad" }), "invalid-date");
    fails(() => expandRecurring([], null as never), "invalid-input");
    fails(() => expandRecurring([template(), template()], period), "duplicate-id");
  });

  it("rejects unsupported recurrence fields and values rather than changing their meaning", () => {
    for (const recurrence of [
      null,
      {},
      { frequency: "daily" },
      { frequency: "weekly", day: 1 },
      { frequency: "yearly", month: 5 },
      { frequency: "monthly" },
      ...[0, 32, 1.5, "15", "LAST", null].map((day) => ({ frequency: "monthly", day })),
    ])
      rawTemplate(
        { ...template(), recurrence },
        recurrence === null || (recurrence && "month" in recurrence)
          ? "invalid-input"
          : "invalid-recurrence",
      );
  });

  it("rejects invalid and sparse arrays at each boundary", () => {
    const accessor = Object.defineProperty([tx()], "0", {
      get() {
        throw new Error("must not run");
      },
    });
    for (const input of [null, {}, new Array(1), accessor]) {
      fails(() => expandRecurring(input as never, period), "invalid-input");
      fails(() => forecastBalances(input as never, [], [], period), "invalid-input");
      fails(() => forecastBalances([], [], input as never, period), "invalid-input");
      fails(() => detectRecurring(input as never, exact), "invalid-input");
    }
    fails(
      () => forecastBalances([{ ...account(), unknown: 1 } as never], [], [], period),
      "invalid-input",
    );
    fails(
      () => forecastBalances([account()], [], [{ ...tx(), amount: "100" } as never], period),
      "invalid-amount",
    );
    fails(() => detectRecurring([{ ...tx(), extra: 1 } as never], exact), "invalid-input");
  });

  it("keeps private values out of typed error messages", () => {
    try {
      expandRecurring([template({ payee: " Fictional private payee " })], period);
      expect.fail("must reject");
    } catch (error) {
      expect((error as Error).message).toBe("Money forecast: invalid-input");
    }
  });
});
