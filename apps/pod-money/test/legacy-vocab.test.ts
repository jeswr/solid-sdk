// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { clientIdJson } from "../src/clientid.js";
import { Category, FinanceDocument } from "../src/model.js";
import { serialiseTurtle } from "../src/serialise.js";
import { MoneyStore } from "../src/store.js";
import { TypeIndexDataset } from "../src/typeIndex.js";
import { FinClass, PmClass } from "../src/vocab.js";
import { fakeFetch, fakeFetchRdf, parseTurtle, type RecordedPut } from "./helpers.js";

const POD = "https://alice.pod.example/";
const URL = `${POD}finance/ledger.ttl`;
const OLD_PM = "https://w3id.org/jeswr/pod-money#";
const OLD_FIN = "https://w3id.org/jeswr/sectors/finance#";

function fixture(legacy: boolean): string {
  return `@prefix fin: <${legacy ? OLD_FIN : NS.FINANCE}> .
    @prefix pm: <${legacy ? OLD_PM : NS.POD_MONEY}> .
    @prefix skos: <${NS.SKOS}> .
    <#food> a ${legacy ? "pm:Category" : "fin:BudgetCategory"} ;
      skos:prefLabel "Food" ; ${legacy ? "pm:parent" : "skos:broader"} <#spending> .
    <#spending> a ${legacy ? "pm:Category" : "fin:BudgetCategory"} .
    <#account> a fin:FinancialAccount .
    <#txn> a fin:Transaction ; pm:account <#account> ; pm:category <#food> .`;
}

describe("money vocabulary migration", () => {
  it.each([false, true])("reads and saves categories (legacy=%s)", async (legacy) => {
    const puts: RecordedPut[] = [];
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({ [URL]: { turtle: fixture(legacy), etag: '"before"' } }),
      fetch: fakeFetch(puts),
    });
    const loaded = await store.loadLedger();
    const categories = [...loaded.document.categories];
    expect(categories).toHaveLength(2);
    const food = categories.find((c) => c.label === "Food");
    expect(food?.parent).toBe(`${URL}#spending`);
    expect(food?.types.has(FinClass.BudgetCategory)).toBe(true);
    expect([...loaded.document.accounts]).toHaveLength(1);
    expect([...loaded.document.transactions][0]?.category).toBe(`${URL}#food`);
    expect(puts).toHaveLength(0); // Reading never persists the migration.
    await store.save(URL, loaded.dataset, loaded);
    expect(puts[0]?.headers["if-match"]).toBe('"before"');
    const output = puts[0]?.body ?? "";
    expect(output).not.toContain("w3id.org/jeswr");
    expect(output).toContain("fin:BudgetCategory");
    expect(output).toContain("skos:broader");
    expect(output).not.toContain("pm:Category");
    const roundTrip = new FinanceDocument(parseTurtle(output, URL), DataFactory);
    expect([...roundTrip.categories].find((c) => c.label === "Food")?.parent).toBe(
      `${URL}#spending`,
    );
  });

  it("mints sector categories and writes the parent through skos:broader", async () => {
    const document = new FinanceDocument(new Store(), DataFactory);
    const category = document.mintCategory(`${URL}#food`);
    category.parent = `${URL}#spending`;
    expect(PmClass.Category).toBe(FinClass.BudgetCategory);
    const output = await serialiseTurtle(document);
    expect(output).toContain("fin:BudgetCategory");
    expect(output).toContain("skos:broader");
    expect(output).not.toContain("w3id.org/jeswr");
  });

  it("replaces and clears the parent on independently wrapped legacy categories", async () => {
    const dataset = parseTurtle(fixture(true), URL);
    const category = new Category(`${URL}#food`, dataset, DataFactory);
    expect(category.parent).toBe(`${URL}#spending`);
    category.parent = `${URL}#new-parent`;
    expect(category.parent).toBe(`${URL}#new-parent`);
    category.parent = undefined;
    expect(category.parent).toBeUndefined();
    const output = await serialiseTurtle(dataset);
    expect(output).not.toContain("w3id.org/jeswr");
    expect(
      new Category(`${URL}#food`, parseTurtle(output, URL), DataFactory).parent,
    ).toBeUndefined();
  });

  it("migrates raw serializer input, keeps named graphs, identifiers and literal text", async () => {
    const oldIdentifier = `${OLD_PM}user-resource`;
    const dataset = await parseRdf(
      `<https://example.org/graph> {
      <${oldIdentifier}> a <${OLD_PM}Category> ;
        <${NS.SKOS}prefLabel> "${OLD_PM}Category" .
    }`,
      "application/trig",
    );
    await serialiseTurtle(dataset);
    const quads = [...dataset];
    expect(quads.every((quad) => quad.subject.value === oldIdentifier)).toBe(true);
    expect(quads.every((quad) => quad.graph.value === "https://example.org/graph")).toBe(true);
    expect(quads.some((quad) => quad.object.value === FinClass.BudgetCategory)).toBe(true);
    expect(quads.some((quad) => quad.object.value === `${OLD_PM}Category`)).toBe(true);
  });

  it("finds legacy finance registrations and updates the reused registration", async () => {
    const index = new TypeIndexDataset(
      parseTurtle(
        `
      @prefix solid: <${NS.SOLID}> .
      <#reg> a solid:TypeRegistration ; solid:forClass <${OLD_FIN}Transaction> ;
        solid:instanceContainer <${POD}finance/> .`,
        URL,
      ),
      DataFactory,
    );
    expect(index.locate(FinClass.Transaction)).toHaveLength(1);
    index.register(URL, "#new", FinClass.Transaction, { container: `${POD}finance/` });
    expect([...index.registrations]).toHaveLength(1);
    expect([...index.registrations][0]?.forClass).toBe(FinClass.Transaction);
    expect(await serialiseTurtle(index)).not.toContain("w3id.org/jeswr");
  });

  it("writes canonical client metadata", () => {
    expect(
      clientIdJson({ clientId: "https://money.example/clientid.jsonld", redirectUris: [] }),
    ).not.toContain("w3id.org/jeswr");
  });
});
