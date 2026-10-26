// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addMoney,
  BudgetError,
  type BudgetErrorCode,
  type Currency,
  formatMoney,
  groupMoney,
  MINOR_UNITS,
  type Money,
  minorUnits,
  money,
  multiplyMoney,
  parseMoney,
  subtractMoney,
} from "../src/apps/money/lib/budget";

function rejects(fn: () => unknown, code: BudgetErrorCode) {
  expect(fn).toThrowError(expect.objectContaining({ name: "BudgetError", code }));
}

describe("integer minor-unit money", () => {
  it("declares the supported ISO subset and freezes its table", () => {
    expect(MINOR_UNITS).toEqual({ AUD: 2, CAD: 2, CHF: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3, USD: 2 });
    expect(Object.isFrozen(MINOR_UNITS)).toBe(true);
    for (const currency of Object.keys(MINOR_UNITS) as Currency[]) {
      expect(minorUnits(currency)).toBe(MINOR_UNITS[currency]);
    }
    for (const currency of [
      "",
      "usd",
      "BTC",
      "XXX",
      "constructor",
      "toString",
      "__proto__",
      null,
    ]) {
      rejects(() => money(currency as string, 1), "unsupported-currency");
    }
  });

  it.each([
    ["USD", "12.34", 1234, "12.34"],
    ["GBP", "-0.01", -1, "-0.01"],
    ["EUR", "1.2", 120, "1.20"],
    ["JPY", "-123", -123, "-123"],
    ["JPY", "0", 0, "0"],
    ["KWD", "-1.234", -1234, "-1.234"],
    ["KWD", "0.001", 1, "0.001"],
    ["USD", "-0.00", 0, "0.00"],
    ["USD", "90071992547409.91", Number.MAX_SAFE_INTEGER, "90071992547409.91"],
    ["USD", "-90071992547409.91", -Number.MAX_SAFE_INTEGER, "-90071992547409.91"],
  ])("parses and formats %s %s exactly", (currency, decimal, minor, formatted) => {
    const result = parseMoney(currency, decimal);
    expect(result).toEqual({ currency, minor });
    expect(formatMoney(result)).toBe(formatted);
  });

  it("rejects precision loss, coercion and non-decimal notations", () => {
    for (const decimal of [
      "1e2",
      "NaN",
      "Infinity",
      "+1",
      ".1",
      "1.",
      "01",
      " 1",
      "1 ",
      "1,23",
      "",
      "--1",
      "1\n",
      1,
      null,
    ]) {
      rejects(() => parseMoney("USD", decimal as string), "invalid-amount");
    }
    for (const [currency, decimal] of [
      ["JPY", "1.0"],
      ["USD", "0.001"],
      ["KWD", "0.0001"],
    ]) {
      rejects(() => parseMoney(currency!, decimal!), "invalid-amount");
    }
    rejects(() => parseMoney("USD", "90071992547409.92"), "overflow");
    rejects(() => parseMoney("USD", "-90071992547409.92"), "overflow");
    rejects(() => parseMoney("USD", "9".repeat(400)), "overflow");
    rejects(() => parseMoney("ZZZ", "1"), "unsupported-currency");
    for (const minor of [
      NaN,
      Infinity,
      -Infinity,
      0.1,
      1.01,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      null,
      undefined,
    ]) {
      rejects(() => money("USD", minor as number), "invalid-amount");
    }
    expect(Object.is(money("USD", -0).minor, -0)).toBe(false);
    expect(new BudgetError("invalid-input")).toBeInstanceOf(Error);
  });

  it("adds, subtracts and multiplies signed amounts without mutating inputs", () => {
    const a = Object.freeze(money("USD", 100));
    const b = Object.freeze(money("USD", -30));
    expect(addMoney(a, b)).toEqual(money("USD", 70));
    expect(subtractMoney(a, b)).toEqual(money("USD", 130));
    expect(multiplyMoney(b, -3)).toEqual(money("USD", 90));
    expect(multiplyMoney(b, 0)).toEqual(money("USD", 0));
    expect(multiplyMoney(a, 1)).toEqual(a);
    expect(a.minor).toBe(100);
    for (const operation of [addMoney, subtractMoney]) {
      rejects(() => operation(a, money("EUR", 1)), "currency-mismatch");
      rejects(() => operation(a, { currency: "USD", minor: NaN }), "invalid-amount");
    }
    for (const multiplier of [0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      rejects(() => multiplyMoney(a, multiplier), "invalid-amount");
    }
    const max = money("USD", Number.MAX_SAFE_INTEGER);
    rejects(() => addMoney(max, money("USD", 1)), "overflow");
    rejects(
      () => subtractMoney(money("USD", -Number.MAX_SAFE_INTEGER), money("USD", 1)),
      "overflow",
    );
    rejects(() => multiplyMoney(max, 2), "overflow");
  });

  it("groups currencies and preserves zero buckets", () => {
    expect(
      groupMoney([money("USD", 10), money("JPY", 5), money("USD", -10), money("KWD", 12)]),
    ).toEqual([money("JPY", 5), money("KWD", 12), money("USD", 0)]);
    expect(groupMoney([])).toEqual([]);
    rejects(() => groupMoney([money("USD", Number.MAX_SAFE_INTEGER), money("USD", 1)]), "overflow");
    rejects(() => groupMoney(null as unknown as Money[]), "invalid-input");
    rejects(() => groupMoney(new Array<Money>(1)), "invalid-input");
    for (const value of [null, undefined, [], 3, "USD"]) {
      rejects(() => formatMoney(value as Money), "invalid-input");
    }
    rejects(() => formatMoney({ currency: "XXX", minor: 1 } as Money), "unsupported-currency");
  });

  it("round trips arbitrary safe minor units and agrees with integer arithmetic", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(MINOR_UNITS) as Currency[])),
        fc.maxSafeInteger(),
        (currency, minor) => {
          const value = money(currency, minor);
          expect(parseMoney(currency, formatMoney(value))).toEqual(value);
          expect(subtractMoney(value, value)).toEqual(money(currency, 0));
        },
      ),
    );
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(addMoney(money("EUR", a), money("EUR", b)).minor).toBe(
          Number(BigInt(a) + BigInt(b)),
        );
        expect(multiplyMoney(money("EUR", a), 7).minor).toBe(Number(BigInt(a) * BigInt(7)));
      }),
    );
  });
});
