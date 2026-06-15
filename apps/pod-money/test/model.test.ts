// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  Balance,
  Category,
  FinanceDocument,
  FinancialAccount,
  Holding,
  MonetaryAmount,
  Transaction,
} from "../src/model.js";
import { DataFactory, serialiseTurtle } from "../src/serialise.js";
import { FinClass, PmClass } from "../src/vocab.js";
import { parseTurtle } from "./helpers.js";

const BASE = "https://pod.example/finance/ledger.ttl";

function emptyDoc(): FinanceDocument {
  return new FinanceDocument(new Store(), DataFactory);
}

describe("MonetaryAmount", () => {
  it("round-trips amount + currency", () => {
    const doc = emptyDoc();
    const ma = doc.mintMonetaryAmount(`${BASE}#amt-1`);
    ma.amount = 42.5;
    ma.currency = "GBP";
    expect(ma.amount).toBe(42.5);
    expect(ma.currency).toBe("GBP");
    expect(ma.types.has(FinClass.MonetaryAmount)).toBe(true);
  });

  it("returns undefined for absent amount + currency", () => {
    const ma = new MonetaryAmount(`${BASE}#empty`, new Store(), DataFactory);
    expect(ma.amount).toBeUndefined();
    expect(ma.currency).toBeUndefined();
  });

  it("clears amount + currency when set to undefined", () => {
    const doc = emptyDoc();
    const ma = doc.mintMonetaryAmount(`${BASE}#amt`);
    ma.amount = 10;
    ma.currency = "EUR";
    ma.amount = undefined;
    ma.currency = undefined;
    expect(ma.amount).toBeUndefined();
    expect(ma.currency).toBeUndefined();
  });
});

describe("FinancialAccount", () => {
  it("round-trips kind, status and label", () => {
    const doc = emptyDoc();
    const acc = doc.mintAccount(`${BASE}#acc-1`);
    acc.kind = "Current";
    acc.label = "Joint Current";
    acc.status = "Active";
    expect(acc.kind).toBe("Current");
    expect(acc.label).toBe("Joint Current");
    expect(acc.status).toBe("Active");
    expect(acc.types.has(FinClass.FinancialAccount)).toBe(true);
    expect(acc.types.has(FinClass.CurrentAccount)).toBe(true);
    expect(acc.types.has(FinClass.ActiveFinancialAccount)).toBe(true);
  });

  it.each([
    ["Current", FinClass.CurrentAccount],
    ["Savings", FinClass.SavingsAccount],
    ["Credit", FinClass.CreditAccount],
    ["Investment", FinClass.InvestmentAccount],
  ] as const)("maps the %s sub-kind", (kind, cls) => {
    const doc = emptyDoc();
    const acc = doc.mintAccount(`${BASE}#a`);
    acc.kind = kind;
    expect(acc.kind).toBe(kind);
    expect(acc.types.has(cls)).toBe(true);
  });

  it.each([
    ["Active", FinClass.ActiveFinancialAccount],
    ["Frozen", FinClass.FrozenFinancialAccount],
    ["Closed", FinClass.ClosedFinancialAccount],
  ] as const)("maps the %s status phase", (status, cls) => {
    const doc = emptyDoc();
    const acc = doc.mintAccount(`${BASE}#a`);
    acc.status = status;
    expect(acc.status).toBe(status);
    expect(acc.types.has(cls)).toBe(true);
  });

  it("enforces a single status phase (Phase partition)", () => {
    const doc = emptyDoc();
    const acc = doc.mintAccount(`${BASE}#a`);
    acc.status = "Active";
    acc.status = "Frozen";
    expect(acc.status).toBe("Frozen");
    expect(acc.types.has(FinClass.ActiveFinancialAccount)).toBe(false);
    expect(acc.types.has(FinClass.FrozenFinancialAccount)).toBe(true);
  });

  it("clearKind removes the sub-kind but keeps FinancialAccount", () => {
    const doc = emptyDoc();
    const acc = doc.mintAccount(`${BASE}#a`);
    acc.kind = "Savings";
    acc.clearKind();
    acc.kind = "Credit";
    expect(acc.kind).toBe("Credit");
    expect(acc.types.has(FinClass.SavingsAccount)).toBe(false);
    expect(acc.types.has(FinClass.CreditAccount)).toBe(true);
    expect(acc.types.has(FinClass.FinancialAccount)).toBe(true);
  });

  it("returns undefined kind/status/label when unset", () => {
    const acc = new FinancialAccount(`${BASE}#bare`, new Store(), DataFactory);
    expect(acc.kind).toBeUndefined();
    expect(acc.status).toBeUndefined();
    expect(acc.label).toBeUndefined();
  });

  it("clears label when set to undefined", () => {
    const doc = emptyDoc();
    const acc = doc.mintAccount(`${BASE}#a`);
    acc.label = "x";
    acc.label = undefined;
    expect(acc.label).toBeUndefined();
  });
});

