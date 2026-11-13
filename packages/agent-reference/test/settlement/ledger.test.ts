// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestOf } from "../../src/core/canonical.js";
import { Ledger } from "../../src/settlement/ledger.js";
import { convertMoney } from "../../src/settlement/money.js";

function ledger() {
  const ledger = new Ledger();
  ledger.createAccount("sam", { GBP: "10.00", JPY: "500" });
  ledger.createAccount("valuer");
  return ledger;
}
it("moves exact decimal balances, hashes and chains entries and returns immutable snapshots", () => {
  const book = ledger();
  const first = book.transfer("sam", "valuer", "1.125", "GBP", "once-1");
  const { digest, ...fields } = first;
  expect(digest).toBe(digestOf(fields));
  expect(book.balance("sam", "GBP")).toBe("8.875");
  expect(book.balance("valuer", "GBP")).toBe("1.125");
  expect(Object.isFrozen(first)).toBe(true);
  expect(book.transfer("sam", "valuer", "100", "JPY", "once-2").previous).toBe(digest);
  expect(book.balance("sam", "JPY")).toBe("400");
  expect(book.entries).toHaveLength(2);
});
it("refuses reuse globally, including in another currency", () => {
  const book = ledger();
  book.transfer("sam", "valuer", "1", "GBP", "once");
  expect(() => book.transfer("sam", "valuer", "1", "JPY", "once")).toThrow("nonce_reused");
  expect(book.entries).toHaveLength(1);
});
it("refuses insufficient funds without consuming a nonce or changing any balance", () => {
  const book = ledger();
  expect(() => book.transfer("sam", "valuer", "10.01", "GBP", "once")).toThrow(
    "insufficient_funds",
  );
  expect(book.hasUsed("once")).toBe(false);
  expect(book.balance("sam", "GBP")).toBe("10.00");
  expect(book.balance("valuer", "GBP")).toBe("0");
  expect(book.entries).toEqual([]);
  expect(book.transfer("sam", "valuer", "1", "GBP", "once")).toBeDefined();
});
it("treats an absent currency balance as zero and refuses spending it", () => {
  const book = ledger();
  expect(() => book.transfer("sam", "valuer", "1", "EUR", "unfunded")).toThrow(
    "insufficient_funds",
  );
  expect(book.balance("sam", "EUR")).toBe("0");
  expect(book.hasUsed("unfunded")).toBe(false);
});
it.each([
  ["missing", "valuer", "1", "GBP", "once"],
  ["sam", "missing", "1", "GBP", "once"],
  ["sam", "sam", "1", "GBP", "once"],
  ["sam", "valuer", "0", "GBP", "once"],
  ["sam", "valuer", "1", "", "once"],
  ["sam", "valuer", "1", "GBP", ""],
  ["sam", "valuer", "-1", "GBP", "once"],
  ["sam", "valuer", "NaN", "GBP", "once"],
])("refuses invalid transfer %s %s %s %s %s", (from, to, amount, currency, once) => {
  const book = ledger();
  expect(() => book.transfer(from, to, amount, currency, once)).toThrow();
  expect(book.entries).toHaveLength(0);
});
it("refuses account resets, empty account names and malformed initial balances", () => {
  const book = ledger();
  expect(() => book.createAccount("sam")).toThrow();
  expect(() => book.createAccount("")).toThrow();
  expect(() => book.createAccount("new", { GBP: "-1" })).toThrow();
  expect(() => book.createAccount("new", { "": "1" })).toThrow();
  expect(() => book.balance("unknown", "GBP")).toThrow("unknown_account");
});
it("converts decimal money without floating point and handles currencies with no minor unit", () => {
  expect(convertMoney({ amount: "9007199254740993.12", currency: "GBP" }, 2)).toEqual({
    units: "900719925474099312",
    currency: "GBP",
  });
  expect(convertMoney({ units: "1", currency: "GBP" }, 2)).toEqual({
    amount: "0.01",
    currency: "GBP",
  });
  expect(convertMoney({ amount: "123", currency: "JPY" }, 0)).toEqual({
    units: "123",
    currency: "JPY",
  });
  expect(convertMoney({ units: "123", currency: "JPY" }, 0)).toEqual({
    amount: "123",
    currency: "JPY",
  });
});
it.each(["-1", "1e2", "01", "1.", "1.001"])("refuses invalid decimal %s", (amount) => {
  expect(() => convertMoney({ amount, currency: "GBP" }, 2)).toThrow();
});
it("refuses invalid precision, currency and units", () => {
  for (const precision of [-1, 1.1, 37])
    expect(() => convertMoney({ amount: "1", currency: "GBP" }, precision)).toThrow();
  expect(() => convertMoney({ amount: "1", currency: "" }, 2)).toThrow();
  expect(() => convertMoney({ units: "1.5", currency: "GBP" }, 2)).toThrow();
});
