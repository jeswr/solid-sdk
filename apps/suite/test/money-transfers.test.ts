// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  detectTransfers,
  type MoneyTransaction,
  mergeSplit,
  type SplitPart,
  type SplitTransaction,
  splitTransaction,
  type TransferOptions,
  TransfersError,
  type TransfersErrorCode,
  unsplitTransaction,
} from "../src/apps/money/lib/transfers";

const checking = "https://example.org/money/accounts/checking";
const savings = "https://example.org/money/accounts/savings";
const reserve = "https://example.org/money/accounts/reserve";
const groceries = "https://example.org/money/categories/groceries";
const home = "https://example.org/money/categories/home";
const options: TransferOptions = { accountIds: [checking, savings, reserve], maxDays: 3 };
function tx(overrides: Partial<MoneyTransaction> = {}): MoneyTransaction {
  return {
    id: "out",
    accountId: checking,
    date: "2026-10-26",
    currency: "GBP",
    amount: -100,
    payee: "Fictional Orchard Shop",
    memo: "Synthetic weekly purchase",
    status: "cleared",
    ...overrides,
  };
}
function incoming(overrides: Partial<MoneyTransaction> = {}): MoneyTransaction {
  return tx({ id: "in", accountId: savings, amount: 100, ...overrides });
}
function parts(): SplitPart[] {
  return [
    { categoryId: groceries, amount: -70 },
    { categoryId: home, amount: -30 },
  ];
}
function fails(run: () => unknown, code: TransfersErrorCode = "invalid-input"): void {
  expect(run).toThrow(TransfersError);
  expect(run).toThrow(expect.objectContaining({ name: "TransfersError", code }));
}

