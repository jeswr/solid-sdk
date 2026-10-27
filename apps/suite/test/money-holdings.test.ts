// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  computeHoldings,
  HoldingsError,
  type HoldingsErrorCode,
  type HoldingsOptions,
  type InvestmentTransaction,
  MAX_CURRENCY_MINOR_UNITS,
  MAX_QUANTITY_DECIMALS,
  MAX_SIGNIFICANT_DIGITS,
  MAX_TRANSACTION_ID_LENGTH,
  MAX_TRANSACTIONS,
} from "../src/apps/money/lib/holdings";
import {
  ExactArithmetic,
  MAX_ARITHMETIC_BITS,
  MAX_ARITHMETIC_WORK,
} from "../src/apps/money/lib/holdings/exact";

const settings: HoldingsOptions = Object.freeze({
  method: "fifo",
  currency: "USD",
  minorUnits: Object.freeze({ USD: 2, JPY: 0, KWD: 3, CLF: 4 }),
  currentPrice: "20",
});

function entry(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: "buy",
    date: "2026-01-01",
    kind: "buy",
    currency: "USD",
    quantity: "1",
    price: "10",
    fee: "0",
    ...overrides,
  } as InvestmentTransaction;
}

function split(
  ratio: string,
  overrides: Partial<InvestmentTransaction> = {},
): InvestmentTransaction {
  return entry({
    id: "split",
    date: "2026-01-02",
    kind: "split",
    quantity: "0",
    price: "0",
    ratio,
    ...overrides,
  });
}

