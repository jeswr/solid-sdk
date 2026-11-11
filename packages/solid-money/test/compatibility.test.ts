// AUTHORED-BY Codex (GPT-6.1 Sol)
import { NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import {
  MoneyDocument,
  parseMoney,
  putAccount,
  putCategories,
  putTransaction,
  serialiseMoney,
  V,
} from "../src/index.js";
import { account, balance, base, row } from "./money-model-fixtures.js";

it.each([
  '"Current"@en',
  "5",
  '"a", "b"',
])("rejects an unprofiled or ambiguous required label: %s", async (label) => {
  const document = await parseMoney(`<#a> a <${V.accountClass}>; <${V.label}> ${label} .`, base);
  expect(() => document.accounts()).toThrow("Incomplete money RDF record");
  expect(document.node(`${base}#a`).label).toBeUndefined();
  expect(await serialiseMoney(document)).toContain(label === "5" ? "5" : '"');
});

it.each([
  '"a"@en',
  "5",
  '"a", "b"',
])("drops an unprofiled or ambiguous description: %s", async (description) => {
  const document = new MoneyDocument();
  putTransaction(document, row);
  const extra = await parseMoney(`<${row.id}> <${V.description}> ${description} .`, base);
  for (const quad of [
    ...document.dataset.match(DataFactory.namedNode(row.id), DataFactory.namedNode(V.description)),
  ])
    document.dataset.delete(quad);
  for (const quad of extra.dataset) document.dataset.add(quad);
  expect(document.transactions()[0]?.description).toBe("Transaction");
});

it("drops malformed optional IRI fields instead of coercing them or selecting the first", async () => {
  const document = new MoneyDocument();
  putTransaction(document, row);
  const extra = await parseMoney(
    `<${row.id}> <${V.category}> "not an IRI"; <${V.payee}> <#one>, <#two> .`,
    base,
  );
  for (const quad of extra.dataset) document.dataset.add(quad);
  expect(document.transactions()).toEqual([row]);
  const categories = await parseMoney(
    `<#root> a <${V.categoryClass}>; <${V.label}> "Root"; <${V.parent}> "not an IRI" .`,
    base,
  );
  expect(categories.categories()).toEqual([{ id: `${base}#root`, label: "Root" }]);
});

it("rejects ambiguous required account links instead of selecting the first", async () => {
  const document = new MoneyDocument();
  putTransaction(document, row);
  const extra = await parseMoney(`<${row.id}> <${V.account}> <#another> .`, base);
  for (const quad of extra.dataset) document.dataset.add(quad);
  expect(() => document.transactions()).toThrow("Incomplete money RDF record");
});

it("requires canonical currency to be xsd:string, retaining legacy literal reads", async () => {
  const document = await parseMoney(
    `<#t> a <${V.transactionClass}>; <${V.account}> <${account}>;
    <${V.postingTime}> "2026-10-24"; <${V.amountNode}> [ <${V.amount}> "1"; <${V.currency}> "GBP"@en ] .`,
    base,
  );
  expect(() => document.transactions()).toThrow("Incomplete money RDF record");
  const legacy = await parseMoney(
    `<#t> a <${V.transactionClass}>; <${V.account}> <${account}>;
    <${V.postingTime}> "2026-10-24"; <${V.amountNode}> [ <${NS.FINANCE}amount> "1"; <${NS.FINANCE}currency> "GBP"@en ] .`,
    base,
  );
  expect(legacy.transactions()[0]?.currency).toBe("GBP");
});

it("uses runtime text sanitization for generated builds and public setters, including blank subjects", () => {
  const document = new MoneyDocument();
  putAccount(document, { id: account, label: "a\u0000b" });
  expect(document.accounts()[0]?.label).toBe("ab");
  document.node(account).label = "c\u0001d";
  expect(document.accounts()[0]?.label).toBe("cd");
  const blank = document.node(DataFactory.blankNode("label"));
  blank.label = "e\u0000f";
  expect(blank.label).toBe("ef");
  putTransaction(document, { ...row, description: "a\u0000b" });
  expect(document.transactions()[0]?.description).toBe("ab");
});

it("rejects text that is empty once control characters are stripped, before writing", () => {
  const document = new MoneyDocument();
  expect(() => putTransaction(document, { ...row, description: "\u0001" })).toThrow(
    "Transaction description is required",
  );
  expect(() => putCategories(document, [{ id: `${base}#c`, label: " \u0007 " }])).toThrow(
    "Invalid category",
  );
  expect(() => putAccount(document, { id: account, label: "\u0000" })).toThrow(
    "Account label is required",
  );
  expect(document.dataset.size).toBe(0);
});

it("still reads control-only text that older clients stored", async () => {
  const document = new MoneyDocument();
  putTransaction(document, row);
  const loaded = await parseMoney(
    (await serialiseMoney(document)).replace(`"${row.description}"`, '"\\u0001"'),
    base,
  );
  expect(loaded.transactions()[0]?.description).toBe("\u0001");
});

it("rejects a blank-node balance root that previously projected", async () => {
  const document = await parseMoney(
    `_:b a <${V.balanceClass}>; <${V.balanceAccount}> <${account}> .`,
    base,
  );
  expect(() => document.balances()).toThrow();
  expect(balance.id.startsWith("http")).toBe(true);
});

it("rejects unsafe public rdf:type additions before mutation", () => {
  const document = new MoneyDocument();
  expect(() => document.node(account).types.add("https://example.org/bad>type")).toThrow(TypeError);
  expect(document.dataset.size).toBe(0);
});

it("requires named, safe absolute record subjects in generated snapshots", () => {
  const document = new MoneyDocument();
  const node = document.node(DataFactory.blankNode("account"));
  node.types.add(V.accountClass);
  node.label = "Current";
  expect(node.label).toBe("Current");
  expect(() => document.accounts()).toThrow("Incomplete money RDF record");
});

it("retains exact decimal strings, date spellings, blank amounts, IDs and unknown RDF", async () => {
  const document = new MoneyDocument();
  const value = {
    ...row,
    amount: "9007199254740993.0000000000000000001",
    postingTime: "2026-10-24T12:00:00.100Z",
  };
  putTransaction(document, value);
  const amount = document.node(row.id).amountNode;
  expect(amount?.termType).toBe("BlankNode");
  document.node(amount ?? "").label = "keep";
  const loaded = await parseMoney(await serialiseMoney(document), base);
  expect(loaded.transactions()).toEqual([value]);
  expect(loaded.node(loaded.node(row.id).amountNode ?? "").label).toBe("keep");
});
