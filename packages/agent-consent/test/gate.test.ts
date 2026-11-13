// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { CHECK_ORDER, evaluateAction } from "../src/gate.js";
import { MAX_MINOR, type Money, money } from "../src/money.js";
import type { SpendingRule } from "../src/rules.js";
import type { SpendRecord } from "../src/spend.js";
import type { PurchaseAction } from "../src/types.js";
import { budget, field, input, party, purchase, share, stepUp, usd } from "./fixtures.js";

const spent = (amount: number): SpendRecord => ({
  id: `spend:${amount}`,
  ruleId: "rule:budget",
  merchant: "store:stride",
  amount: usd(amount),
  at: "2026-11-10T10:00:00.000Z",
});

describe("evaluateAction: purchases", () => {
  const item = { name: "Trail socks", qty: 1, price: usd(20) };
  const each: SpendingRule = { ...budget, kind: "per-purchase", period: undefined, limit: usd(10) };

  function expectInconsistent(action: PurchaseAction) {
    for (const approvals of [new Set<string>(), new Set(["sha256:abc"])]) {
      const result = evaluateAction(input({ action, rules: [each], approvals }));
      expect(result).toMatchObject({
        outcome: "stop",
        decidedBy: { check: "mandate", reason: "inconsistent-amount" },
      });
      expect(result.checks[0]).toMatchObject({
        check: "mandate",
        result: "fail",
        code: "inconsistent-amount",
      });
      expect(result.checks[0]?.plain).toMatch(/[A-Za-z]+ [A-Za-z]+/);
      expect(result.checks.slice(1).every((check) => check.result === "pending")).toBe(true);
      expect(result.basis).toBeUndefined();
      expect(result.spend).toBeUndefined();
    }
  }

  it.each<[string, Partial<PurchaseAction>]>([
    ["ten $20 items declared as $1", { items: [{ ...item, qty: 10 }], total: usd(1) }],
    ["a $500 fee omitted from the total", { fees: [{ label: "Fee", amount: usd(500) }] }],
    ["GBP items with a USD total", { items: [{ ...item, price: money(20, "GBP") }] }],
    ["a GBP fee with a USD total", { fees: [{ label: "Fee", amount: money(0, "GBP") }] }],
    ["an overstated total", { items: [item], total: usd(21) }],
    ["a product above MAX_MINOR", { items: [{ ...item, qty: MAX_MINOR, price: usd(1) }] }],
    [
      "an unsafe product",
      {
        items: [
          { ...item, qty: Number.MAX_SAFE_INTEGER, price: { minor: MAX_MINOR, currency: "USD" } },
        ],
      },
    ],
    [
      "an item sum above MAX_MINOR",
      { items: [{ ...item, price: { minor: MAX_MINOR, currency: "USD" } }, item] },
    ],
    [
      "a fee sum above MAX_MINOR",
      {
        items: [{ ...item, price: usd(0) }],
        fees: [
          { label: "Fee", amount: { minor: MAX_MINOR, currency: "USD" } },
          { label: "Extra fee", amount: usd(1) },
        ],
      },
    ],
  ])("third review: rejects %s before rules or exact approval", (_name, overrides) => {
    expectInconsistent(purchase(overrides));
  });

  it.each([
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
  ])("rejects invalid quantity %s", (qty) =>
    expectInconsistent(purchase({ items: [{ ...item, qty: qty as number }] })));

  it.each([
    null,
    {},
    { minor: -1, currency: "USD" },
    { minor: 0.5, currency: "USD" },
    { minor: MAX_MINOR + 1, currency: "USD" },
    { minor: 1, currency: "usd" },
  ])("rejects invalid money %j in the total, any item or any fee", (value) => {
    const invalid = value as Money;
    expectInconsistent(purchase({ total: invalid }));
    expectInconsistent(purchase({ items: [item, { ...item, price: invalid }] }));
    expectInconsistent(
      purchase({
        fees: [
          { label: "Fee", amount: usd(0) },
          { label: "Bad fee", amount: invalid },
        ],
      }),
    );
  });

  it("accepts reconciled quantities, multiple items and fees, including the maximum amount", () => {
    const action = purchase({
      items: [
        { ...item, qty: 2, price: usd(2) },
        { ...item, price: usd(3) },
      ],
      fees: [
        { label: "Delivery", amount: usd(1) },
        { label: "Handling", amount: usd(2) },
      ],
      total: usd(10),
    });
    expect(evaluateAction(input({ action, rules: [each] }))).toMatchObject({
      outcome: "go",
      basis: "rule",
    });
    for (const action of [
      purchase({
        items: [{ ...item, qty: 2, price: { minor: (MAX_MINOR - 2) / 2, currency: "USD" } }],
        fees: [{ label: "Fee", amount: { minor: 2, currency: "USD" } }],
        total: { minor: MAX_MINOR, currency: "USD" },
      }),
      purchase({
        items: [{ ...item, qty: Number.MAX_SAFE_INTEGER, price: usd(0) }],
        total: usd(0),
      }),
    ]) {
      expect(evaluateAction(input({ action, approvals: new Set(["sha256:abc"]) }))).toMatchObject({
        outcome: "go",
        basis: "approval",
      });
    }
  });

  it("always returns the six checks in order", () => {
    const r = evaluateAction(input());
    expect(r.checks.map((c) => c.check)).toEqual(CHECK_ORDER);
  });

  it("stops a purchase that came from page content, before any other check", () => {
    const r = evaluateAction(input({ action: purchase({ origin: "content" }) }));
    expect(r.outcome).toBe("stop");
    expect(r.decidedBy).toEqual({ check: "mandate", reason: "not-authorised" });
    expect(r.kind).toBeUndefined();
    expect(r.checks.slice(1).every((c) => c.result === "pending")).toBe(true);
    expect(r.checks[1]?.plain).toBe("Not checked: an earlier check stopped this.");
    expect(r.spend).toBeUndefined();
  });

  it("stops a category the mandate does not allow", () => {
    const r = evaluateAction(input({ action: purchase({ category: "electronics" }) }));
    expect(r.outcome).toBe("stop");
    expect(r.decidedBy).toEqual({ check: "mandate", reason: "prohibited" });
  });

  it("asks about a store it cannot establish, even with a covering rule", () => {
    const r = evaluateAction(
      input({
        action: purchase({ recipient: party({ established: "not-established" }) }),
        rules: [budget],
      }),
    );
    expect(r.outcome).toBe("ask");
    expect(r.kind).toBe("new-recipient");
    expect(r.decidedBy).toEqual({ check: "recipient", reason: "recipient-not-established" });
    expect(r.checks[2]?.plain).toBe("Waiting for your answer.");
  });

  it("asks before any purchase when no rule covers it", () => {
    const r = evaluateAction(input());
    expect(r.outcome).toBe("ask");
    expect(r.kind).toBe("purchase");
    expect(r.decidedBy).toEqual({ check: "limits-and-approval", reason: "owner-approval" });
    expect(r.checks[4]?.plain).toBe("Your rules say to ask before any purchase at Stride & Co.");
    expect(r.checks[1]?.plain).toContain("on your list");
    expect(r.spend?.outcome).toBe("no-rule");
  });

  it("goes when a spending rule covers it, and says which", () => {
    const r = evaluateAction(input({ rules: [budget], records: [spent(12)] }));
    expect(r.outcome).toBe("go");
    expect(r.basis).toBe("rule");
    expect(r.decidedBy).toBeUndefined();
    expect(r.checks[4]).toEqual({
      check: "limits-and-approval",
      result: "pass",
      plain: "Inside your $100 a month at Stride & Co.",
      code: "within-limits",
    });
    expect(r.checks[5]).toMatchObject({ result: "pass", code: "record-kept" });
  });

  it.each([
    "budget",
    "allowance",
    "per-purchase",
  ] as const)("second review: an irreversible purchase needs exact approval even with a %s", (kind) => {
    const { period: _period, ...base } = budget;
    const rules = [{ ...base, kind, ...(kind === "budget" ? { period: "month" as const } : {}) }];
    const action = purchase({ reversibility: "irreversible", total: usd(12) });
    expect(evaluateAction(input({ action, rules }))).toMatchObject({
      outcome: "ask",
      kind: "purchase",
      decidedBy: { check: "limits-and-approval", reason: "irreversible" },
    });
    expect(
      evaluateAction(input({ action, rules, approvals: new Set(["sha256:other"]) })).outcome,
    ).toBe("ask");
    expect(
      evaluateAction(input({ action, rules, approvals: new Set(["sha256:abc"]) })),
    ).toMatchObject({
      outcome: "go",
      basis: "approval",
    });
  });

  it("asks when the purchase goes over the rule", () => {
    const r = evaluateAction(
      input({ action: purchase({ total: usd(85) }), rules: [budget], records: [spent(32)] }),
    );
    expect(r.outcome).toBe("ask");
    expect(r.kind).toBe("limit-exceeded");
    expect(r.checks[4]?.plain).toBe("This goes over your $100 a month at Stride & Co.");
    expect(r.spend?.outcome).toBe("exceeds");
  });

  it("goes with an approval of this exact digest, whatever the rules say", () => {
    const r = evaluateAction(
      input({
        action: purchase({ total: usd(85) }),
        rules: [budget],
        records: [spent(32)],
        approvals: new Set(["sha256:abc"]),
      }),
    );
    expect(r.outcome).toBe("go");
    expect(r.basis).toBe("approval");
    expect(r.spend?.outcome).toBe("exceeds");
  });

  it("does not accept an approval of a different digest", () => {
    const r = evaluateAction(input({ approvals: new Set(["sha256:other"]) }));
    expect(r.outcome).toBe("ask");
  });

  it("asks above the single-action ceiling even when a rule would cover it", () => {
    const big: SpendingRule = { ...budget, limit: usd(2000) };
    for (const total of [usd(600), money(20, "GBP")]) {
      const r = evaluateAction(input({ action: purchase({ total }), rules: [big] }));
      expect(r.outcome).toBe("ask");
      expect(r.kind).toBe("purchase");
    }
    const r = evaluateAction(input({ action: purchase({ total: usd(600) }), rules: [big] }));
    expect(r.checks[4]?.plain).toBe("Purchases over $500 always need your OK.");
    const over = evaluateAction(input({ action: purchase({ total: usd(600) }), rules: [budget] }));
    expect(over.kind).toBe("purchase");
    expect(over.spend?.outcome).toBe("exceeds");
  });

  it("describes root and register recipients", () => {
    const root = evaluateAction(
      input({ action: purchase({ recipient: party({ established: "root" }) }) }),
    );
    expect(root.checks[1]?.plain).toContain("vouched for by a root you trust");
    const reg = evaluateAction(
      input({ action: purchase({ recipient: party({ established: "register" }) }) }),
    );
    expect(reg.checks[1]?.plain).toContain("found through the sector register");
  });
});