describe("transfer matching", () => {
  it("matches exact opposite minor units on distinct owned accounts without mutation", () => {
    const items = Object.freeze([
      Object.freeze(incoming({ date: "2026-10-29", status: "uncleared" })),
      Object.freeze(tx({ status: "reconciled" })),
      Object.freeze(tx({ id: "other-out", accountId: reserve, amount: -99, currency: "EUR" })),
      Object.freeze(incoming({ id: "other-in", amount: 99, currency: "EUR" })),
      Object.freeze(tx({ id: "unmatched", amount: -20 })),
    ]);
    expect(detectTransfers(items, Object.freeze(options))).toEqual({
      pairs: [
        { outflowId: "out", inflowId: "in" },
        { outflowId: "other-out", inflowId: "other-in" },
      ],
      ambiguous: [],
      unmatchedIds: ["unmatched"],
    });
    expect(items[0]?.amount).toBe(100);
  });

  it.each([
    { amount: -100 },
    { amount: 101 },
    { currency: "EUR" },
    { accountId: checking },
    { date: "2026-10-30" },
    { date: "2026-10-22" },
  ])("leaves ineligible entries unmatched (%#)", (overrides) => {
    expect(detectTransfers([tx(), incoming(overrides)], options)).toEqual({
      pairs: [],
      ambiguous: [],
      unmatchedIds: ["out", "in"],
    });
  });

  it("does not match zero amounts or self-match and handles an empty ledger", () => {
    expect(detectTransfers([tx({ amount: 0 }), incoming({ amount: 0 })], options)).toEqual({
      pairs: [],
      ambiguous: [],
      unmatchedIds: ["out", "in"],
    });
    expect(detectTransfers([tx()], options).unmatchedIds).toEqual(["out"]);
    expect(detectTransfers([], options)).toEqual({ pairs: [], ambiguous: [], unmatchedIds: [] });
  });

  it.each([
    ["2026-10-26", "2026-10-26", 0],
    ["2026-10-26", "2026-10-23", 3],
    ["2026-12-31", "2027-01-01", 1],
    ["2024-02-28", "2024-03-01", 2],
    ["2026-03-28", "2026-03-30", 2],
    ["0001-01-01", "0001-01-02", 1],
    ["9999-12-30", "9999-12-31", 1],
  ])("uses inclusive civil days from %s to %s (%i)", (start, end, maxDays) => {
    expect(
      detectTransfers([tx({ date: start }), incoming({ date: end })], { ...options, maxDays })
        .pairs,
    ).toEqual([{ outflowId: "out", inflowId: "in" }]);
  });

  it("reports all endpoints of ambiguity while retaining unrelated unique pairs", () => {
    const result = detectTransfers(
      [
        tx(),
        incoming(),
        incoming({ id: "in2", accountId: reserve, date: "2026-10-27" }),
        tx({ id: "unique-out", amount: -7 }),
        incoming({ id: "unique-in", amount: 7 }),
      ],
      options,
    );
    expect(result).toEqual({
      pairs: [{ outflowId: "unique-out", inflowId: "unique-in" }],
      ambiguous: [
        { transactionId: "out", candidateIds: ["in", "in2"] },
        { transactionId: "in", candidateIds: ["out"] },
        { transactionId: "in2", candidateIds: ["out"] },
      ],
      unmatchedIds: [],
    });
  });

  it("does not guess by nearest date, greedy order, or elimination through a chain", () => {
    const ledger = [
      tx({ date: "2026-10-01" }),
      incoming({ date: "2026-10-01" }),
      tx({ id: "out2", date: "2026-10-03" }),
      incoming({ id: "in2", date: "2026-10-05" }),
    ];
    for (const items of [
      ledger,
      [...ledger].reverse(),
      [...ledger.slice(1), ledger[0] as MoneyTransaction],
    ]) {
      const result = detectTransfers(items, { ...options, maxDays: 2 });
      expect(result.pairs).toEqual([]);
      expect(result.unmatchedIds).toEqual([]);
      expect(result.ambiguous).toHaveLength(4);
      expect(result.ambiguous.find((entry) => entry.transactionId === "in")).toEqual({
        transactionId: "in",
        candidateIds: items.filter((item) => item.amount < 0).map((item) => item.id),
      });
    }
  });

  it("never reuses a transaction across independent pairs in any input order", () => {
    const items = [
      tx(),
      incoming(),
      tx({ id: "out2", amount: -200 }),
      incoming({ id: "in2", amount: 200 }),
    ];
    for (let offset = 0; offset < items.length; offset++) {
      const result = detectTransfers([...items.slice(offset), ...items.slice(0, offset)], options);
      expect(result.pairs).toHaveLength(2);
      expect(new Set(result.pairs.flatMap((pair) => [pair.outflowId, pair.inflowId])).size).toBe(4);
    }
    const max = Number.MAX_SAFE_INTEGER;
    expect(
      detectTransfers([tx({ amount: -max }), incoming({ amount: max })], options).pairs,
    ).toHaveLength(1);
  });

  it.each([
    null,
    {},
    { ...options, extra: true },
    { ...options, accountIds: [checking] },
    { ...options, accountIds: [checking, ""] },
  ])("rejects malformed scope/options (%#)", (value) => {
    fails(() => detectTransfers([], value as TransferOptions));
  });

  it.each([
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "3",
    undefined,
  ])("rejects unsupported date window %j", (maxDays) => {
    fails(() => detectTransfers([], { ...options, maxDays } as TransferOptions), "invalid-window");
  });

  it("rejects duplicate scope/transaction IDs and out-of-scope entries even if unmatched", () => {
    fails(
      () => detectTransfers([], { ...options, accountIds: [checking, checking] }),
      "duplicate-id",
    );
    fails(() => detectTransfers([tx(), tx()], options), "duplicate-id");
    fails(
      () => detectTransfers([tx({ accountId: "https://example.org/other" })], options),
      "unknown-account",
    );
    fails(
      () => detectTransfers([tx(), incoming(), tx({ id: "bad", amount: 0.5 })], options),
      "invalid-amount",
    );
  });
});

