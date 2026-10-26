// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  applyRules,
  type CategorisationRule,
  detectTransfers,
  MoneyRulesError,
  type MoneyRulesErrorCode,
  type MoneyTransaction,
  type ReconciliationInput,
  reconcile,
  type TransferOptions,
} from "../src/apps/money/lib/rules";

const checking = "https://example.org/money/accounts/checking";
const savings = "https://example.org/money/accounts/savings";
const groceries = "https://example.org/money/categories/groceries";
function tx(overrides: Partial<MoneyTransaction> = {}): MoneyTransaction {
  return {
    id: "purchase",
    accountId: checking,
    date: "2026-10-26",
    currency: "GBP",
    amount: -1250,
    payee: "Fictional Orchard Shop",
    memo: "Weekly food",
    status: "cleared",
    ...overrides,
  };
}
function rule(overrides: Partial<CategorisationRule> = {}): CategorisationRule {
  return {
    id: "groceries",
    priority: 1,
    conditions: {},
    actions: { categoryId: groceries },
    ...overrides,
  };
}
function fails(run: () => unknown, code: MoneyRulesErrorCode): void {
  expect(run).toThrow(MoneyRulesError);
  expect(run).toThrow(expect.objectContaining({ name: "MoneyRulesError", code }));
}
function checkRawRule(value: unknown, code: MoneyRulesErrorCode = "invalid-rule"): void {
  fails(() => applyRules(tx(), [value as CategorisationRule]), code);
}
const options: TransferOptions = { accountIds: [checking, savings], maxDays: 3 };
function statement(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    accountId: checking,
    currency: "GBP",
    openingBalance: 10000,
    statementBalance: 8750,
    statementDate: "2026-10-26",
    transactions: [tx()],
    ...overrides,
  };
}