function fails(run: () => unknown, code: HoldingsErrorCode) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HoldingsError);
    expect(error).toMatchObject({
      name: "HoldingsError",
      code,
      message: `Investment holdings: ${code}`,
    });
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("arithmetic resource bounds", () => {
  const one = BigInt(1);
  const maximum = (one << BigInt(MAX_ARITHMETIC_BITS)) - one;

  it("accepts the internal size bound and rejects oversized operands, sums and products", () => {
    const arithmetic = new ExactArithmetic();
    expect(arithmetic.fraction(maximum)).toEqual({ numerator: maximum, denominator: one });
    expect(arithmetic.fraction(-maximum)).toEqual({ numerator: -maximum, denominator: one });
    expect(arithmetic.product(maximum, one)).toBe(maximum);
    expect(arithmetic.product(-maximum, -one)).toBe(maximum);
    expect(arithmetic.sum(maximum - one, one)).toBe(maximum);
    expect(arithmetic.multiply(arithmetic.fraction(one), BigInt(2))).toEqual({
      numerator: BigInt(2),
      denominator: one,
    });
    for (const oversized of [maximum + one, -maximum - one]) {
      fails(() => arithmetic.fraction(oversized), "VALUE_TOO_LARGE");
      fails(() => arithmetic.product(one, oversized), "VALUE_TOO_LARGE");
      fails(() => arithmetic.fraction(one, oversized), "VALUE_TOO_LARGE");
    }
    fails(() => arithmetic.product(maximum, BigInt(2)), "VALUE_TOO_LARGE");
    fails(() => arithmetic.product(-maximum, BigInt(2)), "VALUE_TOO_LARGE");
    fails(() => arithmetic.sum(maximum, one), "VALUE_TOO_LARGE");
    fails(() => arithmetic.sum(-maximum, -one), "VALUE_TOO_LARGE");
  });

  it("accepts exactly the work budget and rejects the next product or GCD step", () => {
    const arithmetic = new ExactArithmetic();
    const words = Math.ceil(MAX_ARITHMETIC_BITS / 64);
    const steps = MAX_ARITHMETIC_WORK / (words * words);
    expect(Number.isInteger(steps)).toBe(true);
    for (let index = 0; index < steps; index++) {
      expect(arithmetic.fraction(maximum, maximum)).toEqual({ numerator: one, denominator: one });
    }
    fails(() => arithmetic.product(one, one), "VALUE_TOO_LARGE");
    fails(() => arithmetic.fraction(one), "VALUE_TOO_LARGE");
    // A fresh call gets its own budget; a long GCD must also charge every iteration.
    const fresh = new ExactArithmetic();
    for (let index = 0; index < steps - 1; index++) fresh.fraction(maximum, maximum);
    fails(() => fresh.fraction(maximum, maximum - one), "VALUE_TOO_LARGE");
    expect(new ExactArithmetic().fraction(maximum, maximum - one)).toEqual({
      numerator: maximum,
      denominator: maximum - one,
    });
  });

  it.each([
    "fifo",
    "average",
  ] as const)("bounds exponentially growing split quantities with %s", (method) => {
    const history = [entry({ price: "0" })];
    for (let index = 0; index < 50; index++) {
      history.push(split(`${"9".repeat(30)}:1`, { id: `split-${String(index).padStart(3, "0")}` }));
    }
    const options = { ...settings, method, currentPrice: "0" };
    expect(computeHoldings(history.slice(0, 11), options).costBasis).toBe("0.00");
    fails(() => computeHoldings(history, options), "VALUE_TOO_LARGE");
    expect(computeHoldings([entry()], options).quantity).toBe("1");
  });

  it("bounds fraction growth from repeated average-cost sales and zero-price buys", () => {
    const history = [entry({ quantity: "2", price: "0.01" })];
    for (let index = 0; index < 2500; index++) {
      const prefix = String(index).padStart(4, "0");
      history.push(
        entry({ id: `${prefix}-a-sell`, date: "2026-01-02", kind: "sell", price: "0" }),
        entry({ id: `${prefix}-b-buy`, date: "2026-01-02", price: "0" }),
      );
    }
    const options = { ...settings, method: "average" as const };
    expect(computeHoldings(history.slice(0, 21), options).openLots[0]?.exactCostBasis).toEqual({
      numerator: one,
      denominator: BigInt(512),
    });
    fails(() => computeHoldings(history, options), "VALUE_TOO_LARGE");
  });

  it("bounds cumulative split traversal even when each intermediate value fits", () => {
    const component = "9".repeat(30);
    const history = Array.from({ length: 256 }, (_, index) =>
      entry({ id: `buy-${index}`, quantity: component, price: "0" }),
    );
    // Grow quantities safely, then repeat identity splits: only work accumulates.
    for (let index = 0; index < 522; index++) {
      history.push(
        split(`${component}:${index < 10 ? "1" : component}`, {
          id: `split-${String(index).padStart(3, "0")}`,
        }),
      );
    }
    fails(() => computeHoldings(history, { ...settings, currentPrice: "0" }), "VALUE_TOO_LARGE");
  });
});