describe("Transaction", () => {
  it("round-trips all fields", () => {
    const doc = emptyDoc();
    const t = doc.mintTransaction(`${BASE}#t-1`);
    const when = new Date("2026-06-15T10:00:00.000Z");
    t.kind = "Payment";
    t.account = `${BASE}#acc`;
    t.monetaryAmount = `${BASE}#amt`;
    t.postingTime = when;
    t.category = `${BASE}#cat`;
    t.counterparty = "https://other.example/me#agent";
    expect(t.kind).toBe("Payment");
    expect(t.account).toBe(`${BASE}#acc`);
    expect(t.monetaryAmount).toBe(`${BASE}#amt`);
    expect(t.postingTime?.toISOString()).toBe(when.toISOString());
    expect(t.category).toBe(`${BASE}#cat`);
    expect(t.counterparty).toBe("https://other.example/me#agent");
  });

  it.each([
    ["Transaction", FinClass.Transaction],
    ["Payment", FinClass.Payment],
    ["CardPayment", FinClass.CardPayment],
    ["Transfer", FinClass.Transfer],
  ] as const)("derives the %s kind (most-specific wins)", (kind, cls) => {
    const doc = emptyDoc();
    const t = doc.mintTransaction(`${BASE}#t`);
    t.kind = kind;
    expect(t.kind).toBe(kind);
    expect(t.types.has(cls)).toBe(true);
    expect(t.types.has(FinClass.Transaction)).toBe(true);
  });

  it("changing kind clears the previous specific type", () => {
    const doc = emptyDoc();
    const t = doc.mintTransaction(`${BASE}#t`);
    t.kind = "CardPayment";
    t.kind = "Transfer";
    expect(t.kind).toBe("Transfer");
    expect(t.types.has(FinClass.CardPayment)).toBe(false);
    expect(t.types.has(FinClass.Payment)).toBe(false);
    expect(t.types.has(FinClass.Transfer)).toBe(true);
  });

  it("returns undefined for unset optional fields and a bare-typed kind", () => {
    const t = new Transaction(`${BASE}#bare`, new Store(), DataFactory);
    expect(t.kind).toBeUndefined();
    expect(t.account).toBeUndefined();
    expect(t.monetaryAmount).toBeUndefined();
    expect(t.postingTime).toBeUndefined();
    expect(t.category).toBeUndefined();
    expect(t.counterparty).toBeUndefined();
  });

  it("clears optional fields when set to undefined", () => {
    const doc = emptyDoc();
    const t = doc.mintTransaction(`${BASE}#t`);
    t.account = `${BASE}#a`;
    t.monetaryAmount = `${BASE}#m`;
    t.postingTime = new Date();
    t.category = `${BASE}#c`;
    t.counterparty = `${BASE}#cp`;
    t.account = undefined;
    t.monetaryAmount = undefined;
    t.postingTime = undefined;
    t.category = undefined;
    t.counterparty = undefined;
    expect(t.account).toBeUndefined();
    expect(t.monetaryAmount).toBeUndefined();
    expect(t.postingTime).toBeUndefined();
    expect(t.category).toBeUndefined();
    expect(t.counterparty).toBeUndefined();
  });
});

