// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  APPROVAL_TTL_MS,
  buildApprovalRequest,
  checkResponse,
  ruleFromDraft,
  standingWithheld,
} from "../src/approval.js";
import { evaluateAction, type GateInput } from "../src/gate.js";
import { money } from "../src/money.js";
import type { SpendingRule } from "../src/rules.js";
import type { SpendRecord } from "../src/spend.js";
import {
  defaultDraft,
  describeRule,
  raisedAmounts,
  ruleLabel,
  shortDate,
  suggestedAmounts,
  summarizeDraft,
} from "../src/summary.js";
import type { ApprovalRequest, RuleDraft } from "../src/types.js";
import { budget, field, input, NOW, party, purchase, share, stepUp, usd } from "./fixtures.js";

const stride = { kind: "merchant", merchant: "store:stride", label: "Stride & Co" } as const;

function ask(over: Partial<GateInput> = {}, declinedStanding?: number): ApprovalRequest {
  const i = input(over);
  return buildApprovalRequest(evaluateAction(i), {
    id: "req:1",
    digest: i.digest,
    now: NOW,
    action: i.action,
    ...(declinedStanding !== undefined ? { declinedStanding } : {}),
  });
}

const spent = (amount: number, ruleId = "rule:budget"): SpendRecord => ({
  id: `spend:${amount}`,
  ruleId,
  merchant: "store:stride",
  amount: usd(amount),
  at: "2026-11-10T10:00:00.000Z",
});

const types = (r: ApprovalRequest) => r.offered.map((o) => `${o.type}:${o.role}:${o.confirm}`);