describe("categorisation", () => {
  it("applies only the first match in ascending priority, preserving ties and input order", () => {
    const later = rule({ id: "later", priority: 9, actions: { payee: "Wrong" } });
    const first = rule({ priority: -1, actions: { categoryId: groceries, payee: "Orchard" } });
    const tied = rule({ id: "tied", priority: -1, actions: { payee: "Also wrong" } });
    const rules = Object.freeze([later, Object.freeze(first), tied]);
    const item = Object.freeze(tx());
    expect(applyRules(item, rules)).toEqual({
      matchedRuleId: "groceries",
      transaction: { ...item, categoryId: groceries, payee: "Orchard" },
    });
    expect(rules[0]).toBe(later);
    expect(item.payee).toBe("Fictional Orchard Shop");
    expect(applyRules(tx(), [tied, first]).matchedRuleId).toBe("tied");
  });

  it("returns a fresh unchanged value without a match or rules", () => {
    const item = tx({ categoryId: "existing" });
    const result = applyRules(item, [rule({ conditions: { accountId: savings } })]);
    expect(result).toEqual({ matchedRuleId: null, transaction: item });
    expect(result.transaction).not.toBe(item);
    expect(applyRules(item, [])).toEqual(result);
  });

  it("matches literal contains on payee and memo, case-sensitively without trimming", () => {
    const match = rule({
      conditions: {
        payee: { operator: "contains", value: "Orchard" },
        memo: { operator: "contains", value: "food" },
      },
    });
    expect(applyRules(tx(), [match]).matchedRuleId).toBe(match.id);
    expect(applyRules(tx({ memo: "Other" }), [match]).matchedRuleId).toBeNull();
    expect(applyRules(tx({ payee: "fictional orchard shop" }), [match]).matchedRuleId).toBeNull();
    expect(
      applyRules(tx({ payee: "a.*(b)|^$" }), [
        rule({ conditions: { payee: { operator: "contains", value: ".*(b)|^$" } } }),
      ]).matchedRuleId,
    ).toBe("groceries");
    expect(
      applyRules(tx({ memo: "food " }), [
        rule({ conditions: { memo: { operator: "contains", value: " food" } } }),
      ]).matchedRuleId,
    ).toBeNull();
  });

  it.each([
    ["Orchard", "Orchard", true],
    ["Orchard Shop", "Orchard", false],
    ["Fictional Orchard Shop", "*Orchard*", true],
    ["Fictional Orchard Shop", "Orchard*", false],
    ["aaab", "*ab", true],
    ["*ba", "*a", true],
    ["**a", "*a", true],
    ["abc", "*z", false],
    ["ab", "a?", true],
    ["a", "a?", false],
    ["abc", "a?c", true],
    ["abc", "a*d", false],
    ["abc", "a**?*", true],
    ["abc", "*a*b*c*", true],
    ["", "*", true],
    ["", "?", false],
    ["\n", "?", true],
    ["A🦉B", "A?B", true],
    ["🦉", "??", false],
    ["a.+(b)|^$", "a.+(b)|^$", true],
  ])("matches glob %j against %j: %s", (payee, value, matched) => {
    const result = applyRules(tx({ payee }), [
      rule({ conditions: { payee: { operator: "glob", value } } }),
    ]);
    expect(result.matchedRuleId !== null).toBe(matched);
  });

  it("supports memo globs, inclusive signed amount bounds and exact account AND conditions", () => {
    const match = rule({
      conditions: {
        memo: { operator: "glob", value: "Weekly*" },
        accountId: checking,
        amount: { min: -1250, max: -1250 },
      },
    });
    expect(applyRules(tx(), [match]).matchedRuleId).toBe("groceries");
    expect(applyRules(tx({ amount: -1251 }), [match]).matchedRuleId).toBeNull();
    expect(applyRules(tx({ amount: -1249 }), [match]).matchedRuleId).toBeNull();
    expect(applyRules(tx({ accountId: savings }), [match]).matchedRuleId).toBeNull();
    expect(applyRules(tx(), [rule({ conditions: { amount: { min: -1250 } } })]).matchedRuleId).toBe(
      "groceries",
    );
    expect(applyRules(tx(), [rule({ conditions: { amount: { max: -1250 } } })]).matchedRuleId).toBe(
      "groceries",
    );
    expect(
      applyRules(tx({ amount: 0 }), [rule({ conditions: { amount: { min: 0, max: 100 } } })])
        .matchedRuleId,
    ).toBe("groceries");
    expect(
      applyRules(tx({ amount: 100 }), [rule({ conditions: { amount: { max: 100 } } })])
        .matchedRuleId,
    ).toBe("groceries");
  });

  it("renames without losing category and skips a high-priority nonmatch", () => {
    const rules = [
      rule({
        id: "skip",
        priority: 0,
        conditions: { payee: { operator: "contains", value: "Missing" } },
      }),
      rule({ actions: { payee: "Renamed" } }),
    ];
    expect(applyRules(tx({ categoryId: groceries }), rules)).toEqual({
      matchedRuleId: "groceries",
      transaction: tx({ categoryId: groceries, payee: "Renamed" }),
    });
  });

  it("validates the full rule list even after an unconditional winner", () => {
    checkRawRule({}, "invalid-input");
    fails(
      () =>
        applyRules(tx(), [
          rule(),
          rule({
            id: "invalid",
            conditions: { memo: { operator: "regex", value: "secret" } },
          } as unknown as CategorisationRule),
        ]),
      "invalid-rule",
    );
    fails(() => applyRules(tx(), [rule(), rule()]), "invalid-rule");
    fails(() => applyRules(tx(), null as unknown as CategorisationRule[]), "invalid-rule");
  });

  it.each([
    null,
    [],
    new Date(),
    { ...rule(), extra: true },
    { ...rule(), priority: 1.5 },
    { ...rule(), priority: Number.POSITIVE_INFINITY },
    { ...rule(), conditions: null },
    { ...rule(), conditions: { any: true } },
    { ...rule(), conditions: { payee: undefined } },
    { ...rule(), conditions: { payee: { operator: "regex", value: "x" } } },
    { ...rule(), conditions: { memo: { operator: "contains", value: "" } } },
    { ...rule(), conditions: { memo: { operator: "contains", value: 42 } } },
    { ...rule(), conditions: { payee: { operator: "glob", value: "a", flags: "i" } } },
    { ...rule(), conditions: { amount: {} } },
    { ...rule(), conditions: { amount: { min: 3, max: 2 } } },
    { ...rule(), conditions: { amount: { min: 1, max: 2, absolute: true } } },
    { ...rule(), actions: {} },
    { ...rule(), actions: { delete: true } },
    { ...rule(), [Symbol("unsupported")]: true },
  ])("rejects invalid rule structures (%#)", (value) => checkRawRule(value));

  it.each(["[ab]", "a]", "{a,b}", "a\\*", "a}"])("rejects unsupported glob %j", (value) => {
    checkRawRule(rule({ conditions: { payee: { operator: "glob", value } } }), "unsupported-glob");
  });

  it.each([
    { id: undefined },
    { id: " " },
    { conditions: { accountId: "" } },
    { actions: { categoryId: "" } },
    { actions: { payee: "  " } },
  ])("rejects blank rule identifiers and action values (%#)", (value) =>
    checkRawRule({ ...rule(), ...value }, "invalid-input"));

  it.each([
    { min: 1.1 },
    { max: NaN },
    { min: undefined },
    { max: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid amount bounds (%#)", (amount) =>
    checkRawRule({ ...rule(), conditions: { amount } }, "invalid-amount"));
});

describe("shared input validation", () => {
  it.each([
    null,
    [],
    new Date(),
    { ...tx(), extra: true },
    { ...tx(), [Symbol("extra")]: 1 },
    { ...tx(), id: " " },
    { ...tx(), accountId: 1 },
    { ...tx(), categoryId: undefined },
    { ...tx(), status: "pending" },
    { ...tx(), payee: null },
    { ...tx(), memo: 1 },
    { ...tx(), currency: "gbp" },
    { ...tx(), currency: "USDT" },
    { ...tx(), currency: null },
  ])("rejects invalid transaction structures (%#)", (value) => {
    fails(() => applyRules(value as MoneyTransaction, []), "invalid-input");
  });

  it.each([
    NaN,
    Infinity,
    -Infinity,
    1.25,
    Number.MAX_SAFE_INTEGER + 1,
    "100",
    null,
    undefined,
  ])("rejects noninteger and unsafe amounts: %j", (amount) => {
    fails(() => applyRules({ ...tx(), amount } as MoneyTransaction, []), "invalid-amount");
  });

  it.each([
    null,
    20261026,
    "2026-1-01",
    "2026-10-26T00:00:00Z",
    "2026-10-26+01:00",
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-00-01",
    "2026-13-01",
    "0000-01-01",
    "10000-01-01",
  ])("rejects invalid dates: %j", (date) => {
    fails(() => applyRules({ ...tx(), date } as MoneyTransaction, []), "invalid-date");
  });

  it("supports leap dates, boundary years, null-prototype records, and safe integer bounds", () => {
    for (const date of ["0001-01-01", "0004-02-29", "2000-02-29", "2024-02-29", "9999-12-31"]) {
      expect(applyRules(tx({ date, amount: Number.MIN_SAFE_INTEGER }), []).transaction.date).toBe(
        date,
      );
    }
    const item = Object.assign(Object.create(null), tx({ amount: Number.MAX_SAFE_INTEGER }));
    expect(applyRules(item, []).transaction).toEqual(item);
  });

  it("rejects invalid transaction arrays and duplicate IDs", () => {
    fails(() => detectTransfers(null as unknown as MoneyTransaction[], options), "invalid-input");
    fails(() => detectTransfers([tx(), tx()], options), "invalid-input");
    fails(
      () => detectTransfers([undefined] as unknown as MoneyTransaction[], options),
      "invalid-input",
    );
  });

  it("rejects getters without invoking them and hidden fields that a copy would lose", () => {
    const accessor = Object.defineProperty(tx(), "amount", {
      enumerable: true,
      get() {
        throw new Error("Accessor must never run");
      },
    });
    fails(() => applyRules(accessor, []), "invalid-input");
    const hidden = Object.defineProperty(tx(), "id", { enumerable: false });
    fails(() => applyRules(hidden, []), "invalid-input");
  });

  it("keeps private input values out of error messages", () => {
    try {
      applyRules(tx({ date: "private-statement-value" }), []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MoneyRulesError);
      expect((error as Error).message).toBe("Money rules: invalid-date");
    }
  });
});

describe("transfer detection", () => {
  it("matches opposite signed amounts at the inclusive day limit, regardless of input order", () => {
    const outflow = Object.freeze(tx({ id: "out", amount: -1250, date: "2026-10-26" }));
    const inflow = Object.freeze(
      tx({ id: "in", amount: 1250, accountId: savings, date: "2026-10-29" }),
    );
    const ledger = Object.freeze([inflow, outflow]);
    expect(detectTransfers(ledger, options)).toEqual([{ outflowId: "out", inflowId: "in" }]);
    expect(detectTransfers([outflow, inflow], options)).toEqual(detectTransfers(ledger, options));
    expect(ledger).toEqual([inflow, outflow]);
    expect(detectTransfers([outflow, inflow], { ...options, maxDays: 2 })).toEqual([]);
    expect(detectTransfers([outflow, { ...inflow, date: "2026-10-23" }], options)).toHaveLength(1);
  });

  it("allows transfers in either direction and multiple independent currencies without reusing IDs", () => {
    const ledger = [
      tx({ id: "a", amount: -100 }),
      tx({ id: "b", amount: 100, accountId: savings }),
      tx({ id: "c", amount: -100, accountId: savings, currency: "EUR" }),
      tx({ id: "d", amount: 100, currency: "EUR" }),
      tx({ id: "e", amount: -900 }),
    ];
    const matches = detectTransfers(ledger, { ...options, maxDays: 0 });
    expect(matches).toEqual([
      { outflowId: "a", inflowId: "b" },
      { outflowId: "c", inflowId: "d" },
    ]);
    expect(new Set(matches.flatMap((match) => [match.outflowId, match.inflowId])).size).toBe(4);
  });

  it.each([
    { amount: -1250 },
    { amount: 1251 },
    { amount: 1250, currency: "EUR" },
    { amount: 1250, accountId: checking },
    { amount: 1250, date: "2026-10-30" },
  ])("leaves ineligible counterpart unmatched (%#)", (overrides) => {
    expect(
      detectTransfers(
        [tx({ id: "out" }), tx({ id: "in", accountId: savings, ...overrides })],
        options,
      ),
    ).toEqual([]);
  });

  it("does not match zero amounts and handles empty ledgers", () => {
    expect(
      detectTransfers(
        [tx({ amount: 0 }), tx({ id: "zero", accountId: savings, amount: 0 })],
        options,
      ),
    ).toEqual([]);
    expect(detectTransfers([], options)).toEqual([]);
  });

  it("uses calendar days across leap day, year and DST boundaries without timezone conversion", () => {
    for (const [start, end, maxDays] of [
      ["2024-02-28", "2024-03-01", 2],
      ["2026-12-31", "2027-01-01", 1],
      ["2026-03-28", "2026-03-30", 2],
    ] as const) {
      expect(
        detectTransfers(
          [tx({ date: start }), tx({ id: "in", accountId: savings, amount: 1250, date: end })],
          { ...options, maxDays },
        ),
      ).toHaveLength(1);
    }
  });

  it("rejects ambiguity on either account instead of arbitrarily choosing or reusing a counterpart", () => {
    const out = tx({ id: "out" });
    const incoming = tx({ id: "in", accountId: savings, amount: 1250 });
    for (const ledger of [
      [out, incoming, { ...incoming, id: "in2" }],
      [out, { ...out, id: "out2" }, incoming],
    ]) {
      fails(() => detectTransfers(ledger, options), "ambiguous-transfer");
      fails(() => detectTransfers([...ledger].reverse(), options), "ambiguous-transfer");
    }
  });

  it.each([
    null,
    {},
    { ...options, maxDays: -1 },
    { ...options, maxDays: 1.5 },
    { ...options, maxDays: Infinity },
    { ...options, maxDays: "3" },
    { ...options, accountIds: null },
    { ...options, accountIds: [checking] },
    { ...options, accountIds: [checking, savings, "third"] },
    { ...options, accountIds: [checking, checking] },
    { ...options, accountIds: [checking, ""] },
    { ...options, extra: true },
  ])("rejects invalid transfer options (%#)", (value) => {
    fails(() => detectTransfers([], value as TransferOptions), "invalid-input");
  });

  it("rejects transactions outside the requested two-account scope", () => {
    fails(
      () => detectTransfers([tx({ accountId: "https://example.org/other" })], options),
      "scope-mismatch",
    );
  });
});

describe("reconciliation", () => {
  it("adds cleared and reconciled entries to opening balance; marks only cleared through statement date", () => {
    const entries = Object.freeze([
      Object.freeze(tx({ id: "old", amount: -1000, status: "reconciled", date: "2026-09-30" })),
      Object.freeze(tx({ id: "cleared", amount: -1250 })),
      Object.freeze(tx({ id: "credit", amount: 200, date: "2026-10-01" })),
      Object.freeze(tx({ id: "uncleared", amount: -4000, status: "uncleared" })),
      Object.freeze(tx({ id: "future", amount: -100, date: "2026-10-27" })),
    ]);
    const input = Object.freeze(statement({ transactions: entries, statementBalance: 7950 }));
    expect(reconcile(input)).toEqual({
      clearedBalance: 7950,
      difference: 0,
      balanced: true,
      transactionIdsToReconcile: ["cleared", "credit"],
    });
    expect(entries[1]?.status).toBe("cleared");
  });

  it.each([
    [8800, 50],
    [8700, -50],
  ])("reports signed difference for statement balance %i without marking", (statementBalance, difference) => {
    expect(reconcile(statement({ statementBalance }))).toEqual({
      clearedBalance: 8750,
      difference,
      balanced: false,
      transactionIdsToReconcile: [],
    });
  });

  it("handles empty ledgers, zero and negative balances, and already reconciled transactions", () => {
    expect(
      reconcile(statement({ transactions: [], openingBalance: 0, statementBalance: 0 })),
    ).toEqual({ clearedBalance: 0, difference: 0, balanced: true, transactionIdsToReconcile: [] });
    expect(reconcile(statement({ openingBalance: 0, statementBalance: -1250 }))).toMatchObject({
      clearedBalance: -1250,
      balanced: true,
    });
    expect(
      reconcile(statement({ transactions: [tx({ status: "reconciled" })] }))
        .transactionIdsToReconcile,
    ).toEqual([]);
    expect(
      reconcile(
        statement({ openingBalance: 0, statementBalance: 0, transactions: [tx({ amount: 0 })] }),
      ).transactionIdsToReconcile,
    ).toEqual(["purchase"]);
  });

  it("sums exactly even when intermediate totals exceed the safe integer range", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const transactions = [
      tx({ id: "a", amount: max }),
      tx({ id: "b", amount: max }),
      tx({ id: "c", amount: -max }),
    ];
    expect(
      reconcile(statement({ openingBalance: 0, statementBalance: max, transactions }))
        .clearedBalance,
    ).toBe(max);
    expect(
      reconcile(
        statement({
          openingBalance: Number.MIN_SAFE_INTEGER,
          statementBalance: Number.MIN_SAFE_INTEGER,
          transactions: [],
        }),
      ).difference,
    ).toBe(0);
  });

  it("rejects overflowing cleared balances and differences", () => {
    fails(() => reconcile(statement({ openingBalance: Number.MIN_SAFE_INTEGER })), "overflow");
    fails(
      () =>
        reconcile(
          statement({ openingBalance: Number.MAX_SAFE_INTEGER, transactions: [tx({ amount: 1 })] }),
        ),
      "overflow",
    );
    fails(
      () =>
        reconcile(
          statement({
            openingBalance: Number.MIN_SAFE_INTEGER,
            statementBalance: Number.MAX_SAFE_INTEGER,
            transactions: [],
          }),
        ),
      "overflow",
    );
  });

  it.each([
    null,
    {},
    { ...statement(), other: true },
    { ...statement(), accountId: "" },
    { ...statement(), currency: "eur" },
  ])("rejects invalid reconciliation input (%#)", (value) => {
    fails(() => reconcile(value as ReconciliationInput), "invalid-input");
  });

  it("validates balances, statement date, ledger IDs, scope and future transactions", () => {
    fails(() => reconcile(statement({ openingBalance: 0.1 })), "invalid-amount");
    fails(() => reconcile(statement({ statementBalance: NaN })), "invalid-amount");
    fails(() => reconcile(statement({ statementDate: "2026-02-29" })), "invalid-date");
    fails(() => reconcile(statement({ transactions: [tx(), tx()] })), "invalid-input");
    fails(
      () => reconcile(statement({ transactions: [tx({ accountId: savings })] })),
      "scope-mismatch",
    );
    fails(
      () => reconcile(statement({ transactions: [tx({ currency: "EUR" })] })),
      "scope-mismatch",
    );
    fails(
      () => reconcile(statement({ transactions: [tx({ date: "2026-10-27", amount: 0.5 })] })),
      "invalid-amount",
    );
    fails(
      () => reconcile(statement({ transactions: [tx({ date: "2026-10-27", currency: "EUR" })] })),
      "scope-mismatch",
    );
  });
});