describe("investment lots", () => {
  it("returns explicit currency zeros for an empty history", () => {
    expect(computeHoldings([], settings)).toEqual({
      currency: "USD",
      method: "fifo",
      quantity: "0",
      openLots: [],
      realisedGains: [],
      costBasis: "0.00",
      marketValue: "0.00",
      unrealisedGain: "0.00",
      dividendIncome: "0.00",
      standaloneFees: "0.00",
    });
  });

  it("uses FIFO, adds buy fees, subtracts sale fees and consumes several lots", () => {
    const result = computeHoldings(
      [
        entry({ id: "first", quantity: "10", price: "10", fee: "2" }),
        entry({ id: "second", date: "2026-01-02", quantity: "5", price: "15", fee: "1" }),
        entry({
          id: "sale",
          date: "2026-01-03",
          kind: "sell",
          quantity: "12",
          price: "20",
          fee: "3",
        }),
      ],
      settings,
    );
    expect(result).toMatchObject({
      quantity: "3",
      costBasis: "45.60",
      marketValue: "60.00",
      unrealisedGain: "14.40",
    });
    expect(result.openLots).toEqual([
      {
        id: "second",
        date: "2026-01-02",
        quantity: "3",
        costBasis: "45.60",
        exactCostBasis: { numerator: BigInt(4560), denominator: BigInt(1) },
        unitCost: { numerator: BigInt(1520), denominator: BigInt(1) },
      },
    ]);
    expect(result.realisedGains).toEqual([
      {
        id: "sale",
        date: "2026-01-03",
        quantity: "12",
        proceeds: "237.00",
        costBasis: "132.40",
        gain: "104.60",
      },
    ]);
  });

  it("pools average cost including fees, without losing fractional basis on repeated sales", () => {
    const history = [
      entry({ id: "first", quantity: "2", price: "10", fee: "1" }),
      entry({ id: "second", date: "2026-01-02", quantity: "1", price: "20" }),
      entry({
        id: "sale1",
        date: "2026-01-03",
        kind: "sell",
        quantity: "1",
        price: "20",
        fee: "1",
      }),
      entry({ id: "third", date: "2026-01-04", quantity: "1", price: "10" }),
      entry({ id: "sale2", date: "2026-01-05", kind: "sell", quantity: "1", price: "20" }),
    ];
    const result = computeHoldings(history, { ...settings, method: "average" });
    expect(result.realisedGains.map((sale) => [sale.costBasis, sale.gain])).toEqual([
      ["13.67", "5.33"],
      ["12.44", "7.56"],
    ]);
    expect(result.openLots).toEqual([
      {
        id: "first",
        date: "2026-01-01",
        quantity: "2",
        costBasis: "24.89",
        exactCostBasis: { numerator: BigInt(22400), denominator: BigInt(9) },
        unitCost: { numerator: BigInt(11200), denominator: BigInt(9) },
      },
    ]);
    expect(result.unrealisedGain).toBe("15.11");
    const fifo = computeHoldings(history, settings);
    expect(fifo.realisedGains.map((sale) => sale.costBasis)).toEqual(["10.50", "10.50"]);
  });

  it.each(["fifo", "average"] as const)("empties and restarts lots with %s", (method) => {
    const first = [
      entry({ quantity: "2" }),
      entry({ id: "sell", date: "2026-01-02", kind: "sell", quantity: "2", price: "9" }),
    ];
    const empty = computeHoldings(first, { ...settings, method });
    expect(empty).toMatchObject({
      quantity: "0",
      openLots: [],
      costBasis: "0.00",
      unrealisedGain: "0.00",
    });
    expect(empty.realisedGains[0]?.gain).toBe("-2.00");
    const restarted = computeHoldings(
      [...first, entry({ id: "new", date: "2026-01-03", quantity: "0.00000001", price: "0" })],
      { ...settings, method },
    );
    expect(restarted.openLots[0]).toMatchObject({
      id: "new",
      quantity: "0.00000001",
      costBasis: "0.00",
    });
    expect(restarted.quantity).toBe("0.00000001");
  });

  it("sorts by date then UTF-16 id independently of input order, including fee-only dates", () => {
    const history = [
      entry({ id: "Z", quantity: "1", price: "5" }),
      entry({ id: "a", quantity: "1", price: "7" }),
      entry({ id: "z", kind: "sell", quantity: "1", price: "10" }),
      entry({ id: "later", date: "2026-01-03", quantity: "1" }),
      entry({ id: "early", date: "2025-12-31", quantity: "1", price: "1" }),
    ];
    const expected = computeHoldings(history, settings);
    expect(expected.realisedGains[0]?.costBasis).toBe("1.00");
    expect(expected.openLots.map((lot) => lot.id)).toEqual(["Z", "a", "later"]);
    for (const permutation of [
      history.toReversed(),
      [history[3]!, history[1]!, history[4]!, history[0]!, history[2]!],
    ]) {
      expect(computeHoldings(permutation, settings)).toEqual(expected);
    }
  });

  it("keeps caller records unchanged and creates independent results", () => {
    const history = Object.freeze([
      Object.freeze(entry({ id: "https://example.org/securities/fictional/buy" })),
    ]);
    const snapshot = structuredClone(history);
    const first = computeHoldings(history, settings);
    (first.openLots[0]!.exactCostBasis as { numerator: bigint }).numerator = BigInt(999);
    expect(computeHoldings(history, settings).costBasis).toBe("10.00");
    expect(history).toEqual(snapshot);
    expect(
      computeHoldings([Object.assign(Object.create(null), entry())], {
        ...settings,
        minorUnits: Object.assign(Object.create(null), { USD: 2 }),
      }).costBasis,
    ).toBe("10.00");
  });

  it("reports cash dividends net of fees and standalone fees separately from capital gains", () => {
    const result = computeHoldings(
      [
        entry(),
        entry({ id: "dividend", kind: "dividend", quantity: "0", price: "2.50", fee: "0.10" }),
        entry({ id: "fee", kind: "fee", quantity: "0", price: "0", fee: "0.70" }),
        entry({ id: "dividend2", kind: "dividend", quantity: "0", price: "0", fee: "0.20" }),
      ],
      settings,
    );
    expect(result).toMatchObject({
      quantity: "1",
      costBasis: "10.00",
      dividendIncome: "2.20",
      standaloneFees: "0.70",
      realisedGains: [],
    });
  });
});

