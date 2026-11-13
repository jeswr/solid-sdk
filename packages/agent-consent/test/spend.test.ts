// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { addMoney, formatMoney, isMoney, money } from "../src/money.js";
import {
  isSpendingRule,
  periodEnd,
  periodStart,
  type SpendingRule,
  scopeCovers,
  scopeRank,
} from "../src/rules.js";
import { activeRules, checkSpend, ruleUsage, type SpendRecord } from "../src/spend.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");
const usd = (n: number | string) => money(n, "USD");
const stride = { kind: "merchant", merchant: "store:stride", label: "Stride & Co" } as const;
const shoes = { kind: "category", category: "shoes", label: "Shoes" } as const;

function rule(over: Partial<SpendingRule> & Pick<SpendingRule, "kind">): SpendingRule {
  return {
    id: `rule:${over.kind}`,
    limit: usd(100),
    scope: stride,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...(over.kind === "budget" ? { period: "month" as const } : {}),
    ...over,
  };
}

function spent(amount: number, over: Partial<SpendRecord> = {}): SpendRecord {
  return {
    id: `spend:${amount}:${over.at ?? ""}`,
    ruleId: "rule:budget",
    merchant: "store:stride",
    amount: usd(amount),
    at: "2026-11-10T10:00:00.000Z",
    ...over,
  };
}

describe("money", () => {
  it("parses, formats and adds exact amounts", () => {
    expect(usd(20)).toEqual({ minor: 2000, currency: "USD" });
    expect(usd("19.9")).toEqual({ minor: 1990, currency: "USD" });
    expect(usd(" 0.05 ")).toEqual({ minor: 5, currency: "USD" });
    expect(formatMoney(usd(20))).toBe("$20");
    expect(formatMoney(usd("1250.5"))).toBe("$1,250.50");
    expect(formatMoney(money(3, "GBP"))).toBe("£3");
    expect(formatMoney(money(3, "EUR"))).toBe("€3");
    expect(formatMoney(money(3, "JPY"))).toBe("3 JPY");
    expect(addMoney(usd(1), usd(2))).toEqual(usd(3));
    expect(() => addMoney(usd(1), money(1, "GBP"))).toThrow("currency mismatch");
  });

  it("rejects malformed amounts", () => {
    expect(() => usd("1.234")).toThrow(RangeError);
    expect(() => usd(-1)).toThrow(RangeError);
    expect(() => money(1, "usd")).toThrow(RangeError);
    expect(() => usd(2_000_000)).toThrow(RangeError);
    expect(isMoney(null)).toBe(false);
    expect(isMoney({ minor: 1.5, currency: "USD" })).toBe(false);
    expect(isMoney({ minor: 1, currency: 5 })).toBe(false);
  });
});