describe("Balance", () => {
  it("round-trips account, amount link and as-of", () => {
    const doc = emptyDoc();
    const b = doc.mintBalance(`${BASE}#b-1`);
    const when = new Date("2026-06-15T00:00:00.000Z");
    b.account = `${BASE}#acc`;
    b.monetaryAmount = `${BASE}#amt`;
    b.asOf = when;
    expect(b.account).toBe(`${BASE}#acc`);
    expect(b.monetaryAmount).toBe(`${BASE}#amt`);
    expect(b.asOf?.toISOString()).toBe(when.toISOString());
    expect(b.types.has(FinClass.Balance)).toBe(true);
  });

  it("returns undefined and clears unset fields", () => {
    const b = new Balance(`${BASE}#bare`, new Store(), DataFactory);
    expect(b.account).toBeUndefined();
    expect(b.monetaryAmount).toBeUndefined();
    expect(b.asOf).toBeUndefined();
    b.account = `${BASE}#a`;
    b.monetaryAmount = `${BASE}#m`;
    b.asOf = new Date();
    b.account = undefined;
    b.monetaryAmount = undefined;
    b.asOf = undefined;
    expect(b.account).toBeUndefined();
    expect(b.monetaryAmount).toBeUndefined();
    expect(b.asOf).toBeUndefined();
  });
});

describe("Holding", () => {
  it("round-trips instrument, quantity, account and valuation", () => {
    const doc = emptyDoc();
    const h = doc.mintHolding(`${BASE}#h-1`);
    h.instrument = "https://isin.example/GB00B03MLX29";
    h.quantity = 12.5;
    h.account = `${BASE}#invest`;
    h.valuation = `${BASE}#val`;
    expect(h.instrument).toBe("https://isin.example/GB00B03MLX29");
    expect(h.quantity).toBe(12.5);
    expect(h.account).toBe(`${BASE}#invest`);
    expect(h.valuation).toBe(`${BASE}#val`);
    expect(h.types.has(FinClass.Holding)).toBe(true);
  });

  it("returns undefined and clears unset fields", () => {
    const h = new Holding(`${BASE}#bare`, new Store(), DataFactory);
    expect(h.instrument).toBeUndefined();
    expect(h.quantity).toBeUndefined();
    expect(h.account).toBeUndefined();
    expect(h.valuation).toBeUndefined();
    h.instrument = `${BASE}#i`;
    h.quantity = 1;
    h.account = `${BASE}#a`;
    h.valuation = `${BASE}#v`;
    h.instrument = undefined;
    h.quantity = undefined;
    h.account = undefined;
    h.valuation = undefined;
    expect(h.instrument).toBeUndefined();
    expect(h.quantity).toBeUndefined();
    expect(h.account).toBeUndefined();
    expect(h.valuation).toBeUndefined();
  });
});

describe("Category", () => {
  it("round-trips label and type", () => {
    const doc = emptyDoc();
    const c = doc.mintCategory(`${BASE}#cat-groceries`);
    c.label = "Groceries";
    expect(c.label).toBe("Groceries");
    expect(c.types.has(PmClass.Category)).toBe(true);
  });

  it("returns undefined and clears label", () => {
    const c = new Category(`${BASE}#bare`, new Store(), DataFactory);
    expect(c.label).toBeUndefined();
    c.label = "x";
    c.label = undefined;
    expect(c.label).toBeUndefined();
  });
});