describe("evaluateAction: sharing", () => {
  it("stops sharing asked for by content", () => {
    const r = evaluateAction(input({ action: share({ origin: "content" }) }));
    expect(r).toMatchObject({
      outcome: "stop",
      decidedBy: { check: "mandate", reason: "not-authorised" },
    });
  });

  it("stops a field the principal never shares, but not one the gate already withheld", () => {
    const id = field({ id: "passport", kind: "identity-document", label: "Identity document" });
    const r = evaluateAction(input({ action: share({ fields: [field(), id] }) }));
    expect(r).toMatchObject({ outcome: "stop", decidedBy: { reason: "prohibited" } });
    expect(r.checks[0]?.plain).toBe("Your rules say never to share identity document.");
    const withheld = evaluateAction(
      input({ action: share({ fields: [field(), { ...id, state: "withheld-by-gate" }] }) }),
    );
    expect(withheld.outcome).toBe("ask");
  });

  it("stops when nothing is left to share", () => {
    const r = evaluateAction(
      input({ action: share({ fields: [field({ state: "withheld-by-gate" })] }) }),
    );
    expect(r).toMatchObject({ outcome: "stop", decidedBy: { reason: "no-data" } });
  });

  it("asks about an unestablished recipient first", () => {
    const r = evaluateAction(
      input({ action: share({ recipient: party({ established: "not-established" }) }) }),
    );
    expect(r.kind).toBe("new-recipient");
  });

  it("asks the principal to approve a disclosure, counting what was declined", () => {
    const r = evaluateAction(
      input({
        action: share({ fields: [field(), field({ id: "tx", state: "withheld-by-gate" })] }),
      }),
    );
    expect(r.outcome).toBe("ask");
    expect(r.kind).toBe("disclosure");
    expect(r.decidedBy?.check).toBe("disclosure");
    expect(r.checks[2]?.plain).toBe(
      "North Bank asks for one thing about you. I declined 1 you do not need to share.",
    );
    const two = evaluateAction(input({ action: share() }));
    expect(two.checks[2]?.plain).toBe("North Bank asks for 2 things about you.");
  });

  it("goes once the exact disclosure is approved, and states the terms", () => {
    const approvals = new Set(["sha256:abc"]);
    const r = evaluateAction(input({ action: share(), approvals }));
    expect(r.outcome).toBe("go");
    expect(r.basis).toBe("approval");
    expect(r.spend).toBeUndefined();
    expect(r.checks[3]?.plain).toBe("Used for mortgage application, kept 90 days.");
    expect(r.checks[4]).toEqual({
      check: "limits-and-approval",
      result: "not-applicable",
      plain: "No money moves.",
    });
    const longer = evaluateAction(
      input({ action: share({ terms: { purpose: "X", retentionDays: 365 } }), approvals }),
    );
    expect(longer.checks[3]?.plain).toBe("You allowed 365 days this time (your rule is 90).");
    const open = evaluateAction(
      input({ action: share({ terms: { purpose: "Checks" } }), approvals }),
    );
    expect(open.checks[3]?.plain).toBe("Used for checks.");
  });
});