describe("rules", () => {
  it("accepts each well-formed kind", () => {
    expect(isSpendingRule(rule({ kind: "per-purchase" }))).toBe(true);
    expect(isSpendingRule(rule({ kind: "budget", period: "week" }))).toBe(true);
    expect(isSpendingRule(rule({ kind: "allowance", perPurchaseMax: usd(50) }))).toBe(true);
    expect(isSpendingRule(rule({ kind: "allowance", scope: { kind: "any" } }))).toBe(true);
    expect(isSpendingRule(rule({ kind: "budget", scope: shoes }))).toBe(true);
    expect(isSpendingRule(rule({ kind: "allowance", expiresAt: "2026-12-01T00:00:00.000Z" }))).toBe(
      true,
    );
  });

  it.each([
    ["not an object", null],
    ["extra key", { ...rule({ kind: "allowance" }), extra: 1 }],
    ["bad id", rule({ kind: "allowance", id: "has space" })],
    ["zero limit", rule({ kind: "allowance", limit: usd(0) })],
    ["bad scope", rule({ kind: "allowance", scope: { kind: "merchant" } as never })],
    ["scope extra key", rule({ kind: "allowance", scope: { kind: "any", x: 1 } as never })],
    ["unknown scope", rule({ kind: "allowance", scope: { kind: "planet" } as never })],
    ["null scope", rule({ kind: "allowance", scope: null as never })],
    ["long label", rule({ kind: "allowance", scope: { ...stride, label: "x".repeat(201) } })],
    ["bad category", rule({ kind: "allowance", scope: { ...shoes, category: "" } })],
    ["bad created", rule({ kind: "allowance", createdAt: "yesterday" })],
    ["expires first", rule({ kind: "allowance", expiresAt: "2026-10-01T00:00:00.000Z" })],
    ["bad expiry", rule({ kind: "allowance", expiresAt: "soon" })],
    ["budget no period", { ...rule({ kind: "budget" }), period: undefined }],
    ["budget bad period", rule({ kind: "budget", period: "day" as never })],
    ["allowance period", rule({ kind: "allowance", period: "month" })],
    ["unknown kind", rule({ kind: "forever" as never })],
    ["cap on per purchase", rule({ kind: "per-purchase", perPurchaseMax: usd(5) })],
    ["cap currency", rule({ kind: "allowance", perPurchaseMax: money(5, "GBP") })],
    ["cap zero", rule({ kind: "allowance", perPurchaseMax: usd(0) })],
    ["cap above limit", rule({ kind: "allowance", perPurchaseMax: usd(101) })],
    ["cap malformed", rule({ kind: "allowance", perPurchaseMax: { minor: -1 } as never })],
  ])("rejects %s", (_name, value) => {
    expect(isSpendingRule(value)).toBe(false);
  });

  it("ranks and matches scopes", () => {
    expect(scopeRank(stride)).toBe(3);
    expect(scopeRank(shoes)).toBe(2);
    expect(scopeRank({ kind: "any" })).toBe(1);
    expect(scopeCovers({ kind: "any" }, { merchant: "x" })).toBe(true);
    expect(scopeCovers(stride, { merchant: "store:other" })).toBe(false);
    expect(scopeCovers(shoes, { merchant: "x", category: "shoes" })).toBe(true);
    expect(scopeCovers(shoes, { merchant: "x" })).toBe(false);
  });

  it("finds calendar periods in UTC, weeks from Monday", () => {
    // 13 Nov 2026 is a Friday.
    expect(new Date(periodStart(NOW, "week")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(new Date(periodEnd(NOW, "week")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(new Date(periodStart(NOW, "month")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(new Date(periodEnd(NOW, "month")).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    const sunday = new Date("2026-11-15T23:00:00.000Z");
    expect(new Date(periodStart(sunday, "week")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
});

describe("checkSpend", () => {
  const budget = rule({ kind: "budget" });

  it("covers a purchase inside a monthly budget and reports what is left", () => {
    const check = checkSpend(
      [budget],
      [spent(20)],
      { merchant: "store:stride", amount: usd(30) },
      NOW,
    );
    expect(check.outcome).toBe("covered");
    if (check.outcome !== "covered") return;
    expect(check.usage.used).toEqual(usd(20));
    expect(check.usage.remaining).toEqual(usd(80));
    expect(check.usage.after).toBe(5000);
    expect(check.usage.resetsAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("asks when a purchase would go over the budget", () => {
    const check = checkSpend(
      [budget],
      [spent(90)],
      { merchant: "store:stride", amount: usd(20) },
      NOW,
    );
    expect(check).toMatchObject({ outcome: "exceeds", reason: "over-budget" });
  });

  it("ignores last month's spend, refunds, other rules, other currencies and future records", () => {
    const records = [
      spent(90, { at: "2026-10-30T10:00:00.000Z" }),
      spent(90, { refunded: true }),
      spent(90, { ruleId: "rule:other" }),
      spent(90, { amount: money(90, "GBP") }),
      spent(90, { at: "2026-11-20T10:00:00.000Z" }),
      spent(90, { at: "not a date" }),
    ];
    const check = checkSpend(
      [budget],
      records,
      { merchant: "store:stride", amount: usd(100) },
      NOW,
    );
    expect(check.outcome).toBe("covered");
  });

  it("runs an allowance down across periods until it is used up", () => {
    const allowance = rule({ kind: "allowance", id: "rule:allowance" });
    const records = [spent(60, { ruleId: "rule:allowance", at: "2026-11-02T00:00:00.000Z" })];
    expect(
      checkSpend([allowance], records, { merchant: "store:stride", amount: usd(40) }, NOW).outcome,
    ).toBe("covered");
    expect(
      checkSpend([allowance], records, { merchant: "store:stride", amount: usd(41) }, NOW),
    ).toMatchObject({ outcome: "exceeds", reason: "over-allowance" });
  });

  it("applies per-purchase caps", () => {
    const cap = rule({ kind: "per-purchase", limit: usd(25) });
    expect(checkSpend([cap], [], { merchant: "store:stride", amount: usd(25) }, NOW).outcome).toBe(
      "covered",
    );
    expect(checkSpend([cap], [], { merchant: "store:stride", amount: usd(26) }, NOW)).toMatchObject(
      {
        outcome: "exceeds",
        reason: "per-purchase-cap",
      },
    );
    const capped = rule({ kind: "budget", perPurchaseMax: usd(30) });
    expect(
      checkSpend([capped], [], { merchant: "store:stride", amount: usd(31) }, NOW),
    ).toMatchObject({ outcome: "exceeds", reason: "per-purchase-cap" });
  });

  it("refuses a different currency", () => {
    expect(
      checkSpend([budget], [], { merchant: "store:stride", amount: money(5, "GBP") }, NOW),
    ).toMatchObject({ outcome: "exceeds", reason: "currency" });
  });

  it("prefers the most specific covering rule, then the one with most left", () => {
    const anywhere = rule({
      kind: "budget",
      id: "rule:any",
      scope: { kind: "any" },
      limit: usd(500),
    });
    const category = rule({ kind: "budget", id: "rule:shoes", scope: shoes, limit: usd(300) });
    const purchase = { merchant: "store:stride", category: "shoes", amount: usd(50) };
    const pick = (rules: SpendingRule[], records: SpendRecord[] = []) => {
      const c = checkSpend(rules, records, purchase, NOW);
      return c.outcome === "covered" ? c.usage.rule.id : c.outcome;
    };
    expect(pick([anywhere, category, budget])).toBe("rule:budget");
    expect(pick([anywhere, category, budget], [spent(80)])).toBe("rule:shoes");
    const second = rule({ kind: "budget", id: "rule:budget2", limit: usd(200) });
    expect(pick([budget, second])).toBe("rule:budget2");
  });

  it("reports the most specific in-scope rule when none covers", () => {
    const anywhere = rule({
      kind: "per-purchase",
      id: "rule:any",
      scope: { kind: "any" },
      limit: usd(10),
    });
    const check = checkSpend(
      [anywhere, budget],
      [spent(100)],
      { merchant: "store:stride", amount: usd(20) },
      NOW,
    );
    expect(check).toMatchObject({ outcome: "exceeds", usage: { rule: { id: "rule:budget" } } });
  });

  it("finds no rule out of scope, before it starts, after it expires, or for odd input", () => {
    const later = rule({ kind: "budget", createdAt: "2026-11-20T00:00:00.000Z" });
    const expired = rule({ kind: "budget", expiresAt: "2026-11-12T00:00:00.000Z" });
    const p = { merchant: "store:stride", amount: usd(5) };
    expect(checkSpend([budget], [], { ...p, merchant: "store:other" }, NOW).outcome).toBe(
      "no-rule",
    );
    expect(checkSpend([later, expired, { bogus: true }], [], p, NOW).outcome).toBe("no-rule");
    expect(checkSpend([budget], [], { ...p, amount: usd(0) }, NOW).outcome).toBe("no-rule");
    expect(checkSpend([budget], [], { ...p, amount: { minor: -5 } as never }, NOW).outcome).toBe(
      "no-rule",
    );
    expect(activeRules([budget], new Date(Number.NaN))).toEqual([]);
  });

  it("reports per-purchase usage without a running total", () => {
    const cap = rule({ kind: "per-purchase", limit: usd(25) });
    expect(ruleUsage(cap, [spent(20, { ruleId: cap.id })], usd(5), NOW)).toMatchObject({
      used: usd(0),
      remaining: usd(25),
    });
  });
});

describe("rule accounting lineage", () => {
  it.each([
    "budget",
    "allowance",
  ] as const)("counts the whole %s lineage without counting refunds or other rules", (kind) => {
    const raised = rule({
      kind,
      id: "rule:raised",
      limit: usd(150),
      supersedes: ["rule:first", "rule:second"],
    });
    const usage = ruleUsage(
      raised,
      [
        spent(20, { ruleId: "rule:first" }),
        spent(12, { ruleId: "rule:second" }),
        spent(85, { ruleId: "rule:raised" }),
        spent(90, { ruleId: "rule:other" }),
        spent(10, { ruleId: "rule:first", refunded: true }),
        spent(10, { ruleId: undefined }),
      ],
      usd(0),
      NOW,
    );
    expect(isSpendingRule(raised)).toBe(true);
    expect(usage.used).toEqual(usd(117));
    expect(usage.remaining).toEqual(usd(33));
  });

  it.each([
    null,
    "rule:old",
    [],
    Array(1),
    [1],
    ["bad id"],
    ["rule:allowance"],
    ["rule:old", "rule:old"],
  ])("rejects malformed supersedes %j", (supersedes) => {
    expect(isSpendingRule({ ...rule({ kind: "allowance" }), supersedes })).toBe(false);
  });
});