describe("split and merge/unsplit", () => {
  it("copies all original metadata and category, parts and array without mutating inputs", () => {
    const original = Object.freeze(
      tx({ categoryId: "https://example.org/money/categories/original" }),
    );
    const inputParts = Object.freeze(parts().map((part) => Object.freeze(part)));
    const split = splitTransaction(original, inputParts);
    expect(split).toEqual({ transaction: original, parts: inputParts });
    expect(split.transaction).not.toBe(original);
    expect(split.parts).not.toBe(inputParts);
    expect(split.parts[0]).not.toBe(inputParts[0]);
    const merged = mergeSplit(Object.freeze(split));
    expect(merged).toEqual(original);
    expect(merged).not.toBe(split.transaction);
    expect(unsplitTransaction(split)).toEqual(original);
    expect(mergeSplit(splitTransaction(tx(), parts()))).not.toHaveProperty("categoryId");
  });

  it("accepts credits, zero amounts, repeated categories and signed offsets with exact sums", () => {
    for (const [total, amounts] of [
      [100, [70, 30]],
      [0, [0, 0]],
      [-100, [-130, 30]],
      [0, [-5, 5]],
    ] as const) {
      const original = tx({ amount: total });
      const split = splitTransaction(
        original,
        amounts.map((value) => ({ categoryId: groceries, amount: value })),
      );
      expect(mergeSplit(split)).toEqual(original);
    }
  });

  it("uses exact sums even when intermediate totals exceed safe integers", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const split = splitTransaction(
      tx({ amount: max }),
      [max, max, -max].map((value) => ({ categoryId: home, amount: value })),
    );
    expect(mergeSplit(split).amount).toBe(max);
    // A number sum rounds max + 2 - max to 1 and would wrongly accept this split.
    fails(
      () =>
        splitTransaction(
          tx({ amount: 1 }),
          [max, 2, -max].map((value) => ({ categoryId: home, amount: value })),
        ),
      "split-total-mismatch",
    );
  });

  it.each([
    [[]],
    [[{ categoryId: groceries, amount: -100 }]],
  ])("requires two or more parts (%#)", (inputParts) => {
    fails(() => splitTransaction(tx(), inputParts), "invalid-split");
  });

  it.each([-99, -101, 100, 0])("rejects an incorrect split total of %i", (total) => {
    fails(() => splitTransaction(tx({ amount: total }), parts()), "split-total-mismatch");
  });

  it.each([
    null,
    {},
    { categoryId: "", amount: -70 },
    { categoryId: groceries, amount: -70, currency: "EUR" },
    { categoryId: groceries, amount: -70, id: "extra" },
  ])("rejects malformed or extra part fields (%#)", (part) => {
    fails(() => splitTransaction(tx(), [part, parts()[1]] as SplitPart[]));
  });

  it.each([
    NaN,
    Infinity,
    0.1,
    Number.MAX_SAFE_INTEGER + 1,
    "70",
    undefined,
  ])("rejects non-minor-unit part amount %j", (value) => {
    fails(
      () =>
        splitTransaction(tx(), [{ categoryId: home, amount: value }, parts()[1]] as SplitPart[]),
      "invalid-amount",
    );
  });

  it("revalidates externally edited or deserialised splits before merging", () => {
    const split = splitTransaction(tx(), parts());
    expect(mergeSplit(JSON.parse(JSON.stringify(split)))).toEqual(tx());
    for (const value of [null, {}, { ...split, extra: true }, { ...split, transaction: {} }]) {
      fails(() => mergeSplit(value as SplitTransaction));
    }
    fails(() => mergeSplit({ ...split, parts: [] }), "invalid-split");
    fails(() => mergeSplit({ ...split, transaction: tx({ amount: 100 }) }), "split-total-mismatch");
    fails(
      () =>
        mergeSplit({
          ...split,
          parts: [{ categoryId: home, amount: 0.1 }, parts()[1] as SplitPart],
        }),
      "invalid-amount",
    );
    fails(() => splitTransaction(split as unknown as MoneyTransaction, parts()));
  });
});

