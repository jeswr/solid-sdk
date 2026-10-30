// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import * as model from "../src/apps/money/lib/model";

import {
  account,
  balance,
  base,
  categories,
  money,
  other,
  range,
  row,
  source,
} from "./money-model-fixtures";

describe("money validation and pure helpers", () => {
  it("validates exact decimal money, IDs, UTC dates, ranges and transaction links", () => {
    expect(model.iri(account)).toBe(account);
    expect(model.identifier("bank-1")).toBe("bank-1");
    expect(() => model.iri("javascript:bad")).toThrow();
    expect(() => model.identifier("../x")).toThrow();
    expect(model.instant("2026-10-24T12:30:00.123Z")).toBe(Date.parse("2026-10-24T12:30:00.123Z"));
    for (const time of ["bad", "2026-02-30", "2026-10-24T99:00:00Z", "2026-10-24T24:00:00Z"])
      expect(() => model.instant(time)).toThrow();
    expect(() => model.validateRange({ start: range.end, end: range.start })).toThrow();
    for (const amount of ["NaN", "1e2", "01", ""])
      expect(() => model.validateMoney({ ...money, amount })).toThrow();
    expect(() => model.validateMoney({ ...money, currency: "" })).toThrow();
    expect(() => model.validateTransaction({ ...row, description: " " })).toThrow();
    expect(() => model.validateTransaction({ ...row, category: "bad" })).toThrow();
    model.validateTransaction({
      ...row,
      category: categories[0].id,
      payee: account,
      derivedFrom: source,
      debitAccount: account,
      creditAccount: other,
    });
  });
  it("routes monthly shards across years, leap days and inclusive boundaries", () => {
    expect(model.monthKey("2024-02-29T23:59:59Z")).toBe("2024-02");
    expect(model.monthKeys({ start: "2025-12-31", end: "2026-02-01" })).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(model.monthKeys(range)).toEqual(["2026-10"]);
    expect(model.monthKeys({ start: "9999-12-01", end: "9999-12-31" })).toEqual(["9999-12"]);
  });
  it("adds decimals exactly without rounding or floating-point loss", () => {
    for (const [a, b, total] of [
      ["0.1", "0.2", "0.3"],
      ["1", "-2", "-1"],
      ["-0.01", "-0.09", "-0.1"],
      ["1.25", "-1.25", "0"],
      ["9007199254740993", "1", "9007199254740994"],
    ])
      expect(model.addAmounts(a as string, b as string)).toBe(total);
  });
  it("selects latest balance, preferring dated values and retaining ties", () => {
    const older = { ...balance, asOf: "2026-10-01" };
    const newer = { ...balance, asOf: "2026-10-02", amount: "200" };
    expect(model.latestBalance([], account)).toBeUndefined();
    expect(
      model.latestBalance(
        [
          balance,
          balance,
          older,
          { ...balance, account: other },
          newer,
          older,
          balance,
          { ...newer, amount: "999" },
        ],
        account,
      ),
    ).toBe(newer);
    expect(() => model.latestBalance([{ ...balance, asOf: "bad" }], account)).toThrow();
  });
  it("sorts deterministically, filters account/range and includes preceding entries in the running balance", () => {
    const earlier = { ...row, id: `${row.id}-a`, postingTime: "2026-09-30", amount: "0.1" };
    const equalTime = { ...row, id: `${row.id}-b`, amount: "0.2" };
    const later = { ...row, id: `${row.id}-z`, postingTime: "2026-11-01" };
    const input = [equalTime, row, earlier, { ...row, account: other }, later];
    expect(
      model.runningBalance(input, account, money, range).map((value) => value.runningBalance),
    ).toEqual(["87.6", "87.8"]);
    expect(input[0]).toBe(equalTime);
    expect(() =>
      model.runningBalance([{ ...row, currency: "USD" }], account, money, range),
    ).toThrow("Currency mismatch");
  });
  it("builds category trees and rejects duplicates, missing parents and cycles", () => {
    expect(model.categoryTree(categories)[0]?.children[0]?.label).toBe("Shop");
    expect(model.categoryTree([])).toEqual([]);
    for (const values of [
      [categories[0], categories[0]],
      [{ ...categories[0], label: " " }],
      [categories[1]],
      [{ ...categories[0], parent: categories[1].id }, categories[1]],
      [{ ...categories[0], parent: categories[0].id }],
    ])
      expect(() => model.categoryTree(values)).toThrow();
  });
});

