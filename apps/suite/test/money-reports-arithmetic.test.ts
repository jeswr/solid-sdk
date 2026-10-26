// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  addMoney,
  convertMoney,
  formatMoney,
  MINOR_UNITS,
  minorUnits,
  money,
  multiplyMoney,
  parseMoney,
  ReportsError,
  type ReportsErrorCode,
  subtractMoney,
} from "../src/apps/money/lib/reports";

function fails(run: () => unknown, code: ReportsErrorCode) {
  expect(run).toThrow(ReportsError);
  expect(run).toThrow(expect.objectContaining({ code }));
}

describe("exact decimal amounts", () => {
  it("uses each supported ISO exponent and round-trips signed boundary values", () => {
    expect(Object.isFrozen(MINOR_UNITS)).toBe(true);
    for (const currency of Object.keys(MINOR_UNITS)) {
      const digits = minorUnits(currency);
      for (const minor of [0, 1, -1, 10, -10, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
        const value = money(currency, minor);
        expect(parseMoney(currency, formatMoney(value))).toEqual(value);
        expect(formatMoney(value)).toMatch(
          new RegExp(digits === 0 ? "^-?\\d+$" : `^-?\\d+\\.\\d{${digits}}$`),
        );
      }
    }
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("USD")).toBe(2);
    expect(minorUnits("KWD")).toBe(3);
    expect(minorUnits("CLF")).toBe(4);
    expect(parseMoney("USD", "0.1")).toEqual(money("USD", 10));
    expect(formatMoney(parseMoney("KWD", "-0.001"))).toBe("-0.001");
    expect(formatMoney(parseMoney("JPY", "-3"))).toBe("-3");
    expect(formatMoney(parseMoney("CLF", "1.2345"))).toBe("1.2345");
    expect(Object.is(parseMoney("USD", "-0.00").minor, -0)).toBe(false);
    expect(Object.is(money("USD", -0).minor, -0)).toBe(false);
  });

  it("adds, subtracts and multiplies without floating-point amount calculations", () => {
    expect(formatMoney(addMoney(parseMoney("USD", "0.1"), parseMoney("USD", "0.2")))).toBe("0.30");
    expect(subtractMoney(money("USD", 1), money("USD", 2))).toEqual(money("USD", -1));
    expect(multiplyMoney(money("USD", -2), -3)).toEqual(money("USD", 6));
    expect(multiplyMoney(money("USD", Number.MAX_SAFE_INTEGER), 0)).toEqual(money("USD", 0));
    expect(
      addMoney(money("USD", Number.MAX_SAFE_INTEGER), money("USD", Number.MIN_SAFE_INTEGER)),
    ).toEqual(money("USD", 0));
    expect(multiplyMoney(money("USD", 1), Number.MAX_SAFE_INTEGER)).toEqual(
      money("USD", Number.MAX_SAFE_INTEGER),
    );
  });

  it("rejects unknown/historical/nonmonetary currencies without guessing an exponent", () => {
    for (const currency of [
      "XXX",
      "XAU",
      "XTS",
      "ZZZ",
      "DEM",
      "usd",
      " USD",
      "USD ",
      "",
      "constructor",
      "toString",
      null,
      123,
    ]) {
      fails(() => minorUnits(currency as string), "unsupported-currency");
    }
  });

  it("rejects malformed, numeric, locale, exponent and overprecision decimals", () => {
    for (const value of [
      "",
      " ",
      " 1",
      "1 ",
      "1e2",
      "+1",
      ".5",
      "1.",
      "01",
      "-01",
      "1,23",
      "NaN",
      "Infinity",
      "--1",
      "0x10",
      "1\n",
      "1".repeat(1025),
      null,
      0.1,
    ]) {
      fails(() => parseMoney("USD", value as string), "invalid-amount");
    }
    fails(() => parseMoney("USD", "1.001"), "invalid-amount");
    fails(() => parseMoney("JPY", "1.0"), "invalid-amount");
    fails(() => parseMoney("KWD", "1.0000"), "invalid-amount");
    fails(() => parseMoney("CLF", "1.00001"), "invalid-amount");
  });

  it("rejects unsafe inputs and overflowing arithmetic in both directions", () => {
    for (const minor of [
      0.1,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      BigInt(1),
      undefined,
    ]) {
      fails(() => money("USD", minor as number), "invalid-amount");
    }
    for (const input of [null, [], false, undefined])
      fails(() => formatMoney(input as never), "invalid-input");
    fails(() => formatMoney({ currency: "USD", minor: 0.1 }), "invalid-amount");
    for (const multiplier of [0.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "2"])
      fails(() => multiplyMoney(money("USD", 2), multiplier as number), "invalid-amount");
    for (const decimal of ["90071992547409.92", "-90071992547409.92", "9".repeat(100)])
      fails(() => parseMoney("USD", decimal), "overflow");
    fails(() => addMoney(money("USD", Number.MAX_SAFE_INTEGER), money("USD", 1)), "overflow");
    fails(() => subtractMoney(money("USD", Number.MIN_SAFE_INTEGER), money("USD", 1)), "overflow");
    fails(() => multiplyMoney(money("USD", Number.MAX_SAFE_INTEGER), 2), "overflow");
    fails(() => multiplyMoney(money("USD", Number.MIN_SAFE_INTEGER), 2), "overflow");
    for (const operation of [addMoney, subtractMoney])
      fails(() => operation(money("USD", 1), money("EUR", 1)), "currency-mismatch");
  });
});