describe("evaluateAction: step-up", () => {
  it("asks for a stronger approval until an attestation for this digest arrives", () => {
    const r = evaluateAction(input({ action: stepUp() }));
    expect(r).toMatchObject({
      outcome: "ask",
      kind: "step-up",
      decidedBy: { check: "limits-and-approval", reason: "assurance-insufficient" },
    });
    expect(r.checks[2]?.result).toBe("not-applicable");
    const done = evaluateAction(input({ action: stepUp(), attestations: new Set(["sha256:abc"]) }));
    expect(done).toMatchObject({ outcome: "go", basis: "attestation" });
    expect(done.checks[4]?.plain).toBe("The identity provider confirmed it is you.");
  });

  it("asks about an unestablished party first", () => {
    const r = evaluateAction(
      input({ action: stepUp({ recipient: party({ established: "not-established" }) }) }),
    );
    expect(r.kind).toBe("new-recipient");
  });
});

describe("exact consent for an unestablished recipient", () => {
  it.each([
    purchase(),
    share(),
    stepUp(),
  ])("only permits the approved $type interaction", (original) => {
    const action = { ...original, recipient: party({ established: "not-established" }) };
    const approved = input({
      action,
      approvals: new Set(["sha256:abc"]),
      attestations: new Set(["sha256:abc"]),
    });
    expect(evaluateAction(approved)).toMatchObject({ outcome: "go" });
    expect(evaluateAction(approved).checks[1]).toMatchObject({
      result: "pass",
      code: "approved-once-recipient",
    });
    expect(action.recipient.established).toBe("not-established");
    expect(evaluateAction({ ...approved, digest: "sha256:other" }).kind).toBe("new-recipient");
    expect(evaluateAction({ ...approved, approvals: new Set() }).kind).toBe("new-recipient");
  });
});