describe("purchase requests", () => {
  it("offers approve once (tap), set a spending limit and not now for a small purchase", () => {
    const r = ask();
    expect(r.title).toBe("Buy Roadrunner Lite for $20?");
    expect(r.kind).toBe("purchase");
    expect(r.plainReason).toBe("Your rules say to ask before any purchase at Stride & Co.");
    expect(types(r)).toEqual([
      "approve-once:primary:tap",
      "set-limit:standing:hold",
      "deny:deny:tap",
    ]);
    expect(r.expiresAt).toBe(new Date(NOW.getTime() + APPROVAL_TTL_MS).toISOString());
    expect(r.binding).toBe(false);
    expect(r.meter).toBeUndefined();
    expect(r.historyNote).toBeUndefined();
    expect(r.standingWithheldReason).toBeUndefined();
    const limit = r.offered[1];
    expect(limit?.suggested).toEqual([5000, 10000, 15000]);
    expect(limit?.draft).toEqual({
      kind: "budget",
      period: "month",
      limit: usd(100),
      scope: stride,
      expiresAt: "2027-02-13T12:00:00.000Z",
    });
    expect(r.facts).toEqual([
      { label: "Store", value: "Stride & Co" },
      { label: "Item", value: "Roadrunner Lite, size 9, grey" },
      { label: "Price", value: "$20" },
      { label: "Total", value: "$20" },
      { label: "Pay with", value: "Card ending 4417" },
    ]);
  });

  it("lists quantities, fees, delivery and returns, and names several items", () => {
    const r = ask({
      action: purchase({
        items: [
          { name: "Trail socks", qty: 2, price: usd(6) },
          { name: "Laces", qty: 1, price: usd(3) },
          { name: "Insoles", qty: 1, price: usd(9) },
        ],
        fees: [
          { label: "Delivery fee", amount: usd("3.99") },
          { label: "Gift wrap", amount: usd(0) },
        ],
        total: usd("27.99"),
        delivery: "Thu Nov 19",
        returns: "Free for 30 days",
      }),
    });
    expect(r.title).toBe("Buy 3 items for $27.99?");
    expect(r.facts.map((f) => `${f.label}=${f.value}`)).toEqual([
      "Store=Stride & Co",
      "Item=2 × Trail socks",
      "Item=Laces",
      "Item=Insoles",
      "Price=$24",
      "Delivery fee=$3.99",
      "Delivery=Thu Nov 19",
      "Total=$27.99",
      "Pay with=Card ending 4417",
      "Returns=Free for 30 days",
    ]);
    const two = ask({
      action: purchase({
        items: [
          { name: "Socks", qty: 2, price: usd(6) },
          { name: "Laces", qty: 1, price: usd(3) },
        ],
        total: usd(15),
      }),
    });
    expect(two.title).toBe("Buy 2 × Socks and Laces for $15?");
  });

  it("asks for a hold on larger, costly or unconfirmed purchases", () => {
    expect(ask({ action: purchase({ total: usd(50) }) }).offered[0]?.confirm).toBe("hold");
    expect(ask({ action: purchase({ reversibility: "costly" }) }).offered[0]?.confirm).toBe("hold");
    expect(ask({ action: purchase({ reversibility: "reversible" }) }).offered[0]?.confirm).toBe(
      "tap",
    );
    const fresh = ask({
      action: purchase({ recipient: party({ established: "not-established" }) }),
    });
    expect(fresh.kind).toBe("new-recipient");
    expect(fresh.title).toBe("Deal with Stride & Co for the first time?");
    expect(types(fresh)).toEqual(["approve-once:primary:hold", "deny:deny:tap"]);
    expect(fresh.offered[0]?.label).toBe("Allow this time");
    expect(fresh.standingWithheldReason).toBe("A limit can be set once Stride & Co is confirmed.");
  });

  it("makes the limit the primary choice once the principal approved the store twice", () => {
    const r = ask({
      action: purchase({ recipient: party({ history: { purchases: 2, shares: 0 } }) }),
    });
    expect(types(r)).toEqual([
      "approve-once:standing:tap",
      "set-limit:primary:hold",
      "deny:deny:tap",
    ]);
    expect(r.historyNote).toBe("You have approved Stride & Co 2 times.");
  });

  it("withholds a standing option where design section 3 says so", () => {
    const irreversible = ask({
      action: purchase({
        reversibility: "irreversible",
        recipient: party({ history: { purchases: 5, shares: 0 } }),
      }),
    });
    expect(types(irreversible)).toEqual(["approve-once:primary:hold", "deny:deny:tap"]);
    expect(irreversible.standingWithheldReason).toBe(
      "This cannot be undone, so I will ask every time.",
    );
    expect(irreversible.historyNote).toBeUndefined();
    const declined = ask({}, 2);
    expect(declined.offered.map((o) => o.type)).toEqual(["approve-once", "deny"]);
    const big = ask({ action: purchase({ total: usd(600) }), rules: [budget] });
    expect(big.standingWithheldReason).toBe("Purchases over $500 always need your OK.");
    expect(big.meter).toMatchObject({
      ruleId: "rule:budget",
      label: "$100 a month at Stride & Co",
    });
  });

  it("explains every reason a standing option is withheld", () => {
    expect(standingWithheld(purchase({ origin: "content" }), 0)).toMatch(/page content/);
    expect(standingWithheld(purchase(), 1)).toBeUndefined();
    expect(standingWithheld(purchase(), 2)).toMatch(/not offer it again/);
  });

  it("shows the meter and offers just this once or raise limit when a budget is exceeded", () => {
    const r = ask({
      action: purchase({
        items: [{ name: "Stormshell jacket", variant: "M, black", qty: 1, price: usd(85) }],
        total: usd(85),
      }),
      rules: [budget],
      records: [spent(32)],
    });
    expect(r.kind).toBe("limit-exceeded");
    expect(r.title).toBe("This goes over your $100 a month at Stride & Co by $17");
    expect(r.plainReason).toBe("$68 of your limit is left this month.");
    expect(r.meter).toEqual({
      ruleId: "rule:budget",
      label: "$100 a month at Stride & Co",
      used: usd(32),
      limit: usd(100),
      after: usd(117),
      resetsAt: "2026-12-01T00:00:00.000Z",
    });
    expect(r.facts.map((f) => f.value)).toEqual([
      "Stormshell jacket, M, black",
      "$85",
      "$32",
      "$117",
    ]);
    expect(r.facts[3]).toMatchObject({ label: "After this", emphasis: "over" });
    expect(types(r)).toEqual([
      "approve-once:primary:hold",
      "raise-limit:standing:hold",
      "deny:deny:tap",
    ]);
    const raise = r.offered[1];
    expect(raise?.replacesRuleId).toBe("rule:budget");
    expect(raise?.suggested).toEqual([15000, 20000, 30000]);
    expect(raise?.draft).toEqual({
      kind: "budget",
      limit: usd(150),
      scope: stride,
      period: "month",
    });
  });

  it("carries a covering cap and the expiry into a raised budget, and drops a cap that is too low", () => {
    const capped: SpendingRule = {
      ...budget,
      perPurchaseMax: usd(90),
      expiresAt: "2027-01-01T00:00:00.000Z",
    };
    const r = ask({ action: purchase({ total: usd(85) }), rules: [capped], records: [spent(32)] });
    expect(r.offered[1]?.draft).toMatchObject({
      perPurchaseMax: usd(90),
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    const low: SpendingRule = { ...budget, limit: usd(300), perPurchaseMax: usd(50) };
    const over = ask({ action: purchase({ total: usd(85) }), rules: [low] });
    expect(over.title).toBe("This goes over your $300 a month at Stride & Co");
    expect(over.offered[1]?.draft?.perPurchaseMax).toBeUndefined();
  });

  it("words a per-purchase limit and an allowance", () => {
    const each: SpendingRule = {
      id: "rule:each",
      kind: "per-purchase",
      limit: usd(50),
      scope: stride,
      createdAt: budget.createdAt,
    };
    const r = ask({ action: purchase({ total: usd(85) }), rules: [each] });
    expect(r.title).toBe("This goes over your $50 per purchase at Stride & Co by $35");
    expect(r.plainReason).toBe("Your limit is $50 for each purchase.");
    expect(r.facts.map((f) => `${f.label}=${f.value}`)).toContain("Your limit=$50 per purchase");
    expect(r.offered[1]?.draft).toEqual({ kind: "per-purchase", limit: usd(100), scope: stride });
    const pot: SpendingRule = {
      id: "rule:pot",
      kind: "allowance",
      limit: usd(60),
      scope: stride,
      createdAt: budget.createdAt,
    };
    const a = ask({
      action: purchase({ items: [{ name: "Gift card", qty: 1, price: usd(30) }], total: usd(30) }),
      rules: [pot],
      records: [spent(40, "rule:pot")],
    });
    expect(a.plainReason).toBe("$20 of your limit is left.");
    expect(a.facts.map((f) => f.label)).toContain("Used so far");
    expect(a.facts[0]).toEqual({ label: "Item", value: "Gift card" });
    expect(a.meter?.resetsAt).toBeUndefined();
  });

  it("offers no raise when a standing option is withheld", () => {
    const r = ask(
      { action: purchase({ total: usd(85) }), rules: [budget], records: [spent(32)] },
      2,
    );
    expect(r.offered.map((o) => o.type)).toEqual(["approve-once", "deny"]);
  });
});

describe("sharing and step-up requests", () => {
  it("lists the terms, the sensitivity, and offers share or share fewer", () => {
    const r = ask({
      action: share({
        eachTimeApproval: true,
        fields: [
          field(),
          field({
            id: "employer",
            kind: "employer",
            label: "Employer",
            sensitivity: "personal",
            required: false,
          }),
          field({ id: "tx", state: "withheld-by-gate", sensitivity: "special" }),
        ],
        terms: {
          purpose: "Mortgage application",
          retentionDays: 90,
          onwardSharing: "Its underwriter only",
          prohibitedUses: ["Marketing", "Resale"],
        },
      }),
    });
    expect(r.kind).toBe("disclosure");
    expect(r.title).toBe("Share 2 things with North Bank?");
    expect(r.sensitivity).toBe("financial");
    expect(r.reversibility).toBe("irreversible");
    expect(r.standingWithheldReason).toBe("This kind of sharing needs your OK each time.");
    expect(r.facts.map((f) => f.value)).toEqual([
      "Mortgage application",
      "Up to 90 days, then deleted",
      "Its underwriter only",
      "Marketing, Resale",
    ]);
    expect(types(r)).toEqual([
      "approve-once:primary:hold",
      "share-less:primary:hold",
      "deny:deny:tap",
    ]);
    expect(r.offered[0]?.label).toBe("Share 2");
  });

  it("words one thing, and the reason no standing option is offered", () => {
    const one = ask({
      action: share({
        fields: [field({ sensitivity: "special" })],
        terms: { purpose: "Checks", prohibitedUses: [] },
      }),
    });
    expect(one.title).toBe("Share 1 thing with North Bank?");
    expect(one.facts).toEqual([{ label: "Purpose", value: "Checks" }]);
    expect(one.standingWithheldReason).toBe("Financial and sensitive data always needs your OK.");
    expect(one.offered.map((o) => o.type)).toEqual(["approve-once", "deny"]);
    const plain = ask({
      action: share({
        fields: [field({ sensitivity: "personal" }), field({ id: "x", sensitivity: "none" })],
      }),
    });
    expect(plain.sensitivity).toBe("personal");
    expect(plain.standingWithheldReason).toBe(
      "Standing permission for sharing is not offered yet.",
    );
  });

  it("builds a step-up request for a face check or a passkey", () => {
    const r = ask({ action: stepUp() });
    expect(r.title).toBe("Harbour Bank needs a face check before it releases your bank balance");
    expect(r.facts[1]).toEqual({ label: "Releases", value: "Your bank balance" });
    expect(types(r)).toEqual(["step-up-done:primary:step-up", "deny:deny:tap"]);
    expect(r.offered[0]?.label).toBe("Start face check");
    expect(ask({ action: stepUp({ method: "passkey" }) }).offered[0]?.label).toBe(
      "Start passkey check",
    );
  });

  it("refuses to build a request when the gate did not ask", () => {
    const i = input({ rules: [budget] });
    expect(() =>
      buildApprovalRequest(evaluateAction(i), {
        id: "x",
        digest: i.digest,
        now: NOW,
        action: i.action,
      }),
    ).toThrow(/did not ask/);
  });
});

describe("rules from drafts", () => {
  it("fills period, cap and expiry only where they apply", () => {
    const draft: RuleDraft = {
      kind: "budget",
      limit: usd(100),
      scope: stride,
      perPurchaseMax: usd(40),
      expiresAt: "2027-01-01T00:00:00.000Z",
    };
    expect(ruleFromDraft(draft, "r1", NOW)).toEqual({
      id: "r1",
      kind: "budget",
      limit: usd(100),
      period: "month",
      perPurchaseMax: usd(40),
      scope: stride,
      createdAt: NOW.toISOString(),
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    expect(ruleFromDraft({ ...draft, period: "week" }, "r1", NOW).period).toBe("week");
    const each = ruleFromDraft(
      { kind: "per-purchase", limit: usd(50), scope: stride, perPurchaseMax: usd(40) },
      "r2",
      NOW,
    );
    expect(each).toEqual({
      id: "r2",
      kind: "per-purchase",
      limit: usd(50),
      scope: stride,
      createdAt: NOW.toISOString(),
    });
  });
});

describe("checkResponse", () => {
  const req = ask();
  const draft = req.offered[1]?.draft as RuleDraft;

  it("rejects a response for another request or digest", () => {
    const response = {
      type: "approve-once" as const,
      offeredId: "once",
      requestId: req.id,
      digest: req.digest,
    };
    expect(checkResponse(req, { ...response, requestId: "req:other" }, NOW)).toEqual({
      ok: false,
      reason: "request-mismatch",
    });
    expect(checkResponse(req, { ...response, digest: "sha256:other" }, NOW)).toEqual({
      ok: false,
      reason: "digest-mismatch",
    });
  });

  it("accepts an offered response and returns the rule for a limit", () => {
    expect(
      checkResponse(
        req,
        { requestId: req.id, digest: req.digest, type: "approve-once", offeredId: "once" },
        NOW,
      ),
    ).toMatchObject({
      ok: true,
    });
    const r = checkResponse(
      req,
      { requestId: req.id, digest: req.digest, type: "set-limit", offeredId: "set-limit", draft },
      NOW,
    );
    expect(r).toMatchObject({ ok: true, rule: { id: "rule:req:1", kind: "budget" } });
    expect(
      checkResponse(
        req,
        { requestId: req.id, digest: req.digest, type: "set-limit", offeredId: "set-limit", draft },
        NOW,
        "r9",
      ),
    ).toMatchObject({ rule: { id: "r9" } });
  });

  it("refuses responses that were not offered, or that came too late", () => {
    expect(
      checkResponse(
        req,
        { requestId: req.id, digest: req.digest, type: "approve-once", offeredId: "nope" },
        NOW,
      ),
    ).toEqual({
      ok: false,
      reason: "not-offered",
    });
    expect(
      checkResponse(
        req,
        { requestId: req.id, digest: req.digest, type: "deny", offeredId: "once" },
        NOW,
      ),
    ).toEqual({
      ok: false,
      reason: "not-offered",
    });
    const late = new Date(NOW.getTime() + APPROVAL_TTL_MS);
    expect(
      checkResponse(
        req,
        { requestId: req.id, digest: req.digest, type: "approve-once", offeredId: "once" },
        late,
      ),
    ).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a malformed, foreign-currency or huge limit", () => {
    const bad = (d: RuleDraft) =>
      checkResponse(
        req,
        {
          requestId: req.id,
          digest: req.digest,
          type: "set-limit",
          offeredId: "set-limit",
          draft: d,
        },
        NOW,
      );
    expect(bad({ ...draft, limit: usd(0) })).toEqual({ ok: false, reason: "invalid-limit" });
    expect(bad({ ...draft, limit: money(100, "GBP") })).toEqual({
      ok: false,
      reason: "invalid-limit",
    });
    expect(bad({ ...draft, limit: usd(5001) })).toEqual({ ok: false, reason: "invalid-limit" });
    const forged: ApprovalRequest = {
      ...ask({ action: share() }),
      offered: [
        { id: "set-limit", type: "set-limit", label: "x", role: "standing", confirm: "hold" },
      ],
    };
    expect(
      checkResponse(
        forged,
        {
          requestId: forged.id,
          digest: forged.digest,
          type: "set-limit",
          offeredId: "set-limit",
          draft,
        },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "invalid-limit" });
  });

  it("checks a share-fewer selection against the offered and required fields", () => {
    const r = ask({
      action: share({
        fields: [
          field(),
          field({ id: "employer", required: false }),
          field({ id: "tx", state: "withheld-by-gate" }),
        ],
      }),
    });
    const less = (keep: string[]) =>
      checkResponse(
        r,
        { requestId: r.id, digest: r.digest, type: "share-less", offeredId: "share-less", keep },
        NOW,
      );
    expect(less(["income"])).toMatchObject({ ok: true });
    expect(less(["income", "tx"])).toEqual({ ok: false, reason: "invalid-selection" });
    expect(less(["employer"])).toEqual({ ok: false, reason: "invalid-selection" });
    const optionalOnly = ask({ action: share({ fields: [field({ required: false })] }) });
    expect(
      checkResponse(
        optionalOnly,
        {
          requestId: optionalOnly.id,
          digest: optionalOnly.digest,
          type: "share-less",
          offeredId: "share-less",
          keep: [],
        },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "invalid-selection" });
    const forged: ApprovalRequest = {
      ...req,
      offered: [
        { id: "share-less", type: "share-less", label: "x", role: "primary", confirm: "hold" },
      ],
    };
    expect(
      checkResponse(
        forged,
        {
          requestId: forged.id,
          digest: forged.digest,
          type: "share-less",
          offeredId: "share-less",
          keep: ["income"],
        },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "not-offered" });
  });

  it("needs an attestation for a step-up", () => {
    const r = ask({ action: stepUp() });
    expect(
      checkResponse(
        r,
        {
          requestId: r.id,
          digest: r.digest,
          type: "step-up-done",
          offeredId: "step-up",
          attestation: "",
        },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "no-attestation" });
    expect(
      checkResponse(
        r,
        {
          requestId: r.id,
          digest: r.digest,
          type: "step-up-done",
          offeredId: "step-up",
          attestation: "jws",
        },
        NOW,
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("summary wording and defaults", () => {
  it("formats dates, adding the year only when it differs", () => {
    expect(shortDate("2027-02-13T00:00:00.000Z")).toBe("Feb 13");
    expect(shortDate("2027-02-13T00:00:00.000Z", NOW)).toBe("Feb 13, 2027");
    expect(shortDate("2026-12-01T00:00:00.000Z", NOW)).toBe("Dec 1");
  });

  it("describes and labels every kind and scope", () => {
    const shoes = { kind: "category", category: "shoes", label: "Shoes" } as const;
    const any = { kind: "any" } as const;
    expect(describeRule({ kind: "per-purchase", limit: usd(50), scope: shoes })).toBe(
      "your $50 per purchase on shoes",
    );
    expect(describeRule({ kind: "budget", period: "week", limit: usd(50), scope: any })).toBe(
      "your $50 a week at any store",
    );
    expect(describeRule({ kind: "allowance", limit: usd(50), scope: stride })).toBe(
      "your $50 allowance at Stride & Co",
    );
    expect(ruleLabel({ kind: "per-purchase", limit: usd(50), scope: shoes })).toBe(
      "$50 per purchase on shoes",
    );
    expect(ruleLabel(budget)).toBe("$100/month at Stride & Co");
    expect(ruleLabel({ kind: "allowance", limit: usd(50), scope: any })).toBe(
      "$50 allowance at any store",
    );
  });

  it("summarises a draft in the editor's words", () => {
    const end = "2027-02-13T12:00:00.000Z";
    expect(
      summarizeDraft(
        { kind: "budget", period: "month", limit: usd(100), scope: stride, expiresAt: end },
        "Errand",
        NOW,
      ),
    ).toBe(
      "Errand can spend up to $100 a month at Stride & Co without asking. It will tell you after each purchase. Ends Feb 13, 2027.",
    );
    expect(
      summarizeDraft(
        { kind: "budget", period: "week", limit: usd(100), scope: stride, perPurchaseMax: usd(40) },
        "Errand",
        NOW,
      ),
    ).toBe(
      "Errand can spend up to $100 a week at Stride & Co without asking, as long as each purchase is $40 or less. It will tell you after each purchase.",
    );
    expect(
      summarizeDraft({ kind: "per-purchase", limit: usd(30), scope: stride }, "Errand", NOW),
    ).toBe(
      "Errand can make purchases of $30 or less at Stride & Co without asking. No monthly total.",
    );
    expect(
      summarizeDraft({ kind: "allowance", limit: usd(60), scope: stride }, "Errand", NOW),
    ).toBe(
      "Errand can spend $60 in total at Stride & Co, then it asks again. It ends when used up.",
    );
    expect(
      summarizeDraft(
        { kind: "allowance", limit: usd(60), scope: stride, expiresAt: end },
        "Errand",
        NOW,
      ),
    ).toMatch(/asks again\. Ends Feb 13, 2027\.$/);
  });

  it("suggests five times the price, rounded to a step, with neighbours", () => {
    expect(suggestedAmounts(usd(20))).toEqual([5000, 10000, 15000]);
    expect(suggestedAmounts(usd(2))).toEqual([2500, 5000, 10000]);
    expect(suggestedAmounts(usd(90))).toEqual([20000, 30000, 50000]);
    expect(suggestedAmounts(usd(400))).toEqual([20000, 30000, 50000]);
  });

  it("starts the editor on a monthly budget, a per-purchase limit for big items, and caps large budgets", () => {
    expect(defaultDraft(usd(20), stride, NOW)).toMatchObject({ kind: "budget", limit: usd(100) });
    expect(defaultDraft(usd(250), stride, NOW)).toEqual({
      kind: "per-purchase",
      limit: usd(250),
      scope: stride,
      expiresAt: "2027-02-13T12:00:00.000Z",
    });
    expect(defaultDraft(usd(50), stride, NOW)).toMatchObject({
      limit: usd(300),
      perPurchaseMax: usd(150),
    });
    expect(defaultDraft(usd(150), stride, NOW)).toMatchObject({
      limit: usd(500),
      perPurchaseMax: usd(250),
    });
  });

  it("raises to the next step that covers what is needed", () => {
    expect(raisedAmounts(usd(100), 11700)).toEqual([15000, 20000, 30000]);
    expect(raisedAmounts(usd(500), 61000)).toEqual([62500]);
  });
});