describe("supplied exchange rates", () => {
  const rates = Object.freeze([Object.freeze({ from: "EUR", to: "USD", rate: "1.25" })]);

  it("converts signed and zero amounts exactly, without mutating input", () => {
    const value = Object.freeze(money("EUR", -400));
    expect(convertMoney(value, "USD", rates)).toEqual(money("USD", -500));
    expect(value).toEqual(money("EUR", -400));
    expect(convertMoney(money("EUR", 0), "USD", rates)).toEqual(money("USD", 0));
    const usd = money("USD", 100);
    expect(convertMoney(usd, "USD", [])).toEqual(usd);
    expect(convertMoney(usd, "USD", [])).not.toBe(usd);
    expect(convertMoney(money("EUR", 100), "USD", [{ from: "EUR", to: "USD", rate: "1" }])).toEqual(
      money("USD", 100),
    );
  });

  it("scales 0, 2, 3 and 4 minor-unit currencies using major-unit rates", () => {
    expect(
      convertMoney(money("JPY", 100), "USD", [{ from: "JPY", to: "USD", rate: "0.01" }]),
    ).toEqual(money("USD", 100));
    expect(
      convertMoney(money("USD", 100), "JPY", [{ from: "USD", to: "JPY", rate: "100" }]),
    ).toEqual(money("JPY", 100));
    expect(
      convertMoney(money("KWD", 1250), "CLF", [{ from: "KWD", to: "CLF", rate: "2" }]),
    ).toEqual(money("CLF", 25000));
    expect(
      convertMoney(money("CLF", 25000), "KWD", [{ from: "CLF", to: "KWD", rate: "0.5" }]),
    ).toEqual(money("KWD", 1250));
    expect(
      convertMoney(money("EUR", Number.MAX_SAFE_INTEGER), "USD", [
        { from: "EUR", to: "USD", rate: "1.00000000000000000000" },
      ]),
    ).toEqual(money("USD", Number.MAX_SAFE_INTEGER));
  });

  it("rejects missing, inverse and cross rates, even for zero foreign amounts", () => {
    fails(() => convertMoney(money("EUR", 1), "USD", []), "missing-rate");
    fails(() => convertMoney(money("USD", 1), "EUR", rates), "missing-rate");
    fails(() => convertMoney(money("EUR", 0), "USD", []), "missing-rate");
    fails(
      () =>
        convertMoney(money("EUR", 100), "GBP", [...rates, { from: "USD", to: "GBP", rate: "0.8" }]),
      "missing-rate",
    );
    fails(() => convertMoney(money("EUR", 100), "XXX", rates), "unsupported-currency");
  });

  it("rejects inexact fractional minor units and overflow", () => {
    for (const minor of [1, -1])
      fails(() => convertMoney(money("EUR", minor), "USD", rates), "inexact-conversion");
    fails(
      () => convertMoney(money("USD", 1), "JPY", [{ from: "USD", to: "JPY", rate: "0.5" }]),
      "inexact-conversion",
    );
    fails(
      () =>
        convertMoney(money("EUR", Number.MAX_SAFE_INTEGER), "USD", [
          { from: "EUR", to: "USD", rate: "2" },
        ]),
      "overflow",
    );
  });

  it("validates all rates, refusing duplicates and unsupported input even if unused", () => {
    for (const rate of ["0", "-0.0", "-1", "1e2", "NaN", "+1", "1,2", "", " 1", 1.25, null])
      fails(
        () =>
          convertMoney(money("USD", 1), "USD", [{ from: "EUR", to: "USD", rate: rate as string }]),
        "invalid-rate",
      );
    fails(() => convertMoney(money("USD", 1), "USD", [...rates, ...rates]), "duplicate");
    fails(
      () => convertMoney(money("USD", 1), "USD", [...rates, { ...rates[0]!, rate: "1.5" }]),
      "duplicate",
    );
    fails(
      () => convertMoney(money("USD", 1), "USD", [{ from: "USD", to: "USD", rate: "1" }]),
      "invalid-rate",
    );
    fails(
      () => convertMoney(money("USD", 1), "USD", [{ from: "XXX", to: "USD", rate: "1" }]),
      "unsupported-currency",
    );
    fails(
      () => convertMoney(money("USD", 1), "USD", [{ from: "EUR", to: "XXX", rate: "1" }]),
      "unsupported-currency",
    );
    fails(() => convertMoney(money("USD", 1), "USD", null as never), "invalid-input");
    fails(() => convertMoney(money("USD", 1), "USD", Array(1)), "invalid-input");
    fails(() => convertMoney(money("USD", 1), "USD", [null] as never), "invalid-input");
  });
});