describe("FinanceDocument listing + amount resolution", () => {
  it("lists every entity kind from a parsed document", () => {
    const doc = emptyDoc();
    doc.mintAccount(`${BASE}#acc`).kind = "Current";
    const ma = doc.mintMonetaryAmount(`${BASE}#amt`);
    ma.amount = 9.99;
    ma.currency = "GBP";
    const t = doc.mintTransaction(`${BASE}#t`);
    t.monetaryAmount = `${BASE}#amt`;
    doc.mintBalance(`${BASE}#bal`).account = `${BASE}#acc`;
    doc.mintHolding(`${BASE}#hold`).quantity = 1;
    doc.mintCategory(`${BASE}#cat`).label = "Bills";

    expect([...doc.accounts]).toHaveLength(1);
    expect([...doc.transactions]).toHaveLength(1);
    expect([...doc.balances]).toHaveLength(1);
    expect([...doc.holdings]).toHaveLength(1);
    expect([...doc.monetaryAmounts]).toHaveLength(1);
    expect([...doc.categories]).toHaveLength(1);
  });

  it("resolveAmount follows the amount link", () => {
    const doc = emptyDoc();
    const ma = doc.mintMonetaryAmount(`${BASE}#amt`);
    ma.amount = 100.25;
    ma.currency = "USD";
    expect(doc.resolveAmount(`${BASE}#amt`)).toEqual({ amount: 100.25, currency: "USD" });
  });

  it("resolveAmount returns undefined for a missing link", () => {
    expect(emptyDoc().resolveAmount(undefined)).toBeUndefined();
  });

  it("resolveAmount returns a partial value when only one field is present", () => {
    const doc = emptyDoc();
    const ma = doc.mintMonetaryAmount(`${BASE}#amt`);
    ma.amount = 5;
    expect(doc.resolveAmount(`${BASE}#amt`)).toEqual({ amount: 5 });

    const doc2 = emptyDoc();
    const ma2 = doc2.mintMonetaryAmount(`${BASE}#amt`);
    ma2.currency = "GBP";
    expect(doc2.resolveAmount(`${BASE}#amt`)).toEqual({ currency: "GBP" });
  });

  it("reads a hand-written ledger parsed from Turtle", () => {
    const turtle = `
      @prefix fin: <https://TBD.example/solid/finance#> .
      @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
      <#acc> a fin:FinancialAccount, fin:SavingsAccount, fin:ActiveFinancialAccount ;
        skos:prefLabel "Rainy Day" .
    `;
    const doc = new FinanceDocument(parseTurtle(turtle, BASE), DataFactory);
    const [acc] = [...doc.accounts];
    expect(acc?.kind).toBe("Savings");
    expect(acc?.status).toBe("Active");
    expect(acc?.label).toBe("Rainy Day");
  });
});

describe("full round-trip through Turtle", () => {
  it("serialises a minted document and re-reads it identically", async () => {
    const doc = emptyDoc();
    const acc = doc.mintAccount(`${BASE}#acc`);
    acc.kind = "Current";
    acc.label = "Everyday";
    acc.status = "Active";
    const ma = doc.mintMonetaryAmount(`${BASE}#amt`);
    ma.amount = -19.99;
    ma.currency = "GBP";
    const t = doc.mintTransaction(`${BASE}#t`);
    t.kind = "CardPayment";
    t.account = `${BASE}#acc`;
    t.monetaryAmount = `${BASE}#amt`;
    t.postingTime = new Date("2026-06-15T12:34:56.000Z");

    const turtle = await serialiseTurtle(doc);
    const reread = new FinanceDocument(parseTurtle(turtle, BASE), DataFactory);
    const [rAcc] = [...reread.accounts];
    const [rTxn] = [...reread.transactions];
    expect(rAcc?.kind).toBe("Current");
    expect(rAcc?.label).toBe("Everyday");
    expect(rAcc?.status).toBe("Active");
    expect(rTxn?.kind).toBe("CardPayment");
    expect(reread.resolveAmount(rTxn?.monetaryAmount)).toEqual({ amount: -19.99, currency: "GBP" });
    expect(rTxn?.postingTime?.toISOString()).toBe("2026-06-15T12:34:56.000Z");
  });
});