describe("splits and rounding", () => {
  it.each([
    "fifo",
    "average",
  ] as const)("preserves exact cost through forward/reverse splits with %s", (method) => {
    const buys = [
      entry({ quantity: "2", price: "1", fee: "0.01" }),
      entry({ id: "second", quantity: "4", price: "2" }),
    ];
    const before = computeHoldings(buys, { ...settings, method });
    const forward = computeHoldings([...buys, split("3:2")], { ...settings, method });
    expect(forward.quantity).toBe("9");
    expect(forward.costBasis).toBe(before.costBasis);
    expect(forward.openLots[0]?.unitCost).toEqual(
      method === "fifo"
        ? { numerator: BigInt(67), denominator: BigInt(1) }
        : { numerator: BigInt(1001), denominator: BigInt(9) },
    );
    const reversed = computeHoldings(
      [...buys, split("3:2"), split("2:3", { id: "reverse", date: "2026-01-03" })],
      { ...settings, method },
    );
    expect(reversed).toEqual(before);
    const sold = computeHoldings(
      [
        ...buys,
        split("3:2"),
        entry({ id: "sale", date: "2026-01-03", kind: "sell", quantity: "3", price: "1" }),
      ],
      { ...settings, method },
    );
    expect(sold.realisedGains[0]?.costBasis).toBe(method === "fifo" ? "2.01" : "3.34");
    expect(computeHoldings([split("2:1")], { ...settings, method }).quantity).toBe("0");
  });

  it("retains repeating per-unit cost and allocates reporting remainder to the oldest lot", () => {
    const history = [
      entry({ id: "a", quantity: "1", price: "0.01" }),
      entry({ id: "b", quantity: "0.5", price: "0.01" }),
      entry({ id: "c", quantity: "0.5", price: "0.01" }),
      split("3:1"),
      entry({ id: "sale", date: "2026-01-03", kind: "sell", quantity: "1", price: "0.01" }),
    ];
    const result = computeHoldings(history, settings);
    expect(result.openLots.map((lot) => lot.costBasis)).toEqual(["0.02", "0.00", "0.00"]);
    expect(result.costBasis).toBe("0.02");
    expect(result.openLots[0]?.exactCostBasis).toEqual({
      numerator: BigInt(2),
      denominator: BigInt(3),
    });
    expect(result.openLots[0]?.unitCost).toEqual({ numerator: BigInt(1), denominator: BigInt(3) });
    const all = computeHoldings(
      [
        ...history,
        entry({ id: "all", date: "2026-01-04", kind: "sell", quantity: "5", price: "0.01" }),
      ],
      settings,
    );
    expect(all.costBasis).toBe("0.00");
    expect(all.realisedGains[1]).toMatchObject({ costBasis: "0.02", gain: "0.03" });
  });

  it.each([
    ["0.5", "0.01", "0.00"],
    ["1.5", "0.01", "0.02"],
    ["0.4", "0.01", "0.00"],
    ["0.6", "0.01", "0.01"],
    ["1", "0.01", "0.01"],
  ])("half-even rounds final money for quantity %s at price %s", (quantity, price, expected) => {
    const result = computeHoldings([entry({ quantity, price: "0" })], {
      ...settings,
      currentPrice: price,
    });
    expect(result.marketValue).toBe(expected);
    expect(result.unrealisedGain).toBe(expected);
  });

  it.each([
    ["0.5", "0.00"],
    ["1.5", "-0.02"],
    ["0.6", "-0.01"],
    ["0.4", "0.00"],
  ])("rounds negative gains symmetrically for %s", (quantity, gain) => {
    const result = computeHoldings(
      [
        entry({ quantity, price: "0.01" }),
        entry({ id: "sale", date: "2026-01-02", kind: "sell", quantity, price: "0" }),
      ],
      settings,
    );
    expect(result.realisedGains[0]?.gain).toBe(gain);
    expect(
      computeHoldings([entry({ quantity, price: "0.01" })], { ...settings, currentPrice: "0" })
        .unrealisedGain,
    ).toBe(gain);
  });

  it("rounds gain from exact values, not the rounded proceeds and basis", () => {
    const result = computeHoldings(
      [
        entry({ quantity: "0.5", price: "0.01" }),
        entry({ id: "sale", date: "2026-01-02", kind: "sell", quantity: "0.5", price: "0.02" }),
      ],
      settings,
    );
    expect(result.realisedGains[0]).toMatchObject({
      proceeds: "0.01",
      costBasis: "0.00",
      gain: "0.00",
    });
    const open = computeHoldings([entry({ quantity: "0.5", price: "0.01" })], {
      ...settings,
      currentPrice: "0.02",
    });
    expect(open).toMatchObject({ marketValue: "0.01", costBasis: "0.00", unrealisedGain: "0.00" });
    const negativeProceeds = computeHoldings(
      [entry(), entry({ id: "sale", kind: "sell", date: "2026-01-02", price: "0", fee: "1" })],
      settings,
    );
    expect(negativeProceeds.realisedGains[0]).toMatchObject({ proceeds: "-1.00", gain: "-11.00" });
  });

  it.each([
    ["JPY", 0, "2", "1"],
    ["USD", 2, "0.02", "0.01"],
    ["KWD", 3, "0.002", "0.001"],
    ["CLF", 4, "0.0002", "0.0001"],
  ])("obeys the supplied %s precision (%i)", (currency, _digits, price, fee) => {
    const result = computeHoldings([entry({ currency, quantity: "1.5", price, fee })], {
      ...settings,
      currency,
      currentPrice: price,
    });
    expect(result.costBasis).toBe(
      currency === "JPY"
        ? "4"
        : currency === "USD"
          ? "0.04"
          : currency === "KWD"
            ? "0.004"
            : "0.0004",
    );
    expect(result.unrealisedGain).toBe(`-${fee}`);
  });
});