describe("fail-closed data validation", () => {
  it.each([
    null,
    [],
    new Date(),
    { ...tx(), extra: true },
    { ...tx(), [Symbol("unknown")]: 1 },
    { ...tx(), id: "" },
    { ...tx(), id: " out" },
    { ...tx(), accountId: null },
    { ...tx(), currency: "gbp" },
    { ...tx(), currency: "USDT" },
    { ...tx(), currency: 1 },
    { ...tx(), payee: null },
    { ...tx(), memo: 2 },
    { ...tx(), categoryId: undefined },
    { ...tx(), status: "pending" },
  ])("rejects unsupported transaction data (%#)", (value) => {
    fails(() => splitTransaction(value as MoneyTransaction, parts()));
  });

  it.each([
    NaN,
    Infinity,
    -Infinity,
    1.01,
    "100",
    undefined,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects unsupported transaction amount %j", (value) => {
    fails(
      () => splitTransaction({ ...tx(), amount: value } as MoneyTransaction, parts()),
      "invalid-amount",
    );
  });

  it.each([
    null,
    20261026,
    "2026-1-01",
    "2026-10-26T00:00:00Z",
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-00-01",
    "2026-13-01",
    "0000-01-01",
    "10000-01-01",
  ])("rejects malformed or nonexistent dates %j", (value) => {
    fails(
      () => splitTransaction({ ...tx(), date: value } as MoneyTransaction, parts()),
      "invalid-date",
    );
  });

  it("supports null-prototype data records, leap dates and both safe integer boundaries", () => {
    for (const date of ["0004-02-29", "2000-02-29", "2024-02-29"]) {
      const original: MoneyTransaction = Object.assign(
        Object.create(null),
        tx({ date, amount: Number.MIN_SAFE_INTEGER }),
      );
      expect(
        mergeSplit(
          splitTransaction(original, [
            { categoryId: home, amount: Number.MIN_SAFE_INTEGER },
            { categoryId: groceries, amount: 0 },
          ]),
        ),
      ).toEqual(original);
    }
  });

  it("rejects accessors before invoking them, hidden data and custom prototypes", () => {
    const getter = {
      get() {
        throw new Error("Do not invoke");
      },
      enumerable: true,
    };
    fails(() => splitTransaction(Object.defineProperty(tx(), "amount", getter), parts()));
    fails(() =>
      splitTransaction(Object.defineProperty(tx(), "id", { enumerable: false }), parts()),
    );
    fails(() => splitTransaction(Object.assign(Object.create({ custom: true }), tx()), parts()));
    fails(() => splitTransaction(tx(), Object.defineProperty(parts(), "0", getter)));
    fails(() => splitTransaction(tx(), Object.defineProperty(parts(), "0", { enumerable: false })));
  });

  it.each([
    null,
    {},
    new Array(2),
    Object.assign(parts(), { extra: true }),
    Object.assign(parts(), { [Symbol("extra")]: true }),
    Object.assign(parts(), { "01": true }),
    Object.assign(parts(), { "4294967295": true }),
    Object.setPrototypeOf(parts(), null),
  ])("rejects non-data, sparse and extended arrays (%#)", (value) => {
    fails(() => splitTransaction(tx(), value as SplitPart[]));
    fails(() => detectTransfers(value as MoneyTransaction[], options));
    fails(() => detectTransfers([], { ...options, accountIds: value } as TransferOptions));
  });

  it("keeps private inputs out of error messages", () => {
    try {
      splitTransaction(tx({ memo: "private fictional reference", amount: 0.5 }), parts());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TransfersError);
      expect((error as Error).message).toBe("Money transfers: invalid-amount");
    }
  });
});
