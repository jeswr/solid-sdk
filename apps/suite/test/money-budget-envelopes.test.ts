// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Allocation,
  type BudgetErrorCode,
  type BudgetMonthInput,
  type BudgetOpening,
  type Currency,
  calculateBudget,
  money,
} from "../src/apps/money/lib/budget";

const opening: BudgetOpening = Object.freeze({ availableToBudget: [], envelopes: [] });
const allocation = (categoryId: string, minor: number, currency: Currency = "GBP"): Allocation => ({
  categoryId,
  amount: money(currency, minor),
});
const input = (month: string, extra: Partial<BudgetMonthInput> = {}): BudgetMonthInput => ({
  month,
  income: [],
  assignments: [],
  activity: [],
  ...extra,
});
const invalid = <T>(value: unknown): T => value as T;
function rejects(fn: () => unknown, code: BudgetErrorCode) {
  expect(fn).toThrowError(expect.objectContaining({ name: "BudgetError", code }));
}

describe("monthly cash envelopes", () => {
  it("carries savings and overspending across year and leap-month boundaries", () => {
    const initial = Object.freeze({
      availableToBudget: Object.freeze([money("GBP", 10000)]),
      envelopes: Object.freeze([allocation("food", 300), allocation("travel", -500)]),
    });
    const months = Object.freeze([
      Object.freeze(
        input("2023-12", {
          income: [money("GBP", 2000)],
          assignments: [allocation("food", 1500), allocation("travel", 200)],
          activity: [
            allocation("food", -1000),
            allocation("food", 100),
            allocation("travel", -100),
          ],
        }),
      ),
      Object.freeze(input("2024-01", { assignments: [allocation("food", -200)] })),
      Object.freeze(input("2024-02", { assignments: [allocation("travel", 500)] })),
      Object.freeze(input("2024-03")),
    ]);
    const result = calculateBudget(months, initial);
    expect(result).toEqual([
      {
        month: "2023-12",
        currencies: [
          {
            currency: "GBP",
            availableToBudget: 10300,
            envelopes: [
              { categoryId: "food", assigned: 1500, activity: -900, rollover: 300, available: 900 },
              {
                categoryId: "travel",
                assigned: 200,
                activity: -100,
                rollover: -500,
                available: -400,
              },
            ],
          },
        ],
      },
      {
        month: "2024-01",
        currencies: [
          {
            currency: "GBP",
            availableToBudget: 10500,
            envelopes: [
              { categoryId: "food", assigned: -200, activity: 0, rollover: 900, available: 700 },
              { categoryId: "travel", assigned: 0, activity: 0, rollover: -400, available: -400 },
            ],
          },
        ],
      },
      {
        month: "2024-02",
        currencies: [
          {
            currency: "GBP",
            availableToBudget: 10000,
            envelopes: [
              { categoryId: "food", assigned: 0, activity: 0, rollover: 700, available: 700 },
              { categoryId: "travel", assigned: 500, activity: 0, rollover: -400, available: 100 },
            ],
          },
        ],
      },
      {
        month: "2024-03",
        currencies: [
          {
            currency: "GBP",
            availableToBudget: 10000,
            envelopes: [
              { categoryId: "food", assigned: 0, activity: 0, rollover: 700, available: 700 },
              { categoryId: "travel", assigned: 0, activity: 0, rollover: 100, available: 100 },
            ],
          },
        ],
      },
    ]);
    // Later months must never mutate earlier result snapshots or caller data.
    expect(months[0]?.assignments[0]?.amount.minor).toBe(1500);
    expect(initial.envelopes[1]?.amount.minor).toBe(-500);
  });

  it("keeps every currency separate, supports new/activity-only envelopes and negative pools", () => {
    expect(
      calculateBudget(
        [
          input("2024-01", {
            income: [money("USD", 500), money("JPY", -10)],
            assignments: [allocation("same", 1000, "USD"), allocation("same", 20, "KWD")],
            activity: [allocation("only-activity", -5, "EUR"), allocation("same", 0, "USD")],
          }),
          input("2024-02"),
        ],
        { availableToBudget: [money("CHF", 40)], envelopes: [allocation("saved", 10, "AUD")] },
      )[0],
    ).toEqual({
      month: "2024-01",
      currencies: [
        {
          currency: "AUD",
          availableToBudget: 0,
          envelopes: [
            { categoryId: "saved", assigned: 0, activity: 0, rollover: 10, available: 10 },
          ],
        },
        { currency: "CHF", availableToBudget: 40, envelopes: [] },
        {
          currency: "EUR",
          availableToBudget: 0,
          envelopes: [
            { categoryId: "only-activity", assigned: 0, activity: -5, rollover: 0, available: -5 },
          ],
        },
        { currency: "JPY", availableToBudget: -10, envelopes: [] },
        {
          currency: "KWD",
          availableToBudget: -20,
          envelopes: [
            { categoryId: "same", assigned: 20, activity: 0, rollover: 0, available: 20 },
          ],
        },
        {
          currency: "USD",
          availableToBudget: -500,
          envelopes: [
            { categoryId: "same", assigned: 1000, activity: 0, rollover: 0, available: 1000 },
          ],
        },
      ],
    });
  });

  it("handles empty input, zero balances, prototype-like IDs and boundary years", () => {
    expect(calculateBudget([], opening)).toEqual([]);
    expect(calculateBudget([input("0001-01"), input("0001-02")], opening)).toEqual([
      { month: "0001-01", currencies: [] },
      { month: "0001-02", currencies: [] },
    ]);
    const end = calculateBudget(
      [
        input("9999-12", {
          assignments: [allocation("constructor", 0), allocation("__proto__", 0, "USD")],
          activity: [allocation("constructor", 0)],
        }),
      ],
      opening,
    );
    expect(end[0]?.currencies.map((c) => c.currency)).toEqual(["GBP", "USD"]);
    expect(end[0]?.currencies[0]?.envelopes[0]?.available).toBe(0);
  });

  it("rejects invalid and nonconsecutive month labels without filling gaps", () => {
    for (const month of [
      "0000-01",
      "2024-00",
      "2024-13",
      "24-01",
      "2024-1",
      "2024-01-01",
      "2024-01\n",
      "bad",
      null,
    ]) {
      rejects(() => calculateBudget([input(invalid(month))], opening), "invalid-date");
    }
    for (const months of [
      ["2024-01", "2024-03"],
      ["2024-02", "2024-01"],
      ["2024-01", "2024-01"],
      ["9999-12", "0001-01"],
    ]) {
      rejects(
        () =>
          calculateBudget(
            months.map((m) => input(m)),
            opening,
          ),
        "nonconsecutive-months",
      );
    }
  });

  it("validates every input and does not erase duplicate opening funds or assignments", () => {
    rejects(() => calculateBudget([], invalid(null)), "invalid-input");
    rejects(() => calculateBudget(invalid(null), opening), "invalid-input");
    rejects(() => calculateBudget([invalid(null)], opening), "invalid-input");
    rejects(
      () => calculateBudget([input("2024-01", { income: invalid({}) })], opening),
      "invalid-input",
    );
    rejects(
      () => calculateBudget([input("2024-01", { activity: invalid([null]) })], opening),
      "invalid-input",
    );
    for (const id of ["", " ", " bad", "bad ", 1, undefined]) {
      rejects(
        () =>
          calculateBudget(
            [
              input("2024-01", {
                assignments: [allocation(invalid(id), 1)],
              }),
            ],
            opening,
          ),
        "invalid-input",
      );
    }
    rejects(
      () =>
        calculateBudget([], {
          ...opening,
          envelopes: [allocation("food", 10), allocation("food", 20)],
        }),
      "duplicate",
    );
    rejects(
      () =>
        calculateBudget(
          [
            input("2024-01", {
              assignments: [allocation("food", 10), allocation("food", 20)],
            }),
          ],
          opening,
        ),
      "duplicate",
    );
    rejects(
      () =>
        calculateBudget(
          [
            input("2024-01", {
              activity: [{ categoryId: "food", amount: invalid({ currency: "GBP", minor: 0.1 }) }],
            }),
          ],
          opening,
        ),
      "invalid-amount",
    );
    expect(
      calculateBudget([], { ...opening, availableToBudget: [money("GBP", 1), money("GBP", 2)] }),
    ).toEqual([]);
  });

  it("fails closed on overflow in income, activity, availability and assignments", () => {
    const max = Number.MAX_SAFE_INTEGER;
    rejects(
      () =>
        calculateBudget([input("2024-01", { income: [money("GBP", 1)] })], {
          ...opening,
          availableToBudget: [money("GBP", max)],
        }),
      "overflow",
    );
    rejects(
      () =>
        calculateBudget([input("2024-01", { activity: [allocation("food", 1)] })], {
          ...opening,
          envelopes: [allocation("food", max)],
        }),
      "overflow",
    );
    rejects(
      () =>
        calculateBudget(
          [
            input("2024-01", {
              activity: [allocation("food", max), allocation("food", 1)],
            }),
          ],
          opening,
        ),
      "overflow",
    );
    rejects(
      () =>
        calculateBudget([input("2024-01", { assignments: [allocation("food", 1)] })], {
          ...opening,
          availableToBudget: [money("GBP", -max)],
        }),
      "overflow",
    );
  });

  it("conserves funds through assignments, refunds, spend and signed rollover", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer(),
        fc.integer(),
        fc.integer(),
        (pool, saved, assigned, activity) => {
          const result = calculateBudget(
            [
              input("2024-01", {
                assignments: [allocation("food", assigned)],
                activity: [allocation("food", activity)],
              }),
              input("2024-02"),
            ],
            { availableToBudget: [money("GBP", pool)], envelopes: [allocation("food", saved)] },
          );
          for (const month of result) {
            const currency = month.currencies[0]!;
            expect(currency.availableToBudget + currency.envelopes[0]!.available).toBe(
              pool + saved + activity,
            );
          }
        },
      ),
    );
  });
});
