// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import {
  isTransactionWritable,
  MoneyDocument,
  parseMoney,
  putAccount,
  putCategories,
  putTransaction,
  serialiseMoney,
  V,
} from "../src/index.js";
import { account, base, row } from "./money-model-fixtures.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing value");
  return value;
}

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

it.each([
  ["category", V.category, '"not an IRI"'],
  ["payee", V.payee, "<#one>, <#two>"],
  ["derivedFrom", V.derivedFrom, "<#one>, <#two>"],
  ["debitAccount", V.debitAccount, '"x"'],
  ["creditAccount", V.creditAccount, "<#one>, <#two>"],
] as const)("lists a record with an unprojectable optional link %s but refuses to save over it", async (key, predicate, value) => {
  const document = new MoneyDocument();
  putTransaction(document, { ...row, [key]: undefined });
  const extra = await parseMoney(`<${row.id}> <${predicate}> ${value} .`, base);
  for (const quad of extra.dataset) document.dataset.add(quad);
  const before = new Set([...document.dataset].map((quad) => JSON.stringify(quad)));
  // One bad link must not hide the ledger: the record still lists, without the link.
  const [listed] = document.transactions();
  expect(listed?.id).toBe(row.id);
  expect(listed?.[key]).toBeUndefined();
  expect(listed?.unreadableLinks).toEqual([key]);
  expect(isTransactionWritable(must(listed))).toBe(false);
  expect(() => document.assertTransactionWritable(row.id)).toThrow("Invalid transaction link");
  expect(() => putTransaction(document, row)).toThrow("Invalid transaction link");
  // The listed snapshot is refused even by a document that holds no copy of the link.
  const elsewhere = new MoneyDocument();
  expect(() => putTransaction(elsewhere, { ...must(listed), id: `${base}#moved` })).toThrow(
    "Invalid transaction link",
  );
  expect(elsewhere.dataset.size).toBe(0);
  // The refused save left the stored record exactly as it was.
  expect(new Set([...document.dataset].map((quad) => JSON.stringify(quad)))).toEqual(before);
  if (key === "derivedFrom")
    expect(document.linkIris(row.id, key)).toEqual([`${base}#one`, `${base}#two`]);
});

it("lists a readable record without an unreadableLinks marker", () => {
  const document = new MoneyDocument();
  putTransaction(document, row);
  const [listed] = document.transactions();
  expect(listed).not.toHaveProperty("unreadableLinks");
  expect(isTransactionWritable(must(listed))).toBe(true);
  expect(() => document.assertTransactionWritable(row.id)).not.toThrow();
});

it("keeps every statement of an ambiguous link through a load-edit-save cycle", async () => {
  const document = new MoneyDocument();
  putTransaction(document, row);
  const extra = await parseMoney(
    `<${row.id}> <${V.derivedFrom}> <#one>, <#two>; <${V.category}> "not an IRI" .`,
    base,
  );
  for (const quad of extra.dataset) document.dataset.add(quad);
  const loaded = await parseMoney(await serialiseMoney(document), base);
  // The record still lists, without the links that could not be read.
  expect(loaded.transactions()).toHaveLength(1);
  // A save from that snapshot must refuse rather than erase what could not be read.
  expect(() => putTransaction(loaded, { ...row, description: "Edited" })).toThrow(
    "Invalid transaction link",
  );
  const saved = await serialiseMoney(loaded);
  expect(saved).toContain("#one");
  expect(saved).toContain("#two");
  expect(saved).toContain("not an IRI");
  expect(saved).toContain(row.description);
});

it.each([
  ["amount", `<${V.amount}> "10.00", "1000.00"; <${V.currency}> "GBP"`, '"2026-10-24"'],
  [
    "legacy amount",
    `<${NS.FINANCE}amount> "10.00", "1000.00"; <${NS.FINANCE}currency> "GBP"`,
    '"2026-10-24"',
  ],
  ["posting time", `<${V.amount}> "10.00"; <${V.currency}> "GBP"`, '"2026-10-24", "2026-11-24"'],
])("rejects a multi-valued %s instead of selecting the first", async (_name, amount, time) => {
  const document = await parseMoney(
    `<#t> a <${V.transactionClass}>; <${V.account}> <${account}>;
    <${V.postingTime}> ${time}; <${V.amountNode}> [ ${amount} ] .`,
    base,
  );
  expect(() => document.transactions()).toThrow("Incomplete money RDF record");
});

it("rejects two amount links and a multi-valued balance date", async () => {
  const two = await parseMoney(
    `<#t> a <${V.transactionClass}>; <${V.account}> <${account}>; <${V.postingTime}> "2026-10-24";
    <${V.amountNode}> [ <${V.amount}> "1"; <${V.currency}> "GBP" ],
    [ <${V.amount}> "2"; <${V.currency}> "GBP" ] .`,
    base,
  );
  expect(() => two.transactions()).toThrow("Incomplete money RDF record");
  const dated = await parseMoney(
    `<#b> a <${V.balanceClass}>; <${V.balanceAccount}> <${account}>;
    <${V.asOf}> "2026-10-24", "2026-10-25"; <${V.amountNode}> [ <${V.amount}> "1"; <${V.currency}> "GBP" ] .`,
    base,
  );
  expect(() => dated.balances()).toThrow("Incomplete money RDF record");
});

it.each([
  '"not an IRI"',
  "<#parent>, <#other>",
])("rejects an unprojectable category parent %s", async (parent) => {
  const categories = await parseMoney(
    `<#root> a <${V.categoryClass}>; <${V.label}> "Root"; <${V.parent}> ${parent} .`,
    base,
  );
  expect(() => categories.categories()).toThrow("Invalid category parent");
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
    <${V.postingTime}> "2026-10-24"; <${V.amountNode}> [
      <${V.amount}> "1"; <${V.currency}> "USD"@en; <${NS.FINANCE}currency> "GBP"
    ] .`,
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

it.each([
  "1e100000000",
  "1e-100000000",
])("rejects oversized decimal expansion of %s", async (amount) => {
  const document = await parseMoney(
    `<#t> a <${V.transactionClass}>; <${V.account}> <${account}>;
    <${V.postingTime}> "2026-10-24"; <${V.amountNode}> [
      <${V.amount}> "${amount}"^^<${NS.XSD}double>; <${V.currency}> "GBP"
    ] .`,
    base,
  );
  expect(() => document.transactions()).toThrow("Invalid money amount");
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
    `_:b a <${V.balanceClass}>; <${V.balanceAccount}> <${account}>;
    <${V.amountNode}> [ <${V.amount}> "1"; <${V.currency}> "GBP" ] .`,
    base,
  );
  // The oracle projected this blank balance with its amount; the generated core refuses it.
  expect(() => document.balances()).toThrow("Incomplete money RDF record");
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