describe("typed money RDF", () => {
  it.each(["named", "blank"])("isolates edits to shared %s monetary nodes", (kind) => {
    const document = new model.MoneyDocument();
    model.putTransaction(document, row);
    model.putBalance(document, balance);
    const shared =
      kind === "named" ? DataFactory.namedNode(`${row.id}-amount`) : DataFactory.blankNode();
    document.node(shared).types.add(model.V.amountClass);
    document.node(shared).amount = row.amount;
    document.node(shared).currency = row.currency;
    document.node(row.id).amountNode = shared;
    document.node(balance.id).amountNode = shared;
    const changed = { ...row, amount: "25", currency: "USD" };
    model.putTransaction(document, changed);
    expect(document.transactions()).toEqual([changed]);
    expect(document.balances()).toEqual([{ ...balance, amount: row.amount }]);
    expect(document.node(row.id).amountNode?.equals(shared)).toBe(false);
    // The balance now owns the original node exclusively and may update it in place.
    model.putBalance(document, balance);
    expect(document.node(balance.id).amountNode?.equals(shared)).toBe(true);
    expect(document.transactions()).toEqual([changed]);
    expect(document.balances()).toEqual([balance]);
  });
  it("allocates distinct amounts for transaction IDs that contain the old amount suffix", () => {
    const document = new model.MoneyDocument();
    const next = { ...row, id: `${row.id}-amount`, amount: "42", currency: "EUR" };
    model.putTransaction(document, row);
    model.putTransaction(document, next);
    expect(document.transactions()).toEqual([row, next]);
    expect(document.node(row.id).amountNode?.termType).toBe("BlankNode");
    expect(document.node(next.id).amountNode?.termType).toBe("BlankNode");
    expect(document.node(row.id).amountNode).not.toEqual(document.node(next.id).amountNode);
  });
  it("does not reuse amounts with another record identity or unrelated incoming references", () => {
    const document = new model.MoneyDocument();
    model.putTransaction(document, row);
    const otherRow = { ...row, id: `${row.id}-amount`, amount: "42" };
    model.putTransaction(document, otherRow);
    document.node(row.id).amountNode = otherRow.id;
    model.putTransaction(document, row);
    expect(document.node(row.id).amountNode?.value).not.toBe(otherRow.id);
    const amount = DataFactory.namedNode(`${row.id}-external-money`);
    document.node(amount).amount = row.amount;
    document.node(amount).currency = row.currency;
    document.node(row.id).amountNode = amount;
    document.node(row.id).payee = amount.value;
    model.putTransaction(document, { ...row, payee: amount.value });
    expect(document.node(row.id).amountNode?.equals(amount)).toBe(false);
    // A self-referencing legacy amount must also be separated from its record.
    document.node(row.id).amountNode = row.id;
    model.putTransaction(document, row);
    expect(document.node(row.id).amountNode?.value).not.toBe(row.id);
  });
  it("avoids blank node labels already present in a loaded document", () => {
    const document = new model.MoneyDocument();
    const existing = DataFactory.blankNode("b0");
    document.node(existing).amount = "999";
    document.node(existing).currency = "EUR";
    model.putTransaction(document, row);
    expect(document.node(row.id).amountNode?.equals(existing)).toBe(false);
    expect(document.node(existing).amount).toBe("999");
    expect(document.node(existing).currency).toBe("EUR");
  });
  it("round-trips accounts, latest balances, transactions, categories and exact schema decimal values", async () => {
    const document = new model.MoneyDocument();
    model.putAccount(document, { id: account, label: "Current" });
    model.putBalance(document, balance);
    model.putBalance(document, { ...balance, id: `${balance.id}-dated`, asOf: range.start });
    model.putCategories(document, categories);
    const full = {
      ...row,
      category: categories[1].id,
      payee: other,
      derivedFrom: source,
      debitAccount: account,
      creditAccount: other,
    };
    model.putTransaction(document, full);
    const text = await model.serialiseMoney(document);
    expect(text).toContain("schema:value -12.50");
    expect(text).toContain("decimal");
    const parsed = await model.parseMoney(text, base);
    expect(parsed.accounts()).toEqual([{ id: account, label: "Current" }]);
    expect(parsed.balances()).toEqual([
      balance,
      { ...balance, id: `${balance.id}-dated`, asOf: range.start },
    ]);
    expect(parsed.transactions()).toEqual([full]);
    expect(parsed.categories()).toEqual(categories);
    model.putTransaction(parsed, row);
    expect(parsed.transactions()).toEqual([row]);
    model.putCategories(parsed, [
      { ...categories[1], parent: undefined } as unknown as model.Category,
    ]);
    expect(parsed.node(categories[1].id).parent).toBeUndefined();
    expect(() => model.putAccount(document, { id: account, label: " " })).toThrow();
    expect(() => model.putBalance(document, { ...balance, asOf: "bad" })).toThrow();
  });
  it("reads old finance amounts and migrates pm categories/parents without changing resource IDs or literal content", async () => {
    const legacy = "https://w3id.org/jeswr/pod-money#";
    const fin = "https://w3id.org/jeswr/sectors/finance#";
    const document = await model.parseMoney(
      `
      @prefix pm: <${legacy}> . @prefix fin: <${fin}> . @prefix skos: <${NS.SKOS}> .
      <#root> a pm:Category; skos:prefLabel "Root" .
      <#child> a pm:Category; skos:prefLabel "${legacy}Category"; pm:parent <#root> .
      <#a> a fin:FinancialAccount; skos:prefLabel "Old" .
      <#b> a fin:Balance; pm:ofAccount <#a>; fin:hasMonetaryAmount <#m> .
      <#m> a fin:MonetaryAmount; fin:amount "12.5"; fin:currency "GBP" .
      <#t> a fin:Payment; pm:account <#a>; fin:postingTime "2026-10-24"; fin:hasMonetaryAmount <#m> .
    `,
      base,
    );
    expect(document.categories()[1]).toEqual({
      id: `${base}#child`,
      label: `${legacy}Category`,
      parent: `${base}#root`,
    });
    expect(document.balances()[0]?.amount).toBe("12.5");
    expect(document.transactions()[0]?.description).toBe("Transaction");
    const serialized = await model.serialiseMoney(document);
    expect(serialized).toContain("fin:BudgetCategory");
    expect(serialized).toContain("skos:broader");
    expect(serialized).not.toContain("a pm:Category");
    // Blank-node amounts and named graph migration retain their graph identities.
    const dataset = await parseRdf(
      `<${base}graph> { <${base}cat> a <${legacy}Category>; <${legacy}parent> <${base}root> . }`,
      "application/trig",
    );
    const migrated = model.migrateMoney(dataset);
    expect([...migrated].every((quad) => quad.graph.value === `${base}graph`)).toBe(true);
    const graphNode = new model.MoneyDocument(migrated);
    expect(graphNode.nodes(model.V.categoryClass)).toHaveLength(1);
    // Duplicate subject membership across graphs is projected once.
    const extra = await parseRdf(`<${base}cat> a <${model.V.categoryClass}> .`, "text/turtle");
    for (const quad of extra) migrated.add(quad);
    expect(graphNode.nodes(model.V.categoryClass)).toHaveLength(1);
  });
  it("reads blank-node amounts and preserves typed dateTime values", async () => {
    const document = await model.parseMoney(
      `<#tx> a <${model.V.transactionClass}>; <${model.V.account}> <${account}>; <${model.V.postingTime}> "2026-10-24T12:00:00Z"; <${model.V.amountNode}> [ <${model.V.amount}> "0.1"; <${model.V.currency}> "GBP" ] .`,
      base,
    );
    expect(document.transactions()[0]?.amount).toBe("0.1");
    const node = document.node(`${base}#tx`);
    const amount = node.amountNode;
    node.amountNode = amount;
    model.putTransaction(document, { ...row, postingTime: "2026-10-24T12:00:00Z" });
    model.putBalance(document, { ...balance, asOf: "2026-10-24T12:00:00Z" });
    const roundtrip = await model.parseMoney(await model.serialiseMoney(document), base);
    expect(roundtrip.balances()[0]?.asOf).toBe("2026-10-24T12:00:00Z");
    expect(roundtrip.transactions()[1]?.postingTime).toBe("2026-10-24T12:00:00Z");
  });
  it("rejects incomplete/malformed RDF instead of silently inventing monetary data", async () => {
    const document = new model.MoneyDocument();
    document.node(account).types.add(model.V.accountClass);
    expect(() => document.accounts()).toThrow("Incomplete");
    expect(() => document.money(document.node(row.id))).toThrow("Incomplete");
    model.putBalance(document, balance);
    document.node(balance.id).asOf = "bad";
    expect(() => document.balances()).toThrow();
    await expect(model.parseMoney("broken turtle", base)).rejects.toThrow();
  });
  it("creates two opposing Transfer legs linked to both accounts and rejects invalid pairs", () => {
    const document = new model.MoneyDocument();
    const pair = model.createTransfer(document, row.id, account, other, row.postingTime, money);
    expect(pair.map((value) => value.amount)).toEqual(["-100", "100"]);
    expect(document.transactions()).toEqual(pair);
    for (const leg of pair)
      expect(document.node(leg.id).types.has(model.V.transferClass)).toBe(true);
    expect(() =>
      model.createTransfer(document, row.id, account, other, row.postingTime, money),
    ).toThrow("already exists");
    expect(() =>
      model.createTransfer(
        new model.MoneyDocument(),
        row.id,
        account,
        account,
        row.postingTime,
        money,
      ),
    ).toThrow();
    expect(() =>
      model.createTransfer(new model.MoneyDocument(), row.id, account, other, row.postingTime, {
        ...money,
        amount: "0",
      }),
    ).toThrow();
    const creditOnly = new model.MoneyDocument();
    creditOnly.node(`${row.id}-credit`).types.add(model.V.transferClass);
    expect(() =>
      model.createTransfer(creditOnly, row.id, account, other, row.postingTime, money),
    ).toThrow();
  });
});