describe("fail-closed validation and limits", () => {
  it.each([
    "fifo",
    "average",
  ] as const)("rejects overselling at any point with %s, including after splits", (method) => {
    for (const history of [
      [entry({ kind: "sell" })],
      [entry(), entry({ id: "sale", kind: "sell", date: "2026-01-02", quantity: "1.00000001" })],
      [entry({ kind: "sell", id: "a" }), entry({ id: "z" })],
      [entry(), split("1:2"), entry({ id: "sale", kind: "sell", date: "2026-01-03" })],
      [
        entry(),
        entry({ id: "sale", kind: "sell", date: "2026-01-02" }),
        entry({ id: "again", kind: "sell", date: "2026-01-03" }),
      ],
    ])
      fails(() => computeHoldings(history, { ...settings, method }), "OVERSOLD");
  });

  it("rejects mixed currencies even on non-trade events and explicit empty-input currency mismatches", () => {
    for (const kind of ["buy", "sell", "dividend", "fee"] as const) {
      fails(
        () => computeHoldings([entry(), entry({ id: "foreign", kind, currency: "EUR" })], settings),
        "CURRENCY_MISMATCH",
      );
    }
    fails(
      () => computeHoldings([split("1:1", { currency: "EUR" })], settings),
      "CURRENCY_MISMATCH",
    );
    fails(() => computeHoldings([entry()], { ...settings, currency: "JPY" }), "CURRENCY_MISMATCH");
  });

  it("rejects malformed and non-string amounts in every decimal field", () => {
    for (const value of [
      "",
      " ",
      " 1",
      "1 ",
      "1\n",
      "1e2",
      "+1",
      "-1",
      "-0",
      ".5",
      "1.",
      "01",
      "00.1",
      "1,2",
      "NaN",
      "Infinity",
      "0x10",
      "1/2",
      1,
      null,
      undefined,
      BigInt(1),
    ]) {
      for (const field of ["quantity", "price", "fee"] as const) {
        fails(
          () => computeHoldings([entry({ [field]: value } as never)], settings),
          "INVALID_AMOUNT",
        );
      }
      fails(
        () => computeHoldings([], { ...settings, currentPrice: value as string }),
        "INVALID_AMOUNT",
      );
    }
    for (const field of ["price", "fee"] as const) {
      fails(() => computeHoldings([entry({ [field]: "1.000" })], settings), "INVALID_AMOUNT");
    }
    fails(() => computeHoldings([], { ...settings, currentPrice: "1.000" }), "INVALID_AMOUNT");
    fails(
      () =>
        computeHoldings([entry({ currency: "JPY", price: "1.0" })], {
          ...settings,
          currency: "JPY",
        }),
      "INVALID_AMOUNT",
    );
  });

  it("accepts eight quantity decimals and rejects nine, including trailing zeroes", () => {
    expect(MAX_QUANTITY_DECIMALS).toBe(8);
    expect(computeHoldings([entry({ quantity: "0.00000001" })], settings).quantity).toBe(
      "0.00000001",
    );
    fails(() => computeHoldings([entry({ quantity: "0.000000001" })], settings), "INVALID_AMOUNT");
    fails(() => computeHoldings([entry({ quantity: "1.000000000" })], settings), "INVALID_AMOUNT");
  });

  it("accepts 30 significant digits and rejects 31 for every value and split component", () => {
    expect(MAX_SIGNIFICANT_DIGITS).toBe(30);
    const bound = "9".repeat(MAX_SIGNIFICANT_DIGITS);
    const over = "9".repeat(MAX_SIGNIFICANT_DIGITS + 1);
    for (const field of ["quantity", "price", "fee"] as const) {
      expect(computeHoldings([entry({ [field]: bound })], settings).openLots).toHaveLength(1);
      fails(() => computeHoldings([entry({ [field]: over })], settings), "VALUE_TOO_LARGE");
    }
    expect(computeHoldings([], { ...settings, currentPrice: bound }).marketValue).toBe("0.00");
    fails(() => computeHoldings([], { ...settings, currentPrice: over }), "VALUE_TOO_LARGE");
    expect(computeHoldings([entry(), split(`${bound}:${bound}`)], settings).quantity).toBe("1");
    for (const ratio of [`${over}:1`, `1:${over}`, `${over}:${over}`]) {
      fails(() => computeHoldings([split(ratio)], settings), "VALUE_TOO_LARGE");
    }
    // Leading fractional zeroes do not consume significant digits; fractional
    // trailing zeroes do, even when the coefficient happens to be an integer.
    expect(computeHoldings([entry({ price: "0.01" })], settings).costBasis).toBe("0.01");
    expect(
      computeHoldings([entry({ price: `${"9".repeat(28)}.99` })], settings).openLots,
    ).toHaveLength(1);
    fails(
      () => computeHoldings([entry({ price: `${"9".repeat(29)}.99` })], settings),
      "VALUE_TOO_LARGE",
    );
  });

  it("checks string size before scanning or BigInt parsing", () => {
    const huge = "9".repeat(100_000);
    for (const field of ["quantity", "price", "fee"] as const) {
      fails(() => computeHoldings([entry({ [field]: huge })], settings), "VALUE_TOO_LARGE");
    }
    fails(() => computeHoldings([], { ...settings, currentPrice: huge }), "VALUE_TOO_LARGE");
    fails(() => computeHoldings([split(`${huge}:1`)], settings), "VALUE_TOO_LARGE");
  });

  it("accepts the exported maximum currency exponent and rejects bound+1", () => {
    expect(MAX_CURRENCY_MINOR_UNITS).toBe(30);
    const options = {
      ...settings,
      minorUnits: { USD: MAX_CURRENCY_MINOR_UNITS },
      currentPrice: `0.${"0".repeat(29)}1`,
    };
    expect(computeHoldings([entry({ price: options.currentPrice })], options).costBasis).toBe(
      options.currentPrice,
    );
    fails(
      () => computeHoldings([], { ...options, minorUnits: { USD: MAX_CURRENCY_MINOR_UNITS + 1 } }),
      "VALUE_TOO_LARGE",
    );
  });

  it("accepts exactly 50,000 transactions and rejects 50,001 before reading any entry or options", () => {
    expect(MAX_TRANSACTIONS).toBe(50_000);
    const history = Array.from({ length: MAX_TRANSACTIONS }, (_, index) =>
      entry({ id: `buy-${String(index).padStart(5, "0")}`, quantity: "0.00000001", price: "0.01" }),
    );
    const result = computeHoldings(history, settings);
    expect(result.openLots).toHaveLength(MAX_TRANSACTIONS);
    expect(result.quantity).toBe("0.0005");
    const oversized = new Array(MAX_TRANSACTIONS + 1);
    Object.defineProperty(oversized, "0", {
      get() {
        throw new Error("must not inspect oversized input");
      },
    });
    fails(() => computeHoldings(oversized, null as never), "VALUE_TOO_LARGE");
  });

  it("rejects malformed, nonpositive or inexact splits without silently rounding shares", () => {
    for (const ratio of [
      "",
      "0:1",
      "1:0",
      "-1:2",
      "1:-2",
      "0:0",
      "1.5:1",
      "1:1.5",
      "01:1",
      "1:01",
      "1/2",
      "1",
      "1:2:3",
      " 1:2",
      "1:2\n",
      2,
      null,
      undefined,
    ]) {
      fails(() => computeHoldings([split(ratio as string)], settings), "INVALID_SPLIT");
    }
    fails(
      () => computeHoldings([entry({ quantity: "0.00000001" }), split("1:2")], settings),
      "INVALID_SPLIT",
    );
    // An exactly representable aggregate is insufficient when an individual lot
    // would lose precision (two lots of 1e-8 cannot each be halved).
    fails(
      () =>
        computeHoldings(
          [
            entry({ quantity: "0.00000001" }),
            entry({ id: "other", quantity: "0.00000001" }),
            split("1:2"),
          ],
          settings,
        ),
      "INVALID_SPLIT",
    );
    for (const field of ["quantity", "price", "fee"] as const) {
      fails(() => computeHoldings([split("1:1", { [field]: "1" })], settings), "INVALID_SPLIT");
    }
  });

  it("rejects zero trade quantities and conflicting cash-event fields", () => {
    for (const kind of ["buy", "sell"] as const) {
      fails(() => computeHoldings([entry({ kind, quantity: "0" })], settings), "INVALID_AMOUNT");
    }
    for (const kind of ["dividend", "fee"] as const) {
      fails(() => computeHoldings([entry({ kind })], settings), "INVALID_AMOUNT");
    }
    fails(
      () => computeHoldings([entry({ kind: "fee", quantity: "0", price: "1" })], settings),
      "INVALID_AMOUNT",
    );
    fails(
      () => computeHoldings([{ ...entry(), ratio: "1:1" }] as never, settings),
      "INVALID_INPUT",
    );
  });

  it("rejects invalid methods, currencies, tables and option shapes including unused precision", () => {
    for (const options of [
      null,
      [],
      new Date(),
      {},
      { ...settings, extra: true },
      { ...settings, method: "lifo" },
      { ...settings, method: null },
      { ...settings, currency: "usd" },
      { ...settings, currency: "US" },
      { ...settings, currency: 123 },
      { ...settings, minorUnits: {} },
      { ...settings, minorUnits: null },
      { ...settings, minorUnits: { USD: -1 } },
      { ...settings, minorUnits: { USD: 1.5 } },
      { ...settings, minorUnits: { USD: "2" } },
      { ...settings, minorUnits: { USD: NaN } },
      { ...settings, minorUnits: { USD: Infinity } },
      { ...settings, minorUnits: { USD: 2, eur: 2 } },
    ]) {
      fails(() => computeHoldings([], options as never), "INVALID_INPUT");
    }
    fails(
      () => computeHoldings([], { ...settings, minorUnits: { USD: 2, EUR: 31 } }),
      "VALUE_TOO_LARGE",
    );
  });

  it("rejects malformed records, accessors, hidden/symbol keys and custom prototypes", () => {
    for (const value of [
      null,
      undefined,
      [],
      new Date(),
      { ...entry(), extra: true },
      { ...entry(), [Symbol("field")]: 1 },
      Object.create(entry()),
      Object.defineProperty(entry(), "price", {
        get() {
          throw new Error("must not read accessor");
        },
      }),
      Object.defineProperty(entry(), "price", { value: "1", enumerable: false }),
    ]) {
      fails(() => computeHoldings([value] as never, settings), "INVALID_INPUT");
    }
    fails(
      () =>
        computeHoldings(
          [],
          Object.defineProperty({ ...settings }, "currentPrice", {
            get() {
              throw new Error("must not read accessor");
            },
          }),
        ),
      "INVALID_INPUT",
    );
    fails(
      () => computeHoldings([], { ...settings, minorUnits: Object.create({ USD: 2 }) }),
      "INVALID_INPUT",
    );
  });

  it("rejects nonarrays, sparse arrays, extra array fields and accessor elements", () => {
    for (const input of [
      null,
      undefined,
      {},
      "transactions",
      Array(1),
      [undefined],
      Object.assign([], { extra: true }),
      Object.assign([], { "4294967295": true }),
      Object.defineProperty([entry()], "0", {
        get() {
          throw new Error("must not read accessor");
        },
      }),
      Object.defineProperty([entry()], "0", { enumerable: false }),
      Object.setPrototypeOf([], null),
      Object.assign([], { [Symbol("extra")]: true }),
    ]) {
      fails(() => computeHoldings(input as never, settings), "INVALID_INPUT");
    }
  });

  it("rejects malformed or duplicate identifiers, dates, kinds and currencies", () => {
    for (const id of ["", " x", "x ", 0, null])
      fails(() => computeHoldings([entry({ id: id as string })], settings), "INVALID_INPUT");
    fails(() => computeHoldings([entry(), entry()], settings), "INVALID_INPUT");
    for (const date of [
      "",
      "2026-1-01",
      "2026-01-01T00:00:00Z",
      "0000-01-01",
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
      "2026-00-01",
      "2026-01-32",
      "2026-01-00",
      1,
      null,
    ]) {
      fails(() => computeHoldings([entry({ date: date as string })], settings), "INVALID_INPUT");
    }
    expect(computeHoldings([entry({ date: "2024-02-29" })], settings).openLots[0]?.date).toBe(
      "2024-02-29",
    );
    for (const kind of ["BUY", "transfer", null])
      fails(() => computeHoldings([entry({ kind } as never)], settings), "INVALID_INPUT");
    fails(() => computeHoldings([entry({ currency: "usd" })], settings), "INVALID_INPUT");
    // Validating the whole history precedes replay, even after an oversold row.
    fails(
      () =>
        computeHoldings([entry({ kind: "sell" }), entry({ id: "later", date: "bad" })], settings),
      "INVALID_INPUT",
    );
  });

  it("bounds transaction ID length before trimming, hashing or sorting", () => {
    expect(MAX_TRANSACTION_ID_LENGTH).toBe(1024);
    const id = "x".repeat(MAX_TRANSACTION_ID_LENGTH);
    expect(computeHoldings([entry({ id })], settings).quantity).toBe("1");
    fails(() => computeHoldings([entry({ id: `${id}x` })], settings), "INVALID_INPUT");
    fails(() => computeHoldings([entry({ id: " ".repeat(1_000_000) })], settings), "INVALID_INPUT");
  });
});
